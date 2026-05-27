// app/api/ingest/route.js
// Pipeline: fetch from Reddit + Bluesky + RSS → sentiment → Supabase

import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { fetchRecentPosts } from '@/lib/reddit'
import { fetchBlueskyPosts } from '@/lib/bluesky'
import { fetchRSSPosts } from '@/lib/rss'
import { analyzeBatch } from '@/lib/sentiment'
import { detectEvent } from '@/lib/eventDetector'

const VIRAL_THRESHOLD = parseInt(process.env.VIRAL_LIKE_THRESHOLD || '200')
const USE_MOCK = process.env.USE_MOCK_STREAM === 'true'

export async function GET(request) {

  const db = getAdminClient()
  const startTime = Date.now()

  try {
    // ── 1. Fetch from all sources ────────────────────────────
    let rawPosts = []

    if (USE_MOCK) {
      rawPosts = await fetchRecentPosts(20)
    } else {
      const [redditPosts, blueskyPosts, rssPosts] = await Promise.allSettled([
        fetchRecentPosts(15),
        fetchBlueskyPosts(10),
        fetchRSSPosts(10),
      ])

      rawPosts = [
        ...(redditPosts.status  === 'fulfilled' ? redditPosts.value  : []),
        ...(blueskyPosts.status === 'fulfilled' ? blueskyPosts.value : []),
        ...(rssPosts.status     === 'fulfilled' ? rssPosts.value     : []),
      ]

      console.log(
        `Fetched: ${redditPosts.value?.length ?? 0} Reddit, ` +
        `${blueskyPosts.value?.length ?? 0} Bluesky, ` +
        `${rssPosts.value?.length ?? 0} RSS`
      )
    }

    if (rawPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, message: 'No new posts' })
    }

    // ── 2. Deduplicate ───────────────────────────────────────
    const postIds = rawPosts.map(p => p.postId)
    const { data: existing } = await db
      .from('posts')
      .select('post_id')
      .in('post_id', postIds)

    const existingIds = new Set((existing || []).map(r => r.post_id))
    const newPosts = rawPosts.filter(p => !existingIds.has(p.postId))

    if (newPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, message: 'All duplicates' })
    }

    // ── 3. Sentiment analysis ────────────────────────────────
    const texts = newPosts.map(p => p.cleanedText || p.content)
    const nlpResults = await analyzeBatch(texts)

    const enriched = newPosts.map((post, i) => {
      const nlp = nlpResults[i] || { sentiment: 'NEUTRAL', confidence: 0.5 }
      return {
        post_id:      post.postId,
        username:     post.username,
        content:      post.content,
        cleaned_text: post.cleanedText,
        sentiment:    nlp.sentiment,
        confidence:   nlp.confidence,
        emotion:      nlp.emotion || null,
        team_tag:     post.teamTag || null,
        source:       post.source,
        like_count:   post.likeCount || 0,
        is_viral:     (post.likeCount || 0) >= VIRAL_THRESHOLD,
        created_at:   new Date().toISOString(),
      }
    })

    // ── 4. Insert ────────────────────────────────────────────
    const { error: insertError } = await db.from('posts').insert(enriched)
    if (insertError) console.error('Post insert error:', insertError.message)

    // ── 5. Metrics + event detection ─────────────────────────
    await updateMetrics(db, enriched)
    await runEventDetection(db, enriched)

    const elapsed = Date.now() - startTime
    const sourceBreakdown = enriched.reduce((acc, p) => {
      acc[p.source] = (acc[p.source] || 0) + 1
      return acc
    }, {})

    return NextResponse.json({
      ok: true,
      inserted: enriched.length,
      sources: sourceBreakdown,
      elapsed_ms: elapsed,
    })

  } catch (err) {
    console.error('Ingest error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function updateMetrics(db, posts) {
  const now = new Date()
  const bucket = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), 0, 0
  ).toISOString()

  const groups = { '__ALL__': [] }
  for (const p of posts) {
    if (p.team_tag) {
      if (!groups[p.team_tag]) groups[p.team_tag] = []
      groups[p.team_tag].push(p)
    }
    groups['__ALL__'].push(p)
  }

  for (const [team, teamPosts] of Object.entries(groups)) {
    const n   = teamPosts.length
    const pos = teamPosts.filter(p => p.sentiment === 'POSITIVE').length
    const neg = teamPosts.filter(p => p.sentiment === 'NEGATIVE').length
    const neu = teamPosts.filter(p => p.sentiment === 'NEUTRAL').length
    const score = (pos - neg) / Math.max(n, 1)

    const { data: existing } = await db
      .from('metrics_minutely')
      .select('*')
      .eq('bucket_time', bucket)
      .eq('team_tag', team === '__ALL__' ? null : team)
      .maybeSingle()

    if (existing) {
      await db.from('metrics_minutely').update({
        post_count:      (existing.post_count || 0) + n,
        positive_count:  (existing.positive_count || 0) + pos,
        negative_count:  (existing.negative_count || 0) + neg,
        neutral_count:   (existing.neutral_count || 0) + neu,
        sentiment_score: score,
      }).eq('id', existing.id)
    } else {
      await db.from('metrics_minutely').insert({
        bucket_time:    bucket,
        team_tag:       team === '__ALL__' ? null : team,
        post_count:     n,
        positive_count: pos,
        negative_count: neg,
        neutral_count:  neu,
        sentiment_score: score,
      })
    }
  }
}

async function runEventDetection(db, currentPosts) {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: recentMetrics } = await db
    .from('metrics_minutely')
    .select('post_count')
    .gte('bucket_time', tenMinAgo)
    .is('team_tag', null)

  const avgVolume = recentMetrics?.length
    ? recentMetrics.reduce((s, r) => s + (r.post_count || 0), 0) / recentMetrics.length
    : 0

  const { data: prevMetric } = await db
    .from('metrics_minutely')
    .select('sentiment_score')
    .is('team_tag', null)
    .order('bucket_time', { ascending: false })
    .limit(2)

  const previousScore = prevMetric?.length > 1 ? prevMetric[1].sentiment_score : null

  const cooldownAgo = new Date(Date.now() - 45 * 1000).toISOString()
  const { data: recentEvent } = await db
    .from('match_events')
    .select('id')
    .gte('detected_at', cooldownAgo)
    .limit(1)

  if (recentEvent?.length) return

  const event = detectEvent(currentPosts, avgVolume, previousScore)
  if (event) {
    await db.from('match_events').insert({
      event_type:      event.eventType,
      sentiment_shift: event.sentimentShift,
      post_volume:     event.postVolume,
      team_tag:        event.teamTag,
      description:     event.description,
      detected_at:     new Date().toISOString(),
    })
  }
}
