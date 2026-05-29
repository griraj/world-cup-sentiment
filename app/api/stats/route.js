import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const revalidate = 0

// Handles G E T.
export async function GET() {
  const now = Date.now()
  const thirtyMin = new Date(now - 30 * 60 * 1000).toISOString()
  const fiveMin = new Date(now - 5 * 60 * 1000).toISOString()
  const thirtyS = new Date(now - 30 * 1000).toISOString()
  const tenMin = new Date(now - 10 * 60 * 1000).toISOString()

  const [timeline, volume, teams, feed, events, words, momentum, total, viral, recent] =
    await Promise.all([
      supabase
        .from('metrics_minutely')
        .select('bucket_time,sentiment_score,post_count,positive_count,negative_count,neutral_count')
        .gte('bucket_time', thirtyMin)
        .is('team_tag', null)
        .order('bucket_time', { ascending: true }),

      supabase
        .from('metrics_minutely')
        .select('bucket_time,post_count')
        .gte('bucket_time', thirtyMin)
        .is('team_tag', null)
        .order('bucket_time', { ascending: true }),

      supabase
        .from('metrics_minutely')
        .select('bucket_time,team_tag,sentiment_score,post_count')
        .gte('bucket_time', thirtyMin)
        .not('team_tag', 'is', null)
        .order('bucket_time', { ascending: true }),

      supabase
        .from('posts')
        .select('post_id,username,content,sentiment,confidence,emotion,team_tag,is_viral,created_at,source')
        .order('created_at', { ascending: false })
        .limit(15),

      supabase
        .from('match_events')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(8),

      supabase
        .from('posts')
        .select('cleaned_text')
        .gte('created_at', tenMin)
        .limit(400),

      supabase
        .from('posts')
        .select('sentiment,confidence,created_at')
        .gte('created_at', thirtyS),

      supabase.from('posts').select('id', { count: 'exact', head: true }),

      supabase.from('posts').select('id', { count: 'exact', head: true }).eq('is_viral', true),

      supabase.from('posts').select('sentiment').gte('created_at', fiveMin),
    ])

  const stopwords = new Set([
    'the','a','an','is','it','in','of','to','and','for','that','this',
    'are','was','be','have','has','he','she','they','we','you','but',
    'not','so','if','worldcup','fifaworldcup','amp','just','get','with',
    'at','on','my','our','his','her','world','cup',
  ])

  const freq = {}
  for (const { cleaned_text } of words.data || []) {
    if (!cleaned_text) continue
    for (const word of cleaned_text.toLowerCase().split(/\s+/)) {
      const w = word.replace(/[^a-z]/g, '')
      if (w.length > 3 && !stopwords.has(w)) freq[w] = (freq[w] || 0) + 1
    }
  }
  const topWords = Object.fromEntries(
    Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 50)
  )

  let momentumScore = 0
  const mPosts = momentum.data || []
  if (mPosts.length > 0) {
    let totalW = 0, totalS = 0
    for (const p of mPosts) {
      const age = (now - new Date(p.created_at).getTime()) / 1000
      const w = (p.confidence || 0.5) * (1 / (1 + age / 10))
      const v = p.sentiment === 'POSITIVE' ? 1 : p.sentiment === 'NEGATIVE' ? -1 : 0
      totalS += v * w
      totalW += w
    }
    momentumScore = totalW ? totalS / totalW : 0
  }

  const recentPosts = recent.data || []
  const recentCount = recentPosts.length
  const posCount = recentPosts.filter(p => p.sentiment === 'POSITIVE').length
  const negCount = recentPosts.filter(p => p.sentiment === 'NEGATIVE').length

  return NextResponse.json({
    timeline: timeline.data || [],
    volume: volume.data || [],
    teams: teams.data || [],
    feed: feed.data || [],
    events: events.data || [],
    words: topWords,
    momentum: momentumScore,
    stats: {
      totalPosts: total.count || 0,
      viralPosts: viral.count || 0,
      positivePct: recentCount ? Math.round(posCount / recentCount * 100) : 0,
      negativePct: recentCount ? Math.round(negCount / recentCount * 100) : 0,
      sentimentScore: recentCount ? parseFloat(((posCount - negCount) / recentCount).toFixed(3)) : 0,
      postsPerMin: parseFloat((recentCount / 5).toFixed(1)),
    },
  })
}
