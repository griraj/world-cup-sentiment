import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { fetchRecentPosts } from '@/lib/reddit'
import { fetchBlueskyPosts } from '@/lib/bluesky'
import { fetchRSSPosts } from '@/lib/rss'
import { analyzeBatch } from '@/lib/sentiment'
import { detectEvent } from '@/lib/eventDetector'

const VIRAL_THRESHOLD = parseInt(process.env.VIRAL_LIKE_THRESHOLD || '200')
const USE_MOCK = process.env.USE_MOCK_STREAM === 'true'

// Handles G E T.
export async function GET(request) {
  const auth = request.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getAdminClient()
  const start = Date.now()

  try {
    const rawPosts = await getPosts()
    if (rawPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 })
    }

    const newPosts = await dedup(db, rawPosts)
    if (newPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, message: 'all duplicates' })
    }

    const enriched = await enrich(newPosts)
    await insert(db, enriched)
    await updateMetrics(db, enriched)
    await checkForEvent(db, enriched)

    return NextResponse.json({
      ok: true,
      inserted: enriched.length,
      elapsed_ms: Date.now() - start,
    })
  } catch (err) {
    console.error('Ingest error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Gets Posts.
async function getPosts() {
  if (USE_MOCK) return fetchRecentPosts(20)

  const [reddit, bluesky, rss] = await Promise.allSettled([
    fetchRecentPosts(15),
    fetchBlueskyPosts(10),
    fetchRSSPosts(10),
  ])

  return [
    ...(reddit.status === 'fulfilled' ? reddit.value : []),
    ...(bluesky.status === 'fulfilled' ? bluesky.value : []),
    ...(rss.status === 'fulfilled' ? rss.value : []),
  ]
}

// Handles dedup.
async function dedup(db, posts) {
  const ids = posts.map(p => p.postId)
  const { data } = await db.from('posts').select('post_id').in('post_id', ids)
  const existing = new Set((data || []).map(r => r.post_id))
  return posts.filter(p => !existing.has(p.postId))
}

// Handles enrich.
async function enrich(posts) {
  const texts = posts.map(p => p.cleanedText || p.content)
  const nlp = await analyzeBatch(texts)

  return posts.map((post, i) => {
    const result = nlp[i] || { sentiment: 'NEUTRAL', confidence: 0.5 }
    return {
      post_id: post.postId,
      username: post.username,
      content: post.content,
      cleaned_text: post.cleanedText,
      sentiment: result.sentiment,
      confidence: result.confidence,
      emotion: result.emotion || null,
      team_tag: post.teamTag || null,
      source: post.source,
      like_count: post.likeCount || 0,
      is_viral: (post.likeCount || 0) >= VIRAL_THRESHOLD,
      created_at: new Date().toISOString(),
    }
  })
}

// Handles insert.
async function insert(db, posts) {
  const { error } = await db.from('posts').insert(posts)
  if (error) console.error('Insert error:', error.message)
}

// Updates Metrics.
async function updateMetrics(db, posts) {
  const now = new Date()
  const bucket = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), 0, 0
  ).toISOString()

  const groups = { __ALL__: [] }
  for (const p of posts) {
    if (p.team_tag) {
      if (!groups[p.team_tag]) groups[p.team_tag] = []
      groups[p.team_tag].push(p)
    }
    groups.__ALL__.push(p)
  }

  for (const [team, group] of Object.entries(groups)) {
    const n = group.length
    const pos = group.filter(p => p.sentiment === 'POSITIVE').length
    const neg = group.filter(p => p.sentiment === 'NEGATIVE').length
    const neu = group.filter(p => p.sentiment === 'NEUTRAL').length
    const score = (pos - neg) / Math.max(n, 1)
    const teamTag = team === '__ALL__' ? null : team

    const { data: existing } = await db
      .from('metrics_minutely')
      .select('*')
      .eq('bucket_time', bucket)
      .eq('team_tag', teamTag)
      .maybeSingle()

    if (existing) {
      await db.from('metrics_minutely').update({
        post_count: (existing.post_count || 0) + n,
        positive_count: (existing.positive_count || 0) + pos,
        negative_count: (existing.negative_count || 0) + neg,
        neutral_count: (existing.neutral_count || 0) + neu,
        sentiment_score: score,
      }).eq('id', existing.id)
    } else {
      await db.from('metrics_minutely').insert({
        bucket_time: bucket,
        team_tag: teamTag,
        post_count: n,
        positive_count: pos,
        negative_count: neg,
        neutral_count: neu,
        sentiment_score: score,
      })
    }
  }
}

// Checks For Event.
async function checkForEvent(db, posts) {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: recent } = await db
    .from('metrics_minutely')
    .select('post_count')
    .gte('bucket_time', tenMinAgo)
    .is('team_tag', null)

  const avgVolume = recent?.length
    ? recent.reduce((s, r) => s + (r.post_count || 0), 0) / recent.length
    : 0

  const { data: prev } = await db
    .from('metrics_minutely')
    .select('sentiment_score')
    .is('team_tag', null)
    .order('bucket_time', { ascending: false })
    .limit(2)

  const prevScore = prev?.length > 1 ? prev[1].sentiment_score : null

  const cooldown = new Date(Date.now() - 45 * 1000).toISOString()
  const { data: lastEvent } = await db
    .from('match_events')
    .select('id')
    .gte('detected_at', cooldown)
    .limit(1)

  if (lastEvent?.length) return

  const event = detectEvent(posts, avgVolume, prevScore)
  if (event) {
    await db.from('match_events').insert({
      event_type: event.eventType,
      sentiment_shift: event.sentimentShift,
      post_volume: event.postVolume,
      team_tag: event.teamTag,
      description: event.description,
      detected_at: new Date().toISOString(),
    })
  }
}
