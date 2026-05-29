import { detectTeam, cleanText } from './utils.js'

export { detectTeam as detectTeamTag, cleanText }

const useMock = process.env.USE_MOCK_STREAM === 'true' || !process.env.REDDIT_CLIENT_ID

export async function fetchRecentPosts(limit = 25) {
  if (useMock) return makeMockPosts(limit)

  try {
    const url = `https://www.reddit.com/r/soccer+worldcup+football/comments.json?limit=${limit}`
    const res = await fetch(url, {
      headers: { 'User-Agent': process.env.REDDIT_USER_AGENT || 'wc-sentiment/1.0' },
    })
    if (!res.ok) throw new Error(`Reddit returned ${res.status}`)

    const json = await res.json()
    const comments = json?.data?.children ?? []

    const relevant = [
      'world cup', 'worldcup', 'messi', 'mbappe', 'neymar', 'ronaldo',
      'goal', 'penalty', 'red card', 'var', 'argentina', 'brazil',
      'france', 'england', 'germany', 'spain', 'portugal',
    ]

    return comments
      .map(c => c.data)
      .filter(c => {
        if (!c.body || c.body === '[deleted]' || c.body === '[removed]') return false
        if (c.body.length < 10) return false
        return relevant.some(k => c.body.toLowerCase().includes(k))
      })
      .map(c => ({
        postId: `reddit_${c.id}`,
        username: c.author || 'anonymous',
        content: c.body.slice(0, 280),
        cleanedText: cleanText(c.body),
        teamTag: detectTeam(c.body),
        likeCount: Math.max(0, c.score || 0),
        source: 'reddit',
      }))
  } catch (err) {
    console.warn('Reddit fetch failed, using mock:', err.message)
    return makeMockPosts(limit)
  }
}

const SAMPLE_POSTS = [
  ['GOOOAL MESSI IS INSANE what a worldcup goal Argentina', 'Argentina'],
  ['What a save by the goalkeeper omg Brazil are incredible worldcup', 'Brazil'],
  ['VAR overturned the goal this is absolute trash worldcup penalty', 'France'],
  ['Mbappe just nutmegged three defenders and scored worldcup France', 'France'],
  ['Terrible refereeing. Red card was way too harsh worldcup match', null],
  ['Ronaldo free kick hit the post Portugal worldcup', 'Portugal'],
  ['Brazil controlling the midfield completely right now worldcup', 'Brazil'],
  ['PENALTY Argentina wins a penalty in extra time worldcup goal', 'Argentina'],
  ['That tackle deserved a red card disgraceful worldcup', null],
  ['England looking really nervous in defense worldcup match', 'England'],
  ['The atmosphere in the stadium is electric right now worldcup', null],
  ['Germany pressing hard but cannot find the breakthrough worldcup', 'Germany'],
  ['Morocco fans are absolutely incredible today worldcup', 'Morocco'],
  ['Neymar with a backheel assist genius Brazil worldcup goal', 'Brazil'],
  ['Offside looked fine to me VAR is ruining football worldcup', null],
  ['Spain possession game is boring but effective worldcup match', 'Spain'],
  ['What a match this is why we love the worldcup', null],
  ['Kane hits the post with a header so close England worldcup', 'England'],
  ['Messi just won the ball back in his own half Argentina worldcup', 'Argentina'],
  ['I cannot believe that red card VAR review needed worldcup', null],
  ['The goalkeeper is having the game of his life worldcup', null],
  ['PENALTY SAVED incredible stop by the keeper worldcup', null],
  ['France looking dangerous on the counter worldcup mbappe goal', 'France'],
  ['Brazil pressing high causing problems worldcup goal neymar', 'Brazil'],
  ['What a tournament this has been worldcup 2026', null],
]

let counter = 0

function makeMockPosts(limit = 20) {
  const burst = Math.random() < 0.12
  const count = burst
    ? Math.min(limit, 8 + Math.floor(Math.random() * 12))
    : Math.min(limit, 3 + Math.floor(Math.random() * 6))

  return Array.from({ length: count }, () => {
    const [content, teamTag] = SAMPLE_POSTS[Math.floor(Math.random() * SAMPLE_POSTS.length)]
    const likeCount = Math.random() < 0.05
      ? 300 + Math.floor(Math.random() * 2000)
      : Math.floor(Math.random() * 60)

    return {
      postId: `mock_${Date.now()}_${counter++}`,
      username: `fan_${1000 + Math.floor(Math.random() * 9000)}`,
      content,
      cleanedText: cleanText(content),
      teamTag,
      likeCount,
      source: 'mock',
    }
  })
}
