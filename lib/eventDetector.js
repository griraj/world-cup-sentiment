const VOLUME_SPIKE_MULT = 3.0
const SENTIMENT_SHIFT = 0.30

// Detects Event.
export function detectEvent(posts, avgVolume, prevScore) {
  if (!posts || posts.length === 0) return null

  const n = posts.length
  const pos = posts.filter(p => p.sentiment === 'POSITIVE').length
  const neg = posts.filter(p => p.sentiment === 'NEGATIVE').length
  const score = (pos - neg) / n
  const shift = prevScore != null ? score - prevScore : 0
  const isSpike = avgVolume > 0 && n >= avgVolume * VOLUME_SPIKE_MULT

  // Handles top Team.
  const topTeam = (() => {
    const counts = {}
    posts.forEach(p => { if (p.teamTag) counts[p.teamTag] = (counts[p.teamTag] || 0) + 1 })
    const entries = Object.entries(counts)
    return entries.length ? entries.sort((a, b) => b[1] - a[1])[0][0] : null
  })()

  if (isSpike && shift > SENTIMENT_SHIFT) {
    return {
      eventType: 'GOAL',
      sentimentShift: shift,
      postVolume: n,
      teamTag: topTeam,
      description: `Possible goal — positive spike of +${shift.toFixed(2)} across ${n} posts`,
    }
  }

  if (isSpike && shift < -SENTIMENT_SHIFT) {
    return {
      eventType: 'RED_CARD_OR_VAR',
      sentimentShift: shift,
      postVolume: n,
      teamTag: topTeam,
      description: `Controversy detected — negative shift of ${shift.toFixed(2)} across ${n} posts`,
    }
  }

  if (isSpike) {
    return {
      eventType: 'MATCH_SPIKE',
      sentimentShift: shift,
      postVolume: n,
      teamTag: topTeam,
      description: `Volume spike — ${n} posts vs average of ${avgVolume.toFixed(1)}`,
    }
  }

  if (Math.abs(shift) > SENTIMENT_SHIFT + 0.1) {
    return {
      eventType: shift > 0 ? 'POSITIVE_SHIFT' : 'NEGATIVE_SHIFT',
      sentimentShift: shift,
      postVolume: n,
      teamTag: null,
      description: `Mood shifted ${shift > 0 ? 'positive' : 'negative'} by ${shift.toFixed(2)}`,
    }
  }

  return null
}
