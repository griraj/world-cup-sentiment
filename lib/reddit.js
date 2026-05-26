// lib/reddit.js
// Fetches live comments from r/soccer + r/worldcup match threads.
// Falls back to mock data when credentials aren't set.

const USE_MOCK = process.env.USE_MOCK_STREAM === 'true' || !process.env.REDDIT_CLIENT_ID

const TEAM_KEYWORDS = {
  Argentina: ['argentina', 'messi', 'albiceleste', 'scaloni', 'dibu', 'arg'],
  Brazil:    ['brazil', 'brasil', 'neymar', 'selecao', 'samba', 'bra'],
  France:    ['france', 'mbappe', 'griezmann', 'les bleus', 'fra'],
  England:   ['england', 'kane', 'three lions', 'southgate', 'eng'],
  Germany:   ['germany', 'deutschland', 'muller', 'neuer', 'ger'],
  Spain:     ['spain', 'pedri', 'morata', 'la roja', 'esp'],
  Portugal:  ['portugal', 'ronaldo', 'cr7', 'por'],
  Morocco:   ['morocco', 'hakimi', 'atlas lions', 'mar'],
  Japan:     ['japan', 'samurai blue', 'jpn'],
  USA:       ['usa', 'usmnt', 'pulisic'],
}

export function detectTeamTag(text) {
  const lower = text.toLowerCase()
  for (const [team, keywords] of Object.entries(TEAM_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return team
  }
  return null
}

export function cleanText(text) {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@\w+/g, ' ')
    .replace(/#(\w+)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512)
}

// ── Live Reddit fetcher ────────────────────────────────────────────────────

export async function fetchRecentPosts(limit = 25) {
  if (USE_MOCK) return generateMockPosts(limit)

  try {
    // Use Reddit's JSON API (no auth needed for public subreddits, higher limits with auth)
    const subreddits = 'soccer+worldcup+football'
    const url = `https://www.reddit.com/r/${subreddits}/comments.json?limit=${limit}`

    const res = await fetch(url, {
      headers: {
        'User-Agent': process.env.REDDIT_USER_AGENT || 'WorldCupSentimentTracker/1.0',
      },
    })

    if (!res.ok) throw new Error(`Reddit API ${res.status}`)

    const data = await res.json()
    const comments = data?.data?.children ?? []

    const WC_KEYWORDS = [
      'world cup', 'worldcup', 'messi', 'mbappe', 'neymar', 'ronaldo',
      'goal', 'penalty', 'red card', 'var', 'argentina', 'brazil',
      'france', 'england', 'germany', 'spain', 'portugal',
    ]

    return comments
      .map(c => c.data)
      .filter(c => {
        if (!c.body || c.body === '[deleted]' || c.body === '[removed]') return false
        if (c.body.length < 10) return false
        const lower = c.body.toLowerCase()
        return WC_KEYWORDS.some(k => lower.includes(k))
      })
      .map(c => ({
        postId:    `reddit_${c.id}`,
        username:  c.author || 'anonymous',
        content:   c.body.slice(0, 280),
        cleanedText: cleanText(c.body),
        teamTag:   detectTeamTag(c.body),
        likeCount: Math.max(0, c.score || 0),
        source:    'reddit',
        subreddit: c.subreddit,
      }))
  } catch (e) {
    console.warn('Reddit fetch error:', e.message, '– using mock data')
    return generateMockPosts(limit)
  }
}

// ── Mock data ──────────────────────────────────────────────────────────────

const MOCK_POOL = [
  ["GOOOAL MESSI IS INSANE 🔥 what a worldcup goal Argentina", "Argentina"],
  ["What a save by the goalkeeper omg Brazil are incredible worldcup", "Brazil"],
  ["VAR overturned the goal this is absolute trash worldcup penalty", "France"],
  ["Mbappe just nutmegged three defenders and scored 🎉 worldcup France", "France"],
  ["Terrible refereeing. Red card was way too harsh worldcup match", null],
  ["Ronaldo free kick hit the post nooooo 😭 Portugal worldcup", "Portugal"],
  ["Brazil controlling the midfield completely right now worldcup", "Brazil"],
  ["PENALTY! Argentina wins a penalty in extra time worldcup goal", "Argentina"],
  ["That tackle deserved a red card disgraceful worldcup", null],
  ["England looking really nervous in defense worldcup match", "England"],
  ["The atmosphere in the stadium is electric right now worldcup ⚡", null],
  ["Germany pressing hard but can't find the breakthrough worldcup", "Germany"],
  ["Morocco fans are absolutely incredible today 🇲🇦 worldcup", "Morocco"],
  ["Neymar with a backheel assist genius 👏 Brazil worldcup goal", "Brazil"],
  ["Offside? Looked fine to me VAR is ruining football worldcup", null],
  ["Spain possession game is boring but effective worldcup match", "Spain"],
  ["What a match this is why we love the worldcup ❤️", null],
  ["Kane hits the post with a header so close England worldcup", "England"],
  ["Messi just won the ball back in his own half at 35 years old 😳 Argentina worldcup", "Argentina"],
  ["I can't believe that red card VAR review needed worldcup", null],
  ["The goalkeeper is having the game of his life worldcup", null],
  ["PENALTY SAVED incredible stop by the keeper worldcup", null],
  ["This is the greatest worldcup final I have ever watched honestly", null],
  ["France looking dangerous on the counter worldcup mbappe goal", "France"],
  ["Brazil pressing high causing problems worldcup goal neymar", "Brazil"],
]

let mockCounter = 0

function generateMockPosts(limit = 20) {
  const posts = []
  // Occasionally generate a burst (simulates goal spike)
  const isBurst = Math.random() < 0.12
  const count = isBurst ? Math.min(limit, 8 + Math.floor(Math.random() * 12)) : Math.min(limit, 3 + Math.floor(Math.random() * 6))

  for (let i = 0; i < count; i++) {
    const [content, teamTag] = MOCK_POOL[Math.floor(Math.random() * MOCK_POOL.length)]
    const likeCount = Math.random() < 0.05
      ? 300 + Math.floor(Math.random() * 2000)
      : Math.floor(Math.random() * 60)

    posts.push({
      postId:      `mock_${Date.now()}_${mockCounter++}`,
      username:    `fan_${1000 + Math.floor(Math.random() * 9000)}`,
      content,
      cleanedText: cleanText(content),
      teamTag,
      likeCount,
      source:      'mock',
      subreddit:   'soccer',
    })
  }
  return posts
}
