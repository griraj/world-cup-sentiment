import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { fetchRecentPosts } from '@/lib/reddit'
import { fetchBlueskyPosts } from '@/lib/bluesky'
import { fetchRSSPosts } from '@/lib/rss'
import { analyzeBatch } from '@/lib/sentiment'

export const revalidate = 0

const VIRAL_THRESHOLD = parseInt(process.env.VIRAL_LIKE_THRESHOLD || '200')
const USE_MOCK = process.env.USE_MOCK_STREAM === 'true'

export async function GET() {
  const db = getAdminClient()
  const start = Date.now()

  try {
    let rawPosts = []

    if (USE_MOCK) {
      rawPosts = await fetchRecentPosts(20)
    } else {
      const [reddit, bluesky, rss] = await Promise.allSettled([
        fetchRecentPosts(15),
        fetchBlueskyPosts(10),
        fetchRSSPosts(10),
      ])
      rawPosts = [
        ...(reddit.status === 'fulfilled' ? reddit.value : []),
        ...(bluesky.status === 'fulfilled' ? bluesky.value : []),
        ...(rss.status === 'fulfilled' ? rss.value : []),
      ]
    }

    if (rawPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 })
    }

    const ids = rawPosts.map(p => p.postId)
    const { data: existing } = await db.from('posts').select('post_id').in('post_id', ids)
    const existingIds = new Set((existing || []).map(r => r.post_id))
    const newPosts = rawPosts.filter(p => !existingIds.has(p.postId))

    if (newPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, message: 'all duplicates' })
    }

    const texts = newPosts.map(p => p.cleanedText || p.content)
    const nlp = await analyzeBatch(texts)

    const enriched = newPosts.map((post, i) => {
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

    let inserted = 0
    for (const post of enriched) {
      const { error } = await db.from('posts').insert(post)
      if (!error) inserted++
    }

    await updateMetrics(db, enriched)

    return NextResponse.json({
      ok: true,
      inserted,
      elapsed_ms: Date.now() - start,
    })
  } catch (err) {
    console.error('Trigger error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function updateMetrics(db, posts) {
  const now = new Date()
  const bucket = new Date(
    now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), 0, 0
  ).toISOString()

  const n = posts.length
  const pos = posts.filter(p => p.sentiment === 'POSITIVE').length
  const neg = posts.filter(p => p.sentiment === 'NEGATIVE').length
  const neu = posts.filter(p => p.sentiment === 'NEUTRAL').length
  const score = (pos - neg) / Math.max(n, 1)

  const { data: existing } = await db
    .from('metrics_minutely')
    .select('*')
    .eq('bucket_time', bucket)
    .is('team_tag', null)
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
      team_tag: null,
      post_count: n,
      positive_count: pos,
      negative_count: neg,
      neutral_count: neu,
      sentiment_score: score,
    })
  }
}
