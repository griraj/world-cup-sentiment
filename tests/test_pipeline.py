

import pytest
import queue
import time
from datetime import datetime
from unittest.mock import MagicMock, patch

class TestTextCleaner:
    # Handles test removes urls.
    def test_removes_urls(self):
        from utils.text_cleaner import clean_text
        result = clean_text("Check this out https://t.co/abc123 great goal!")
        assert "https" not in result
        assert "great goal" in result

    # Handles test removes mentions.
    def test_removes_mentions(self):
        from utils.text_cleaner import clean_text
        result = clean_text("@Messi what a player! Amazing goal!")
        assert "@Messi" not in result

    # Handles test keeps hashtag words.
    def test_keeps_hashtag_words(self):
        from utils.text_cleaner import clean_text
        result = clean_text("#WorldCup is amazing", keep_hashtags=True)
        assert "WorldCup" in result

    # Handles test removes rt prefix.
    def test_removes_rt_prefix(self):
        from utils.text_cleaner import clean_text
        result = clean_text("RT @someone: This is great")
        assert result.startswith("RT") is False

    # Handles test is retweet detection.
    def test_is_retweet_detection(self):
        from utils.text_cleaner import is_retweet
        assert is_retweet("RT @user: some tweet") is True
        assert is_retweet("This is not a retweet") is False

    # Handles test spam filter short.
    def test_spam_filter_short(self):
        from utils.text_cleaner import is_spam
        assert is_spam("hi") is True
        assert is_spam("Messi scored an amazing goal in extra time!") is False

    # Handles test spam filter repetition.
    def test_spam_filter_repetition(self):
        from utils.text_cleaner import is_spam
        assert is_spam("goal goal goal goal goal goal goal goal") is True

    # Handles test team detection argentina.
    def test_team_detection_argentina(self):
        from utils.text_cleaner import detect_team_tag
        assert detect_team_tag("Messi is the GOAT #WorldCup") == "Argentina"

    # Handles test team detection brazil.
    def test_team_detection_brazil(self):
        from utils.text_cleaner import detect_team_tag
        assert detect_team_tag("Neymar injured again, so sad") == "Brazil"

    # Handles test team detection none.
    def test_team_detection_none(self):
        from utils.text_cleaner import detect_team_tag
        assert detect_team_tag("What a great match today!") is None

    # Handles test extract hashtags.
    def test_extract_hashtags(self):
        from utils.text_cleaner import extract_hashtags
        tags = extract_hashtags("Love #WorldCup and #Argentina tonight!")
        assert "worldcup" in tags
        assert "argentina" in tags

class TestEventDetector:
    # Handles test no event on low volume.
    def test_no_event_on_low_volume(self):
        from backend.events.detector import EventDetector, TweetSignal
        detector = EventDetector()
        events = []
        detector.register_callback(lambda e: events.append(e))

        for _ in range(3):
            detector.ingest(TweetSignal(
                timestamp=datetime.utcnow(),
                sentiment="NEUTRAL",
                confidence=0.7,
                team_tag=None,
            ))
        assert len(events) == 0

    # Handles test sentiment shift detection.
    def test_sentiment_shift_detection(self):
        from backend.events.detector import EventDetector, TweetSignal, SENTIMENT_SHIFT_DELTA
        detector = EventDetector()
        events = []
        detector.register_callback(lambda e: events.append(e))

        now = datetime.utcnow()
        for _ in range(10):
            detector.ingest(TweetSignal(timestamp=now, sentiment="POSITIVE", confidence=0.95, team_tag=None))

        initial_score = detector._last_sentiment_score
        assert initial_score is not None
        assert initial_score > 0

    # Handles test dominant team.
    def test_dominant_team(self):
        from backend.events.detector import EventDetector, TweetSignal
        signals = [
            TweetSignal(datetime.utcnow(), "POSITIVE", 0.9, "Argentina"),
            TweetSignal(datetime.utcnow(), "POSITIVE", 0.9, "Argentina"),
            TweetSignal(datetime.utcnow(), "NEUTRAL", 0.6, "Brazil"),
        ]
        assert EventDetector._dominant_team(signals) == "Argentina"

    # Handles test sentiment score all positive.
    def test_sentiment_score_all_positive(self):
        from backend.events.detector import EventDetector, TweetSignal
        signals = [
            TweetSignal(datetime.utcnow(), "POSITIVE", 1.0, None),
            TweetSignal(datetime.utcnow(), "POSITIVE", 1.0, None),
        ]
        score = EventDetector._compute_score(signals)
        assert score == pytest.approx(1.0)

    # Handles test sentiment score mixed.
    def test_sentiment_score_mixed(self):
        from backend.events.detector import EventDetector, TweetSignal
        signals = [
            TweetSignal(datetime.utcnow(), "POSITIVE", 1.0, None),
            TweetSignal(datetime.utcnow(), "NEGATIVE", 1.0, None),
        ]
        score = EventDetector._compute_score(signals)
        assert score == pytest.approx(0.0)

