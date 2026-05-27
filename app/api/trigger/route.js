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
  const startTime = Date.now()

  try {
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
        ...(redditPosts.status === 'fulfilled' ? redditPosts.value : []),
        ...(blueskyPosts.status === 'fulfilled' ? blueskyPosts.value : []),
        ...(rssPosts.status === 'fulfilled' ? rssPosts.value : []),
      ]
    }

    if (rawPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, message: 'No new posts' })
    }

    const postIds = rawPosts.map(p => p.postId)
    const { data: existing } = await db.from('posts').select('post_id').in('post_id', postIds)
    const existingIds = new Set((existing || []).map(r => r.post_id))
    const newPosts = rawPosts.filter(p => !existingIds.has(p.postId))

    if (newPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, message: 'All duplicates' })
    }

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

    const { data: insertData, error: insertError } = await db.from('posts').insert(enriched).select('post_id')
    if (insertError) return NextResponse.json({ insertError: insertError.message, code: insertError.code, details: insertError.details }, { status: 500 })
    const actuallyInserted = insertData?.length || 0

    await updateMetrics(db, enriched)

    return NextResponse.json({
      ok: true,
      inserted: enriched.length,
      sources: enriched.reduce((acc, p) => { acc[p.source] = (acc[p.source] || 0) + 1; return acc }, {}),
      elapsed_ms: Date.now() - startTime,
    })

  } catch (err) {
    console.error('Trigger error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function updateMetrics(db, posts) {
  const now = new Date()
  const bucket = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0).toISOString()
  const n = posts.length
  const pos = posts.filter(p => p.sentiment === 'POSITIVE').length
  const neg = posts.filter(p => p.sentiment === 'NEGATIVE').length
  const neu = posts.filter(p => p.sentiment === 'NEUTRAL').length
  const score = (pos - neg) / Math.max(n, 1)
  const { data: existing } = await db.from('metrics_minutely').select('*').eq('bucket_time', bucket).is('team_tag', null).maybeSingle()
  if (existing) {
    await db.from('metrics_minutely').update({
      post_count: (existing.post_count || 0) + n,
      positive_count: (existing.positive_count || 0) + pos,
      negative_count: (existing.negative_count || 0) + neg,
      neutral_count: (existing.neutral_count || 0) + neu,
      sentiment_score: score,
    }).eq('id', existing.id)
  } else {
    await db.from('metrics_minutely').insert({ bucket_time: bucket, team_tag: null, post_count: n, positive_count: pos, negative_count: neg, neutral_count: neu, sentiment_score: score })
  }
}


