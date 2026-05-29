

import os
import json
import time
import queue
import logging
import threading
from datetime import datetime
from typing import Optional

import tweepy

from utils.text_cleaner import clean_text, is_spam, is_retweet, detect_team_tag

logger = logging.getLogger(__name__)

BEARER_TOKEN     = os.getenv("TWITTER_BEARER_TOKEN", "")
API_KEY          = os.getenv("TWITTER_API_KEY", "")
API_SECRET       = os.getenv("TWITTER_API_SECRET", "")
ACCESS_TOKEN     = os.getenv("TWITTER_ACCESS_TOKEN", "")
ACCESS_SECRET    = os.getenv("TWITTER_ACCESS_SECRET", "")

STREAM_RULES = [
    tweepy.StreamRule("#WorldCup"),
    tweepy.StreamRule("#FIFAWorldCup"),
    tweepy.StreamRule("#Qatar2022 OR #WorldCup2026"),
    tweepy.StreamRule("Messi OR Mbappe OR Ronaldo OR Neymar lang:en"),
    tweepy.StreamRule("Goal OR scored OR penalty OR redcard OR VAR lang:en"),
    tweepy.StreamRule("#Argentina OR #Brazil OR #France OR #England"),
    tweepy.StreamRule("#Germany OR #Spain OR #Portugal OR #Morocco"),
]

TWEET_FIELDS = ["created_at", "author_id", "lang", "public_metrics", "text"]
EXPANSIONS   = ["author_id"]
USER_FIELDS  = ["username"]

