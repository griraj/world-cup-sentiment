"""
Match event detection engine.

Uses sliding-window statistics over tweet volume and sentiment
to detect real-world match events: goals, red cards, VAR controversies, etc.
"""

import logging
from collections import deque
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
VOLUME_WINDOW_SECONDS   = 60    # baseline window for average volume
SPIKE_WINDOW_SECONDS    = 10    # short window for spike detection
VOLUME_SPIKE_MULTIPLIER = 3.0   # tweet rate must be N× baseline to flag
SENTIMENT_SHIFT_DELTA   = 0.35  # abs change in sentiment score to flag
COOLDOWN_SECONDS        = 45    # minimum gap between consecutive event detections


@dataclass
class TweetSignal:
    timestamp: datetime
    sentiment: str    # POSITIVE / NEGATIVE / NEUTRAL
    confidence: float
    team_tag: Optional[str]


@dataclass
class DetectedEvent:
    event_type: str
    timestamp: datetime
    sentiment_shift: float
    tweet_volume: int
    team_tag: Optional[str]
    description: str


class EventDetector:
    """
    Sliding-window event detector.

    Maintains a time-ordered deque of TweetSignals and periodically
    checks for statistical anomalies that indicate match events.
    """

    def __init__(self):
        self._signals: deque[TweetSignal] = deque()
        self._last_event_time: Optional[datetime] = None
        self._last_sentiment_score: Optional[float] = None
        self._callbacks: list = []          # callables invoked on event

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def register_callback(self, fn):
        """Register a function(DetectedEvent) called on every detection."""
        self._callbacks.append(fn)

    def ingest(self, signal: TweetSignal):
        """Add a new tweet signal and check for events."""
        self._signals.append(signal)
        self._prune()
        self._check()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _prune(self):
        """Remove signals older than the baseline window."""
        cutoff = datetime.utcnow() - timedelta(seconds=VOLUME_WINDOW_SECONDS)
        while self._signals and self._signals[0].timestamp < cutoff:
            self._signals.popleft()

    def _check(self):
        """Evaluate current window for event conditions."""
        now = datetime.utcnow()

        # Respect cooldown
        if self._last_event_time and (now - self._last_event_time).seconds < COOLDOWN_SECONDS:
            return

        all_signals  = list(self._signals)
        total        = len(all_signals)
        if total < 5:
            return

        # --- Volume spike detection ---
        spike_cutoff = now - timedelta(seconds=SPIKE_WINDOW_SECONDS)
        recent       = [s for s in all_signals if s.timestamp >= spike_cutoff]
        recent_rate  = len(recent) / SPIKE_WINDOW_SECONDS  # per second
        baseline_rate= (total - len(recent)) / max(1, VOLUME_WINDOW_SECONDS - SPIKE_WINDOW_SECONDS)

        volume_spike = (
            baseline_rate > 0 and
            recent_rate >= baseline_rate * VOLUME_SPIKE_MULTIPLIER and
            len(recent) >= 5
        )

        # --- Sentiment shift detection ---
        current_score = self._compute_score(all_signals)
        sentiment_shift = 0.0
        if self._last_sentiment_score is not None:
            sentiment_shift = current_score - self._last_sentiment_score
        self._last_sentiment_score = current_score

        big_positive_shift = sentiment_shift >  SENTIMENT_SHIFT_DELTA
        big_negative_shift = sentiment_shift < -SENTIMENT_SHIFT_DELTA

        # --- Classify event ---
        event: Optional[DetectedEvent] = None

        if volume_spike and big_positive_shift:
            dominant_team = self._dominant_team(recent)
            event = DetectedEvent(
                event_type="GOAL",
                timestamp=now,
                sentiment_shift=sentiment_shift,
                tweet_volume=len(recent),
                team_tag=dominant_team,
                description=f"Goal suspected – positive sentiment spike (+{sentiment_shift:.2f}) with {len(recent)} tweets in {SPIKE_WINDOW_SECONDS}s",
            )
        elif volume_spike and big_negative_shift:
            dominant_team = self._dominant_team(recent)
            event = DetectedEvent(
                event_type="RED_CARD_OR_VAR",
                timestamp=now,
                sentiment_shift=sentiment_shift,
                tweet_volume=len(recent),
                team_tag=dominant_team,
                description=f"Controversy detected – negative sentiment spike ({sentiment_shift:.2f}) with {len(recent)} tweets in {SPIKE_WINDOW_SECONDS}s",
            )
        elif volume_spike:
            dominant_team = self._dominant_team(recent)
            event = DetectedEvent(
                event_type="MATCH_SPIKE",
                timestamp=now,
                sentiment_shift=sentiment_shift,
                tweet_volume=len(recent),
                team_tag=dominant_team,
                description=f"Major match moment – {len(recent)} tweets in {SPIKE_WINDOW_SECONDS}s ({recent_rate:.1f}/s vs baseline {baseline_rate:.1f}/s)",
            )
        elif big_positive_shift and not volume_spike:
            event = DetectedEvent(
                event_type="POSITIVE_SHIFT",
                timestamp=now,
                sentiment_shift=sentiment_shift,
                tweet_volume=total,
                team_tag=None,
                description=f"Mood turned positive – sentiment score shifted +{sentiment_shift:.2f}",
            )
        elif big_negative_shift and not volume_spike:
            event = DetectedEvent(
                event_type="NEGATIVE_SHIFT",
                timestamp=now,
                sentiment_shift=sentiment_shift,
                tweet_volume=total,
                team_tag=None,
                description=f"Mood turned negative – sentiment score shifted {sentiment_shift:.2f}",
            )

        if event:
            self._last_event_time = now
            logger.info("Event detected: %s – %s", event.event_type, event.description)
            for cb in self._callbacks:
                try:
                    cb(event)
                except Exception as e:
                    logger.exception("Event callback error: %s", e)

    @staticmethod
    def _compute_score(signals: list[TweetSignal]) -> float:
        """
        Composite sentiment score in [-1, +1].
        Weighted by confidence.
        """
        if not signals:
            return 0.0
        total_weight = 0.0
        total_score  = 0.0
        for s in signals:
            w = s.confidence
            if s.sentiment == "POSITIVE":
                v = 1.0
            elif s.sentiment == "NEGATIVE":
                v = -1.0
            else:
                v = 0.0
            total_score  += v * w
            total_weight += w
        return total_score / total_weight if total_weight else 0.0

    @staticmethod
    def _dominant_team(signals: list[TweetSignal]) -> Optional[str]:
        """Return the most-mentioned team among a set of signals."""
        counts: dict[str, int] = {}
        for s in signals:
            if s.team_tag:
                counts[s.team_tag] = counts.get(s.team_tag, 0) + 1
        return max(counts, key=counts.get) if counts else None
