"""
Main pipeline orchestrator.

Connects:
  Tweet Stream → Sentiment Analysis → Event Detection → Database → Dashboard

Uses a producer/consumer pattern with an in-process queue and a thread pool
for batch sentiment inference.
"""

import os
import queue
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Optional

from backend.db.models import init_db, get_db, Tweet, MatchEvent, AggregatedMetric
from backend.sentiment.analyzer import analyze_batch, SentimentResult
from backend.events.detector import EventDetector, TweetSignal, DetectedEvent
from utils.text_cleaner import detect_team_tag

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
USE_MOCK_STREAM = os.getenv("USE_MOCK_STREAM", "true").lower() == "true"
QUEUE_MAXSIZE   = int(os.getenv("QUEUE_MAXSIZE", "5000"))
BATCH_SIZE      = int(os.getenv("PIPELINE_BATCH_SIZE", "16"))
FLUSH_INTERVAL  = float(os.getenv("FLUSH_INTERVAL_SECONDS", "2.0"))
VIRAL_THRESHOLD = int(os.getenv("VIRAL_LIKE_THRESHOLD", "200"))


class Pipeline:
    """
    Singleton pipeline manager.
    Call Pipeline().start() once at app startup.
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
                cls._instance._started = False
        return cls._instance

    def __init__(self):
        if self._started:
            return
        self._tweet_queue: queue.Queue = queue.Queue(maxsize=QUEUE_MAXSIZE)
        self._event_detector = EventDetector()
        self._event_detector.register_callback(self._on_event)
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="Sentiment")
        self._stream_manager: Optional[object] = None
        self._consumer_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def start(self):
        """Initialize DB and start all pipeline components."""
        if self._started:
            logger.warning("Pipeline already started.")
            return

        init_db()

        # Select stream source
        if USE_MOCK_STREAM or not os.getenv("TWITTER_BEARER_TOKEN"):
            from backend.streaming.stream import MockStreamManager
            self._stream_manager = MockStreamManager(self._tweet_queue)
        else:
            from backend.streaming.stream import StreamManager
            self._stream_manager = StreamManager(self._tweet_queue)

        self._stream_manager.start()

        # Start consumer thread
        self._consumer_thread = threading.Thread(
            target=self._consume_loop,
            name="PipelineConsumer",
            daemon=True,
        )
        self._consumer_thread.start()

        self._started = True
        logger.info(
            "Pipeline started (mock=%s, batch=%d, flush=%.1fs).",
            USE_MOCK_STREAM, BATCH_SIZE, FLUSH_INTERVAL
        )

    def stop(self):
        self._stop_event.set()
        if self._stream_manager:
            self._stream_manager.stop()
        self._executor.shutdown(wait=False)
        logger.info("Pipeline stopped.")

    # ------------------------------------------------------------------
    # Consumer loop
    # ------------------------------------------------------------------

    def _consume_loop(self):
        """
        Drain the queue in batches, run sentiment, persist to DB.
        Runs in its own thread so as not to block the Dash server.
        """
        batch: list[dict] = []
        last_flush = time.monotonic()

        while not self._stop_event.is_set():
            # Collect up to BATCH_SIZE items or until FLUSH_INTERVAL elapses
            deadline = last_flush + FLUSH_INTERVAL
            while time.monotonic() < deadline and len(batch) < BATCH_SIZE:
                remaining = deadline - time.monotonic()
                try:
                    item = self._tweet_queue.get(timeout=min(remaining, 0.1))
                    batch.append(item)
                except queue.Empty:
                    break

            if batch:
                self._process_batch(batch)
                batch = []
                last_flush = time.monotonic()

    def _process_batch(self, batch: list[dict]):
        """Run sentiment analysis on a batch, then persist and detect events."""
        texts = [item["cleaned_text"] or item["text"] for item in batch]

        # Sentiment inference (may take 100–500ms for batch)
        try:
            results: list[SentimentResult] = analyze_batch(texts)
        except Exception as e:
            logger.error("Batch inference failed: %s", e)
            results = []

        with get_db() as db:
            for i, item in enumerate(batch):
                r = results[i] if i < len(results) else None
                sentiment  = r.sentiment if r else "NEUTRAL"
                confidence = r.confidence if r else 0.5
                emotion    = r.emotion if r else None
                is_viral   = int(item.get("like_count", 0) >= VIRAL_THRESHOLD)

                # Persist tweet
                try:
                    tweet = Tweet(
                        tweet_id      = item["tweet_id"],
                        username      = item.get("username"),
                        text          = item["text"],
                        cleaned_text  = item.get("cleaned_text"),
                        created_at    = item.get("created_at", datetime.utcnow()),
                        sentiment     = sentiment,
                        confidence    = confidence,
                        emotion       = emotion,
                        team_tag      = item.get("team_tag"),
                        language      = item.get("language"),
                        retweet_count = item.get("retweet_count", 0),
                        like_count    = item.get("like_count", 0),
                        is_viral      = is_viral,
                    )
                    db.add(tweet)
                except Exception as e:
                    logger.debug("Tweet insert skipped (likely dupe): %s", e)
                    continue

                # Feed event detector
                signal = TweetSignal(
                    timestamp  = item.get("created_at", datetime.utcnow()),
                    sentiment  = sentiment,
                    confidence = confidence,
                    team_tag   = item.get("team_tag"),
                )
                self._event_detector.ingest(signal)

        self._update_aggregates(batch, results)

    def _update_aggregates(self, batch: list[dict], results: list[SentimentResult]):
        """Update per-minute bucketed metrics for fast dashboard queries."""
        buckets: dict[tuple, dict] = {}

        for i, item in enumerate(batch):
            r = results[i] if i < len(results) else None
            ts = item.get("created_at", datetime.utcnow())
            bucket = ts.replace(second=0, microsecond=0)
            team   = item.get("team_tag") or "__ALL__"
            key    = (bucket, team)

            if key not in buckets:
                buckets[key] = {"pos": 0, "neg": 0, "neu": 0, "conf_sum": 0.0, "n": 0}

            b = buckets[key]
            b["n"] += 1
            if r:
                b["conf_sum"] += r.confidence
                if r.sentiment == "POSITIVE":
                    b["pos"] += 1
                elif r.sentiment == "NEGATIVE":
                    b["neg"] += 1
                else:
                    b["neu"] += 1

        with get_db() as db:
            for (bucket, team), b in buckets.items():
                n = b["n"]
                score = (b["pos"] - b["neg"]) / max(n, 1)
                metric = AggregatedMetric(
                    bucket_time     = bucket,
                    team_tag        = None if team == "__ALL__" else team,
                    tweet_count     = n,
                    positive_count  = b["pos"],
                    negative_count  = b["neg"],
                    neutral_count   = b["neu"],
                    avg_confidence  = b["conf_sum"] / n if n else 0,
                    sentiment_score = score,
                )
                db.merge(metric)

    def _on_event(self, event: DetectedEvent):
        """Persist detected match event to database."""
        with get_db() as db:
            db.add(MatchEvent(
                event_type      = event.event_type,
                timestamp       = event.timestamp,
                sentiment_shift = event.sentiment_shift,
                tweet_volume    = event.tweet_volume,
                team_tag        = event.team_tag,
                description     = event.description,
            ))
        logger.info("Persisted event: %s", event.event_type)


# ---------------------------------------------------------------------------
# Module-level singleton accessor
# ---------------------------------------------------------------------------

_pipeline = Pipeline()


def get_pipeline() -> Pipeline:
    return _pipeline
