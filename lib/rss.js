import { detectTeam, cleanText } from './utils.js'

const FEEDS = [
  'https://feeds.bbci.co.uk/sport/football/rss.xml',
  'https://www.skysports.com/rss/12040',
  'https://www.espn.com/espn/rss/soccer/news',
]

const WC_TERMS = [
  'world cup', 'worldcup', 'fifa', 'messi', 'mbappe', 'neymar', 'ronaldo',
  'goal', 'penalty', 'argentina', 'brazil', 'france', 'england',
  'germany', 'spain', 'portugal', 'morocco',
]

function parseItems(xml) {
  const items = []
  const re = /<item>([\s\S]*?)<\/item>/g
  let match

  while ((match = re.exec(xml)) !== null) {
    const block = match[1]
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || /<title>(.*?)<\/title>/.exec(block))?.[1] || ''
    const desc = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) || /<description>(.*?)<\/description>/.exec(block))?.[1] || ''
    const guid = (/<guid[^>]*>(.*?)<\/guid>/.exec(block))?.[1] || Math.random().toString(36)
    const text = `${title} ${desc}`.replace(/<[^>]+>/g, ' ').trim()
    if (text.length > 10) items.push({ text, guid })
  }

  return items
}

export async function fetchRSSPosts(limit = 15) {
  const results = []

  for (const feedUrl of FEEDS) {
    if (results.length >= limit) break

    try {
      const res = await fetch(feedUrl, {
        headers: { 'User-Agent': 'wc-sentiment/1.0' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) continue

      const xml = await res.text()

      for (const { text, guid } of parseItems(xml)) {
        if (!WC_TERMS.some(k => text.toLowerCase().includes(k))) continue

        const id = btoa(unescape(encodeURIComponent(guid))).slice(0, 20).replace(/[^a-zA-Z0-9]/g, 'x')
        const host = new URL(feedUrl).hostname.replace('www.', '').replace('feeds.', '')

        results.push({
          postId: `rss_${id}`,
          username: host,
          content: text.slice(0, 280),
          cleanedText: cleanText(text),
          teamTag: detectTeam(text),
          likeCount: 0,
          source: 'rss',
        })
      }
    } catch (err) {
      console.warn(`RSS feed failed (${feedUrl}):`, err.message)
    }
  }

  return results.slice(0, limit)
}
