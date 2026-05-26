// lib/sentiment.js
// Calls HuggingFace Inference API – no local model, no 500MB download.
// Free tier: ~30k chars/month. Upgrade to HF PRO ($9/mo) for unlimited.
//
// Models used:
//   Sentiment: distilbert-base-uncased-finetuned-sst-2-english
//   Emotion:   j-hartmann/emotion-english-distilroberta-base

const HF_API_URL  = 'https://api-inference.huggingface.co/models'
const HF_TOKEN    = process.env.HF_API_TOKEN  // optional – raises rate limit
const USE_MOCK_NLP = process.env.USE_MOCK_STREAM === 'true' || !process.env.REDDIT_CLIENT_ID

const SENTIMENT_MODEL = 'distilbert-base-uncased-finetuned-sst-2-english'
const EMOTION_MODEL   = 'j-hartmann/emotion-english-distilroberta-base'

const headers = {
  'Content-Type': 'application/json',
  ...(HF_TOKEN ? { Authorization: `Bearer ${HF_TOKEN}` } : {}),
}

// ── Single text analysis ───────────────────────────────────────────────────

export async function analyzeSentiment(text) {
  if (USE_MOCK_NLP || !text) return mockSentiment(text)

  try {
    const res = await fetch(`${HF_API_URL}/${SENTIMENT_MODEL}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs: text.slice(0, 512) }),
    })

    if (!res.ok) {
      // Model loading (503) – return neutral, will retry next cron
      if (res.status === 503) return { sentiment: 'NEUTRAL', confidence: 0.5 }
      throw new Error(`HF API ${res.status}`)
    }

    const data = await res.json()
    // Response shape: [[{label, score}, {label, score}]]
    const results = Array.isArray(data[0]) ? data[0] : data
    const top = results.sort((a, b) => b.score - a.score)[0]
    const label = top.label.toUpperCase()
    const confidence = top.score

    return {
      sentiment:  confidence < 0.65 ? 'NEUTRAL' : label,
      confidence: confidence,
    }
  } catch (e) {
    console.warn('Sentiment API error:', e.message)
    return { sentiment: 'NEUTRAL', confidence: 0.5 }
  }
}

export async function analyzeEmotion(text) {
  if (USE_MOCK_NLP || !text) return mockEmotion()

  try {
    const res = await fetch(`${HF_API_URL}/${EMOTION_MODEL}`, {
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

// ── Batch analysis (sequential to respect rate limits) ────────────────────

export async function analyzeBatch(texts) {
  const results = []
  for (const text of texts) {
    const [sent, emot] = await Promise.all([
      analyzeSentiment(text),
      analyzeEmotion(text),
    ])
    results.push({ ...sent, ...emot })
    // Small delay to avoid hitting rate limits
    if (!USE_MOCK_NLP) await sleep(120)
  }
  return results
}

// ── Mock NLP (used in demo mode / when no HF token) ───────────────────────

const MOCK_SENTIMENTS = [
  { sentiment: 'POSITIVE', confidence: 0.91 },
  { sentiment: 'POSITIVE', confidence: 0.87 },
  { sentiment: 'NEGATIVE', confidence: 0.83 },
  { sentiment: 'NEUTRAL',  confidence: 0.72 },
  { sentiment: 'POSITIVE', confidence: 0.95 },
  { sentiment: 'NEGATIVE', confidence: 0.78 },
]
const MOCK_EMOTIONS = ['joy', 'anger', 'surprise', 'disappointment', 'excitement', 'neutral']

function mockSentiment(text = '') {
  const lower = text.toLowerCase()
  if (/goal|scored|amazing|insane|great|love|yes|wooo/.test(lower))
    return { sentiment: 'POSITIVE', confidence: 0.91 + Math.random() * 0.08 }
  if (/terrible|awful|hate|bad|worst|stupid|joke|trash|var|disgrace/.test(lower))
    return { sentiment: 'NEGATIVE', confidence: 0.83 + Math.random() * 0.12 }
  const r = MOCK_SENTIMENTS[Math.floor(Math.random() * MOCK_SENTIMENTS.length)]
  return { ...r, confidence: r.confidence + (Math.random() - 0.5) * 0.05 }
}

function mockEmotion() {
  return {
    emotion: MOCK_EMOTIONS[Math.floor(Math.random() * MOCK_EMOTIONS.length)],
    emotionScore: 0.6 + Math.random() * 0.35,
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
