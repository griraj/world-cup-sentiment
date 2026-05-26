// lib/eventDetector.js
// Detects match events by comparing the current batch's sentiment
// against the recent historical average stored in Supabase.

const VOLUME_SPIKE_MULTIPLIER = 3.0
const SENTIMENT_SHIFT_DELTA   = 0.30

export function detectEvent(currentBatch, recentAvgVolume, previousScore) {
  if (!currentBatch || currentBatch.length === 0) return null

  const n = currentBatch.length
  const pos = currentBatch.filter(p => p.sentiment === 'POSITIVE').length
  const neg = currentBatch.filter(p => p.sentiment === 'NEGATIVE').length
  const currentScore = (pos - neg) / n
  const sentimentShift = previousScore != null ? currentScore - previousScore : 0
  const isVolumeSpike = recentAvgVolume > 0 && n >= recentAvgVolume * VOLUME_SPIKE_MULTIPLIER

  const dominantTeam = (() => {
    const counts = {}
    currentBatch.forEach(p => { if (p.teamTag) counts[p.teamTag] = (counts[p.teamTag] || 0) + 1 })
    const entries = Object.entries(counts)
    return entries.length ? entries.sort((a, b) => b[1] - a[1])[0][0] : null
  })()

  if (isVolumeSpike && sentimentShift > SENTIMENT_SHIFT_DELTA) {
    return {
      eventType:      'GOAL',
      sentimentShift: sentimentShift,
      postVolume:     n,
      teamTag:        dominantTeam,
      description:    `Goal suspected – positive spike +${sentimentShift.toFixed(2)} with ${n} posts`,
    }
  }

  if (isVolumeSpike && sentimentShift < -SENTIMENT_SHIFT_DELTA) {
    return {
      eventType:      'RED_CARD_OR_VAR',
      sentimentShift: sentimentShift,
      postVolume:     n,
      teamTag:        dominantTeam,
      description:    `Controversy – negative spike ${sentimentShift.toFixed(2)} with ${n} posts`,
    }
  }

  if (isVolumeSpike) {
    return {
      eventType:      'MATCH_SPIKE',
      sentimentShift: sentimentShift,
      postVolume:     n,
      teamTag:        dominantTeam,
      description:    `Volume spike: ${n} posts vs avg ${recentAvgVolume.toFixed(1)}`,
    }
  }

  if (Math.abs(sentimentShift) > SENTIMENT_SHIFT_DELTA + 0.1) {
    return {
      eventType:      sentimentShift > 0 ? 'POSITIVE_SHIFT' : 'NEGATIVE_SHIFT',
      sentimentShift: sentimentShift,
      postVolume:     n,
      teamTag:        null,
      description:    `Mood shift: ${sentimentShift > 0 ? '+' : ''}${sentimentShift.toFixed(2)}`,
    }
  }

  return null
}
