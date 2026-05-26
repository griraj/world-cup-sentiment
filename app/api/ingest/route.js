// app/api/ingest/route.js
// ─────────────────────────────────────────────────────────────
//  Vercel Cron Job endpoint – runs every 60 seconds.
//
//  Pipeline:
//    1. Fetch recent Reddit comments (or mock data)
//    2. Run HuggingFace sentiment + emotion analysis
//    3. Upsert posts into Supabase
//    4. Update per-minute aggregated metrics
//    5. Run event detection; persist if triggered
//
//  Protected by CRON_SECRET so only Vercel cron can call it.
// ─────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { fetchRecentPosts } from '@/lib/reddit'
import { analyzeBatch } from '@/lib/sentiment'
import { detectEvent } from '@/lib/eventDetector'

const VIRAL_THRESHOLD = parseInt(process.env.VIRAL_LIKE_THRESHOLD || '200')

export async function GET(request) {
  // Verify cron secret (Vercel sets this automatically in production)
  const authHeader = request.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getAdminClient()
  const startTime = Date.now()

  try {
    // ── 1. Fetch posts ───────────────────────────────────────
    const rawPosts = await fetchRecentPosts(20)
    if (rawPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, message: 'No new posts' })
    }

    // ── 2. Check for duplicates ──────────────────────────────
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

    // ── 4. Insert posts ──────────────────────────────────────
    const { error: insertError } = await db.from('posts').insert(enriched)
    if (insertError) {
      console.error('Post insert error:', insertError.message)
    }

    // ── 5. Update per-minute metrics ─────────────────────────
    await updateMetrics(db, enriched)

    // ── 6. Event detection ───────────────────────────────────
    await runEventDetection(db, enriched)

    const elapsed = Date.now() - startTime
    return NextResponse.json({
      ok: true,
      inserted: enriched.length,
      elapsed_ms: elapsed,
    })

  } catch (err) {
    console.error('Ingest error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function updateMetrics(db, posts) {
  const now = new Date()
  const bucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), 0, 0).toISOString()

  // Count by team + overall
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

    // Upsert: increment existing bucket row
    const { data: existing } = await db
      .from('metrics_minutely')
      .select('*')
      .eq('bucket_time', bucket)
      .eq('team_tag', team === '__ALL__' ? null : team)
      .maybeSingle()

    if (existing) {
      await db.from('metrics_minutely').update({
        post_count:     (existing.post_count || 0) + n,
        positive_count: (existing.positive_count || 0) + pos,
        negative_count: (existing.negative_count || 0) + neg,
        neutral_count:  (existing.neutral_count || 0) + neu,
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
  // Get average volume from last 10 minutes
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: recentMetrics } = await db
    .from('metrics_minutely')
    .select('post_count')
    .gte('bucket_time', tenMinAgo)
    .is('team_tag', null)

  const avgVolume = recentMetrics?.length
    ? recentMetrics.reduce((s, r) => s + (r.post_count || 0), 0) / recentMetrics.length
    : 0

  // Get previous sentiment score
  const { data: prevMetric } = await db
    .from('metrics_minutely')
    .select('sentiment_score')
    .is('team_tag', null)
    .order('bucket_time', { ascending: false })
    .limit(2)

  const previousScore = prevMetric?.length > 1 ? prevMetric[1].sentiment_score : null

  // Check cooldown (no events in last 45s)
  const cooldownAgo = new Date(Date.now() - 45 * 1000).toISOString()
  const { data: recentEvent } = await db
    .from('match_events')
    .select('id')
    .gte('detected_at', cooldownAgo)
    .limit(1)

  if (recentEvent?.length) return // still in cooldown

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
    console.log('Event detected:', event.eventType, event.description)
  }
}