class WorldCupStream(tweepy.StreamingClient):
    

    # Initializes __init__.
    def __init__(self, tweet_queue: queue.Queue, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._queue       = tweet_queue
        self._seen_ids    = set()                        
        self._seen_lock   = threading.Lock()
        self._max_seen    = 50_000                                                     

    # Handles on tweet.
    def on_tweet(self, tweet: tweepy.Tweet):
        try:
            self._process(tweet)
        except Exception as e:
            logger.exception("Error processing tweet %s: %s", tweet.id, e)

    # Handles on includes.
    def on_includes(self, includes):

        if "users" in includes:
            self._users = {u.id: u.username for u in includes["users"]}

    # Handles on errors.
    def on_errors(self, errors):
        for err in errors:
            logger.warning("Stream error: %s", err)

    # Handles on connection error.
    def on_connection_error(self):
        logger.error("Stream connection error – Tweepy will retry automatically.")

    # Handles on request error.
    def on_request_error(self, status_code):
        logger.error("HTTP %s on stream request.", status_code)
        if status_code == 429:
            logger.warning("Rate limited – sleeping 60s before reconnect.")
            time.sleep(60)

    # Handles on disconnect.
    def on_disconnect(self):
        logger.warning("Stream disconnected.")

    # Processes _process.
    def _process(self, tweet: tweepy.Tweet):
        text = tweet.text or ""

        if is_retweet(text):
            return

        tweet_id = str(tweet.id)
        with self._seen_lock:
            if tweet_id in self._seen_ids:
                return
            self._seen_ids.add(tweet_id)

            if len(self._seen_ids) > self._max_seen:
                self._seen_ids = set(list(self._seen_ids)[-self._max_seen // 2:])

        if is_spam(text):
            return

        cleaned = clean_text(text)
        team_tag = detect_team_tag(text)

        metrics = tweet.public_metrics or {}

        payload = {
            "tweet_id":      tweet_id,
            "username":      getattr(self, "_users", {}).get(tweet.author_id, "unknown"),
            "text":          text,
            "cleaned_text":  cleaned,
            "created_at":    tweet.created_at or datetime.utcnow(),
            "team_tag":      team_tag,
            "language":      tweet.lang,
            "retweet_count": metrics.get("retweet_count", 0),
            "like_count":    metrics.get("like_count", 0),
        }

        try:
            self._queue.put_nowait(payload)
        except queue.Full:
            logger.warning("Tweet queue full – dropping tweet %s", tweet_id)

class StreamManager:
    

    # Initializes __init__.
    def __init__(self, tweet_queue: queue.Queue):
        if not BEARER_TOKEN:
            raise EnvironmentError(
                "TWITTER_BEARER_TOKEN is required. Set it in your .env file."
            )
        self._queue  = tweet_queue
        self._stream: Optional[WorldCupStream] = None
        self._thread: Optional[threading.Thread] = None

    # Handles setup rules.
    def setup_rules(self):
        
        client = tweepy.StreamingClient(BEARER_TOKEN)

        existing = client.get_rules()
        if existing.data:
            ids = [r.id for r in existing.data]
            client.delete_rules(ids)
            logger.info("Deleted %d old stream rules.", len(ids))

        client.add_rules(STREAM_RULES)
        logger.info("Added %d stream rules.", len(STREAM_RULES))

    # Starts start.
    def start(self):
        
        self.setup_rules()
        self._stream = WorldCupStream(
            bearer_token=BEARER_TOKEN,
            tweet_queue=self._queue,
            wait_on_rate_limit=True,
            max_retries=10,
        )
        self._thread = threading.Thread(
            target=self._run_stream,
            name="TweetStream",
            daemon=True,
        )
        self._thread.start()
        logger.info("Tweet stream started.")

    # Runs stream.
    def _run_stream(self):
        while True:
            try:
                self._stream.filter(
                    tweet_fields=TWEET_FIELDS,
                    expansions=EXPANSIONS,
                    user_fields=USER_FIELDS,
                )
            except Exception as e:
                logger.error("Stream crashed: %s – restarting in 15s", e)
                time.sleep(15)

    # Stops stop.
    def stop(self):
        if self._stream:
            self._stream.disconnect()
        logger.info("Tweet stream stopped.")

class MockStreamManager:
    

    SAMPLE_TWEETS = [
        ("Argentina scores!! GOOOAL MESSI IS INSANE 🔥🔥🔥", "Argentina"),
        ("What a save by the goalkeeper omg", "Brazil"),
        ("VAR overturned the goal, this is absolute trash", "France"),
        ("Mbappe just nutmegged three defenders and scored 🎉", "France"),
        ("Terrible refereeing. Red card was way too harsh #WorldCup", None),
        ("Ronaldo's free kick hit the post nooooo 😭", "Portugal"),
        ("Brazil is controlling the midfield completely right now", "Brazil"),
        ("PENALTY! Argentina wins a penalty in extra time!", "Argentina"),
        ("That tackle deserved a red card, disgraceful", None),
        ("England looking really nervous in defense", "England"),
        ("The atmosphere in the stadium is electric right now! ⚡", None),
        ("Germany pressing hard but can't find the breakthrough", "Germany"),
        ("Morocco fans are absolutely incredible today 🇲🇦", "Morocco"),
        ("Neymar with a backheel assist, genius 👏", "Brazil"),
        ("Offside? Looked fine to me. VAR is ruining football", None),
        ("Spain's possession game is boring but effective", "Spain"),
        ("What a match! This is why we love the World Cup ❤️", None),
        ("Kane hits the post with a header! So close for England!", "England"),
        ("Terrible game so far, both teams afraid to attack", None),
        ("Messi just won the ball back in his own half at 35 years old 😳", "Argentina"),
    ]

    # Initializes __init__.
    def __init__(self, tweet_queue: queue.Queue, delay: float = 0.8):
        self._queue  = tweet_queue
        self._delay  = delay
        self._thread: Optional[threading.Thread] = None
        self._stop   = threading.Event()
        self._counter = 0

    # Starts start.
    def start(self):
        self._thread = threading.Thread(
            target=self._run, name="MockStream", daemon=True
        )
        self._thread.start()
        logger.info("Mock tweet stream started (no API key mode).")

    # Runs _run.
    def _run(self):
        import random
        while not self._stop.is_set():
            text, team = random.choice(self.SAMPLE_TWEETS)

            likes = random.randint(0, 50)
            if random.random() < 0.05:
                likes = random.randint(500, 5000)

            payload = {
                "tweet_id":      f"mock_{self._counter}",
                "username":      f"fan_{random.randint(1000, 9999)}",
                "text":          text,
                "cleaned_text":  clean_text(text),
                "created_at":    datetime.utcnow(),
                "team_tag":      team,
                "language":      "en",
                "retweet_count": random.randint(0, 100),
                "like_count":    likes,
            }
            self._counter += 1
            try:
                self._queue.put_nowait(payload)
            except queue.Full:
                pass

            if random.random() < 0.08:                      
                time.sleep(self._delay * 0.1)
            else:
                time.sleep(self._delay + random.uniform(-0.2, 0.4))

    # Stops stop.
    def stop(self):
        self._stop.set()
        logger.info("Mock stream stopped.")