class TestMockStream:
    # Handles test produces tweets.
    def test_produces_tweets(self):
        from backend.streaming.stream import MockStreamManager
        q = queue.Queue(maxsize=100)
        mgr = MockStreamManager(q, delay=0.05)
        mgr.start()
        time.sleep(0.5)
        mgr.stop()
        assert not q.empty()

    # Handles test tweet payload structure.
    def test_tweet_payload_structure(self):
        from backend.streaming.stream import MockStreamManager
        q = queue.Queue(maxsize=100)
        mgr = MockStreamManager(q, delay=0.05)
        mgr.start()
        time.sleep(0.3)
        mgr.stop()

        tweet = q.get(timeout=1)
        assert "tweet_id" in tweet
        assert "text" in tweet
        assert "cleaned_text" in tweet
        assert "created_at" in tweet
        assert isinstance(tweet["created_at"], datetime)

class TestDatabase:
    # Handles test init creates tables.
    def test_init_creates_tables(self, tmp_path):
        import os
        os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path}/test.db"

        import importlib
        import backend.db.models as models_module
        importlib.reload(models_module)
        models_module.init_db()

        from sqlalchemy import inspect
        inspector = inspect(models_module.engine)
        tables = inspector.get_table_names()
        assert "tweets" in tables
        assert "events" in tables
        assert "aggregated_metrics" in tables

    # Handles test tweet to dict.
    def test_tweet_to_dict(self):
        from backend.db.models import Tweet
        t = Tweet(
            tweet_id="123",
            text="Test tweet",
            sentiment="POSITIVE",
            confidence=0.92,
            created_at=datetime.utcnow(),
        )
        d = t.to_dict()
        assert d["tweet_id"] == "123"
        assert d["sentiment"] == "POSITIVE"
        assert d["confidence"] == pytest.approx(0.92, abs=0.001)

class TestSentimentAnalyzer:
    # Handles test fallback on no model.
    def test_fallback_on_no_model(self):
        
        from backend.sentiment.analyzer import SentimentService
        svc = SentimentService.__new__(SentimentService)
        svc._initialized = True
        svc._sentiment_pipe = None
        svc._emotion_pipe = None

        results = svc.analyze_batch(["Hello world"])
        assert results[0].sentiment == "NEUTRAL"
        assert results[0].confidence == 0.5

    # Handles test batch empty input.
    def test_batch_empty_input(self):
        from backend.sentiment.analyzer import SentimentService
        svc = SentimentService.__new__(SentimentService)
        svc._initialized = True
        svc._sentiment_pipe = None
        svc._emotion_pipe = None

        results = svc.analyze_batch([])
        assert results == []

    # Handles test result dataclass fields.
    def test_result_dataclass_fields(self):
        from backend.sentiment.analyzer import SentimentResult
        r = SentimentResult(sentiment="POSITIVE", confidence=0.88, emotion="joy", emotion_score=0.75)
        assert r.sentiment == "POSITIVE"
        assert r.emotion == "joy"
