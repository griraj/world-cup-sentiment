const HF_URL = 'https://api-inference.huggingface.co/models'
const HF_TOKEN = process.env.HF_API_TOKEN
const USE_MOCK = process.env.USE_MOCK_STREAM === 'true' || !process.env.REDDIT_CLIENT_ID

const SENTIMENT_MODEL = 'distilbert-base-uncased-finetuned-sst-2-english'
const EMOTION_MODEL = 'j-hartmann/emotion-english-distilroberta-base'

const headers = {
  'Content-Type': 'application/json',
  ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {}),
}

// Gets Sentiment.
async function getSentiment(text) {
  if (USE_MOCK || !text) return mockSentiment(text)

  try {
    const res = await fetch(`${HF_URL}/${SENTIMENT_MODEL}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs: text.slice(0, 512) }),
    })

    if (res.status === 503) return { sentiment: 'NEUTRAL', confidence: 0.5 }
    if (!res.ok) throw new Error(`HF API ${res.status}`)

    const data = await res.json()
    const results = Array.isArray(data[0]) ? data[0] : data
    const top = results.sort((a, b) => b.score - a.score)[0]

    return {
      sentiment: top.score < 0.65 ? 'NEUTRAL' : top.label.toUpperCase(),
      confidence: top.score,
    }
  } catch (err) {
    console.warn('Sentiment API error:', err.message)
    return { sentiment: 'NEUTRAL', confidence: 0.5 }
  }
}

// Gets Emotion.
async function getEmotion(text) {
  if (USE_MOCK || !text) return { emotion: null, emotionScore: null }

  try {
    const res = await fetch(`${HF_URL}/${EMOTION_MODEL}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs: text.slice(0, 512) }),
    })
    if (!res.ok) return { emotion: null, emotionScore: null }

    const data = await res.json()
    const results = Array.isArray(data[0]) ? data[0] : data
    const top = results.sort((a, b) => b.score - a.score)[0]
    return { emotion: top.label.toLowerCase(), emotionScore: top.score }
  } catch {
    return { emotion: null, emotionScore: null }
  }
}

// Analyzes Batch.
export async function analyzeBatch(texts) {
  const results = []

  for (const text of texts) {
    const [sent, emot] = await Promise.all([getSentiment(text), getEmotion(text)])
    results.push({ ...sent, ...emot })
    if (!USE_MOCK) await new Promise(r => setTimeout(r, 120))
  }

  return results
}

const MOCK_SENTIMENTS = [
  { sentiment: 'POSITIVE', confidence: 0.91 },
  { sentiment: 'POSITIVE', confidence: 0.87 },
  { sentiment: 'NEGATIVE', confidence: 0.83 },
  { sentiment: 'NEUTRAL', confidence: 0.72 },
  { sentiment: 'POSITIVE', confidence: 0.95 },
  { sentiment: 'NEGATIVE', confidence: 0.78 },
]

const MOCK_EMOTIONS = ['joy', 'anger', 'surprise', 'disappointment', 'excitement', 'neutral']

// Handles mock Sentiment.
function mockSentiment(text = '') {
  const lower = text.toLowerCase()
  if (/goal|scored|amazing|insane|great|love|yes|wooo/.test(lower))
    return { sentiment: 'POSITIVE', confidence: 0.91 + Math.random() * 0.08 }
  if (/terrible|awful|hate|bad|worst|stupid|joke|trash|var|disgrace/.test(lower))
    return { sentiment: 'NEGATIVE', confidence: 0.83 + Math.random() * 0.12 }
  const r = MOCK_SENTIMENTS[Math.floor(Math.random() * MOCK_SENTIMENTS.length)]
  return { ...r, confidence: r.confidence + (Math.random() - 0.5) * 0.05 }
}
