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
  const log = []

  try {
    // 1. Fetch posts
    let rawPosts = []
    if (USE_MOCK) {
      rawPosts = await fetchRecentPosts(20)
      log.push(`mock: ${rawPosts.length} posts`)
    } else {
      const [r, b, s] = await Promise.allSettled([
        fetchRecentPosts(15),
        fetchBlueskyPosts(10),
        fetchRSSPosts(10),
      ])
      const reddit  = r.status === 'fulfilled' ? r.value : []
      const bluesky = b.status === 'fulfilled' ? b.value : []
      const rss     = s.status === 'fulfilled' ? s.value : []
      rawPosts = [...reddit, ...bluesky, ...rss]
      log.push(`fetched: reddit=${reddit.length} bluesky=${bluesky.length} rss=${rss.length}`)
    }

    if (rawPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, log, message: 'No posts fetched' })
    }

    // 2. Deduplicate
    const postIds = rawPosts.map(p => p.postId)
    log.push(`checking ${postIds.length} ids: ${postIds.slice(0,3).join(', ')}...`)

    const { data: existing, error: selectError } = await db
      .from('posts').select('post_id').in('post_id', postIds)

    if (selectError) {
      return NextResponse.json({ error: 'select failed', details: selectError.message, log }, { status: 500 })
    }

    const existingIds = new Set((existing || []).map(r => r.post_id))
    const newPosts = rawPosts.filter(p => !existingIds.has(p.postId))
    log.push(`existing: ${existingIds.size}, new: ${newPosts.length}`)

    if (newPosts.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, log, message: 'All duplicates' })
    }

    // 3. Sentiment
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

    log.push(`inserting ${enriched.length} posts, first id: ${enriched[0]?.post_id}`)

    // 4. Insert one by one to find which fails
    let inserted = 0
    let firstError = null
    for (const post of enriched) {
      const { error } = await db.from('posts').insert(post)
      if (error) {
        if (!firstError) firstError = error.message
      } else {
        inserted++
      }
    }

    log.push(`inserted: ${inserted}, firstError: ${firstError}`)

    await updateMetrics(db, enriched)

    return NextResponse.json({
      ok: true,
      inserted,
      firstError,
      log,
      elapsed_ms: Date.now() - startTime,
    })

  } catch (err) {
    return NextResponse.json({ error: err.message, log }, { status: 500 })
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