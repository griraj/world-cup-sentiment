// lib/bluesky.js
// Fetches public World Cup posts from Bluesky via their free AppView API.
// No auth or API key needed — completely free.

import { detectTeamTag, cleanText } from './reddit.js'

const WC_KEYWORDS = [
  'worldcup', 'world cup', 'messi', 'mbappe', 'neymar', 'ronaldo',
  'goal', 'penalty', 'red card', 'var', 'argentina', 'brazil',
  'france', 'england', 'germany', 'spain', 'portugal', 'morocco',
  'fifaworldcup', 'qatar2022', 'football', 'soccer',
]

export async function fetchBlueskyPosts(limit = 20) {
  try {
    const results = []

    for (const keyword of ['worldcup', 'world cup soccer', 'messi goal', 'mbappe']) {
      if (results.length >= limit) break

      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(keyword)}&limit=10&sort=latest`
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      })

      if (!res.ok) continue

      const data = await res.json()
      const posts = data?.posts ?? []

      for (const post of posts) {
        const text = post?.record?.text
        if (!text || text.length < 10) continue
        const lower = text.toLowerCase()
        if (!WC_KEYWORDS.some(k => lower.includes(k))) continue

        results.push({
          postId:      `bsky_${post.cid}`,
          username:    post.author?.handle || 'anonymous',
          content:     text.slice(0, 280),
          cleanedText: cleanText(text),
          teamTag:     detectTeamTag(text),
          likeCount:   post.likeCount || 0,
          source:      'bluesky',
        })
      }

      await new Promise(r => setTimeout(r, 100))
    }

    return results.slice(0, limit)
  } catch (e) {
    console.warn('Bluesky fetch error:', e.message)
    return []
  }
}
