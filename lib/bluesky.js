import { detectTeam, cleanText } from './utils.js'

const WC_TERMS = [
  'worldcup', 'world cup', 'messi', 'mbappe', 'neymar', 'ronaldo',
  'goal', 'penalty', 'red card', 'var', 'argentina', 'brazil',
  'france', 'england', 'germany', 'spain', 'portugal', 'morocco',
  'football', 'soccer',
]

// Fetches Bluesky Posts.
export async function fetchBlueskyPosts(limit = 20) {
  const results = []

  for (const query of ['worldcup', 'world cup soccer', 'messi goal', 'mbappe']) {
    if (results.length >= limit) break

    try {
      const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=10&sort=latest`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) continue

      const data = await res.json()

      for (const post of data?.posts ?? []) {
        const text = post?.record?.text
        if (!text || text.length < 10) continue
        if (!WC_TERMS.some(k => text.toLowerCase().includes(k))) continue

        results.push({
          postId: `bsky_${post.cid}`,
          username: post.author?.handle || 'anonymous',
          content: text.slice(0, 280),
          cleanedText: cleanText(text),
          teamTag: detectTeam(text),
          likeCount: post.likeCount || 0,
          source: 'bluesky',
        })
      }

      await new Promise(r => setTimeout(r, 100))
    } catch (err) {
      console.warn('Bluesky query failed:', err.message)
    }
  }

  return results.slice(0, limit)
}
