// app/api/stats/route.js
// Returns all dashboard data in a single request to minimise round-trips.

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const revalidate = 0  // never cache – always fresh

export async function GET() {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const fiveMinAgo   = new Date(Date.now() - 5  * 60 * 1000).toISOString()
  const thirtySecAgo = new Date(Date.now() - 30       * 1000).toISOString()

  const [
    timelineRes,
    volumeRes,
    teamRes,
    feedRes,
    eventsRes,
    wordRes,
    momentumRes,
    totalRes,
    viralRes,
  ] = await Promise.all([

    // Sentiment timeline (per minute, overall)
    supabase
      .from('metrics_minutely')
      .select('bucket_time,sentiment_score,post_count,positive_count,negative_count,neutral_count')
      .gte('bucket_time', thirtyMinAgo)
      .is('team_tag', null)
      .order('bucket_time', { ascending: true }),

    // Volume timeline
    supabase
      .from('metrics_minutely')
      .select('bucket_time,post_count')
      .gte('bucket_time', thirtyMinAgo)
      .is('team_tag', null)
      .order('bucket_time', { ascending: true }),

    // Team comparison
    supabase
      .from('metrics_minutely')
      .select('bucket_time,team_tag,sentiment_score,post_count')
      .gte('bucket_time', thirtyMinAgo)
      .not('team_tag', 'is', null)
      .order('bucket_time', { ascending: true }),

    // Live feed
    supabase
      .from('posts')
      .select('post_id,username,content,sentiment,confidence,emotion,team_tag,is_viral,created_at')
      .order('created_at', { ascending: false })
      .limit(15),

    // Recent events
    supabase
      .from('match_events')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(8),

    // Word frequencies (last 10 min)
    supabase
      .from('posts')
      .select('cleaned_text')
      .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(400),

    // Momentum (last 30 sec)
    supabase
      .from('posts')
      .select('sentiment,confidence,created_at')
      .gte('created_at', thirtySecAgo),

    // Total post count
    supabase.from('posts').select('id', { count: 'exact', head: true }),

    // Viral count
    supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('is_viral', true),
  ])

  // ── Compute summary stats ──────────────────────────────────
  const recentPosts = await supabase
    .from('posts')
    .select('sentiment')
    .gte('created_at', fiveMinAgo)

  const recent = recentPosts.data || []
  const recentCount = recent.length
  const posCount = recent.filter(p => p.sentiment === 'POSITIVE').length
  const negCount = recent.filter(p => p.sentiment === 'NEGATIVE').length

  // ── Compute momentum score ─────────────────────────────────
  const momentumPosts = momentumRes.data || []
  let momentumScore = 0
  if (momentumPosts.length > 0) {
    const now = Date.now()
    let totalW = 0, totalS = 0
    momentumPosts.forEach(p => {
      const age = (now - new Date(p.created_at).getTime()) / 1000
      const w = (p.confidence || 0.5) * (1 / (1 + age / 10))
      const v = p.sentiment === 'POSITIVE' ? 1 : p.sentiment === 'NEGATIVE' ? -1 : 0
      totalS += v * w
      totalW += w
    })
    momentumScore = totalW ? totalS / totalW : 0
  }

  // ── Compute word frequencies ───────────────────────────────
  const STOPWORDS = new Set([
    'the','a','an','is','it','in','of','to','and','for','that','this',
    'are','was','be','have','has','he','she','they','we','you','but',
    'not','so','if','worldcup','fifaworldcup','amp','just','get','with',
    'at','on','my','our','his','her','world','cup',
  ])

  const wordFreq = {}
  ;(wordRes.data || []).forEach(({ cleaned_text }) => {
    if (!cleaned_text) return
    cleaned_text.toLowerCase().split(/\s+/).forEach(word => {
      const w = word.replace(/[^a-z]/g, '')
      if (w.length > 3 && !STOPWORDS.has(w)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1
      }
    })
  })

  const topWords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .reduce((acc, [w, c]) => { acc[w] = c; return acc }, {})

  return NextResponse.json({
    timeline:   timelineRes.data  || [],
    volume:     volumeRes.data    || [],
    teams:      teamRes.data      || [],
    feed:       feedRes.data      || [],
    events:     eventsRes.data    || [],
    words:      topWords,
    momentum:   momentumScore,
    stats: {
      totalPosts:    totalRes.count  || 0,
      viralPosts:    viralRes.count  || 0,
      recentPosts:   recentCount,
      positivePct:   recentCount ? Math.round(posCount / recentCount * 100) : 0,
      negativePct:   recentCount ? Math.round(negCount / recentCount * 100) : 0,
      sentimentScore: recentCount ? parseFloat(((posCount - negCount) / recentCount).toFixed(3)) : 0,
      postsPerMin:   parseFloat((recentCount / 5).toFixed(1)),
    },
  })
}
