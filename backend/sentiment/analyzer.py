"""
Sentiment analysis service using HuggingFace Transformers.

Supports:
  - Sentiment classification (POSITIVE / NEGATIVE / NEUTRAL)
  - Emotion detection (joy, anger, surprise, disappointment, excitement)
  - Batch inference for throughput
  - Easy model hot-swap via env var
"""

import os
import logging
import threading
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SENTIMENT_MODEL = os.getenv(
    "SENTIMENT_MODEL",
    "distilbert-base-uncased-finetuned-sst-2-english"
)
EMOTION_MODEL = os.getenv(
    "EMOTION_MODEL",
    "j-hartmann/emotion-english-distilroberta-base"
)
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "32"))
MAX_LENGTH = int(os.getenv("MAX_TOKEN_LENGTH", "128"))


@dataclass
class SentimentResult:
    sentiment: str          # POSITIVE / NEGATIVE / NEUTRAL
    confidence: float       # 0.0 – 1.0
    emotion: Optional[str]  # joy / anger / surprise / sadness / fear / disgust / neutral
    emotion_score: Optional[float]


# ---------------------------------------------------------------------------
# Lazy singleton loader (avoids loading 250 MB model at import time)
# ---------------------------------------------------------------------------
class SentimentService:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._initialized = False
        return cls._instance

    def _initialize(self):
        """Load models once, thread-safe."""
        if self._initialized:
            return

        logger.info("Loading sentiment model: %s", SENTIMENT_MODEL)
        try:
            from transformers import pipeline

            self._sentiment_pipe = pipeline(
                "sentiment-analysis",
                model=SENTIMENT_MODEL,
                tokenizer=SENTIMENT_MODEL,
                truncation=True,
                max_length=MAX_LENGTH,
                device=-1,  # CPU; set to 0 for GPU
            )
            logger.info("Sentiment model loaded.")
        except Exception as e:
            logger.error("Failed to load sentiment model: %s", e)
            self._sentiment_pipe = None

        logger.info("Loading emotion model: %s", EMOTION_MODEL)
        try:
            from transformers import pipeline as pipeline2

            self._emotion_pipe = pipeline2(
                "text-classification",
                model=EMOTION_MODEL,
                tokenizer=EMOTION_MODEL,
                truncation=True,
                max_length=MAX_LENGTH,
                device=-1,
            )
            logger.info("Emotion model loaded.")
        except Exception as e:
            logger.warning("Emotion model unavailable (non-fatal): %s", e)
            self._emotion_pipe = None

        self._initialized = True

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(self, text: str) -> SentimentResult:
        """Analyze a single text string. Returns SentimentResult."""
        results = self.analyze_batch([text])
        return results[0]

    def analyze_batch(self, texts: list[str]) -> list[SentimentResult]:
        """
        Analyze a batch of texts for maximum GPU/CPU throughput.
        Falls back to a neutral result if models are unavailable.
        """
        self._initialize()

        if not texts:
            return []

        # ---- Sentiment ----
        sentiments = self._run_sentiment(texts)

        # ---- Emotion ----
        emotions = self._run_emotion(texts)

        results = []
        for i, text in enumerate(texts):
            s = sentiments[i] if i < len(sentiments) else ("NEUTRAL", 0.5)
            e = emotions[i] if i < len(emotions) else (None, None)
            results.append(
                SentimentResult(
                    sentiment=s[0],
                    confidence=s[1],
                    emotion=e[0],
                    emotion_score=e[1],
                )
            )
        return results

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _run_sentiment(self, texts: list[str]) -> list[tuple[str, float]]:
        if self._sentiment_pipe is None:
            return [("NEUTRAL", 0.5)] * len(texts)

        try:
            raw = self._sentiment_pipe(texts, batch_size=BATCH_SIZE, truncation=True)
            out = []
            for r in raw:
                label = r["label"].upper()  # POSITIVE / NEGATIVE
                score = float(r["score"])
                # Map 2-class model to 3-class: low-confidence becomes NEUTRAL
                if score < 0.65:
                    label = "NEUTRAL"
                out.append((label, score))
            return out
        except Exception as e:
            logger.error("Sentiment inference error: %s", e)
            return [("NEUTRAL", 0.5)] * len(texts)

    def _run_emotion(self, texts: list[str]) -> list[tuple[Optional[str], Optional[float]]]:
        if self._emotion_pipe is None:
            return [(None, None)] * len(texts)

        try:
            raw = self._emotion_pipe(texts, batch_size=BATCH_SIZE, truncation=True)
            return [(r["label"].lower(), float(r["score"])) for r in raw]
        except Exception as e:
            logger.warning("Emotion inference error: %s", e)
            return [(None, None)] * len(texts)


# ---------------------------------------------------------------------------
# Module-level convenience function
# ---------------------------------------------------------------------------

_service = SentimentService()


def analyze(text: str) -> SentimentResult:
    return _service.analyze(text)


def analyze_batch(texts: list[str]) -> list[SentimentResult]:
    return _service.analyze_batch(texts)
