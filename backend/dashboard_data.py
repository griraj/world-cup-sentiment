

import logging
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
from sqlalchemy import func, text

from backend.db.models import get_db, Tweet, MatchEvent, AggregatedMetric

logger = logging.getLogger(__name__)

# Gets sentiment timeline.
def get_sentiment_timeline(
    minutes: int = 30,
    team_tag: Optional[str] = None
) -> pd.DataFrame:
    
    cutoff = datetime.utcnow() - timedelta(minutes=minutes)

    with get_db() as db:
        q = db.query(AggregatedMetric).filter(
            AggregatedMetric.bucket_time >= cutoff
        )
        if team_tag:
            q = q.filter(AggregatedMetric.team_tag == team_tag)
        else:
            q = q.filter(AggregatedMetric.team_tag.is_(None))

        rows = q.order_by(AggregatedMetric.bucket_time).all()

    if not rows:
        return pd.DataFrame(columns=[
            "bucket_time", "sentiment_score", "tweet_count",
            "positive_count", "negative_count", "neutral_count"
        ])

    return pd.DataFrame([{
        "bucket_time":    r.bucket_time,
        "sentiment_score": r.sentiment_score or 0.0,
        "tweet_count":    r.tweet_count,
        "positive_count": r.positive_count,
        "negative_count": r.negative_count,
        "neutral_count":  r.neutral_count,
    } for r in rows])

# Gets volume timeline.
def get_volume_timeline(minutes: int = 30) -> pd.DataFrame:
    
    cutoff = datetime.utcnow() - timedelta(minutes=minutes)

    with get_db() as db:
        rows = (
            db.query(
                AggregatedMetric.bucket_time,
                func.sum(AggregatedMetric.tweet_count).label("tweet_count"),
            )
            .filter(
                AggregatedMetric.bucket_time >= cutoff,
                AggregatedMetric.team_tag.is_(None),
            )
            .group_by(AggregatedMetric.bucket_time)
            .order_by(AggregatedMetric.bucket_time)
            .all()
        )

    if not rows:
        return pd.DataFrame(columns=["bucket_time", "tweet_count"])

    return pd.DataFrame([{"bucket_time": r.bucket_time, "tweet_count": r.tweet_count} for r in rows])

# Gets team comparison.
def get_team_comparison(
    teams: list[str],
    minutes: int = 30
) -> pd.DataFrame:
    
    if not teams:
        return pd.DataFrame()

    cutoff = datetime.utcnow() - timedelta(minutes=minutes)

    with get_db() as db:
        rows = (
            db.query(AggregatedMetric)
            .filter(
                AggregatedMetric.bucket_time >= cutoff,
                AggregatedMetric.team_tag.in_(teams),
            )
            .order_by(AggregatedMetric.bucket_time)
            .all()
        )

    if not rows:
        return pd.DataFrame(columns=["bucket_time", "team_tag", "sentiment_score"])

    return pd.DataFrame([{
        "bucket_time":     r.bucket_time,
        "team_tag":        r.team_tag,
        "sentiment_score": r.sentiment_score or 0.0,
        "tweet_count":     r.tweet_count,
    } for r in rows])

# Gets live feed.
def get_live_feed(limit: int = 20) -> list[dict]:
    
    with get_db() as db:
        rows = (
            db.query(Tweet)
            .order_by(Tweet.created_at.desc())
            .limit(limit)
            .all()
        )
    return [r.to_dict() for r in rows]

# Gets summary stats.
def get_summary_stats(minutes: int = 5) -> dict:
    
    cutoff = datetime.utcnow() - timedelta(minutes=minutes)

    with get_db() as db:
        total = db.query(func.count(Tweet.id)).scalar() or 0
        recent = db.query(func.count(Tweet.id)).filter(Tweet.created_at >= cutoff).scalar() or 0
        pos    = db.query(func.count(Tweet.id)).filter(
            Tweet.created_at >= cutoff, Tweet.sentiment == "POSITIVE"
        ).scalar() or 0
        neg    = db.query(func.count(Tweet.id)).filter(
            Tweet.created_at >= cutoff, Tweet.sentiment == "NEGATIVE"
        ).scalar() or 0
        viral  = db.query(func.count(Tweet.id)).filter(Tweet.is_viral == 1).scalar() or 0

    score = (pos - neg) / max(recent, 1)
    return {
        "total_tweets":  total,
        "recent_tweets": recent,
        "positive_pct":  round(pos / max(recent, 1) * 100, 1),
        "negative_pct":  round(neg / max(recent, 1) * 100, 1),
        "sentiment_score": round(score, 3),
        "viral_tweets":  viral,
        "tweets_per_min": round(recent / minutes, 1),
    }

# Gets recent events.
def get_recent_events(limit: int = 10) -> list[dict]:
    
    with get_db() as db:
        rows = (
            db.query(MatchEvent)
            .order_by(MatchEvent.timestamp.desc())
            .limit(limit)
            .all()
        )
    return [r.to_dict() for r in rows]

# Gets word frequencies.
def get_word_frequencies(minutes: int = 10, top_n: int = 80) -> dict[str, int]:
    
    cutoff = datetime.utcnow() - timedelta(minutes=minutes)

    STOPWORDS = {
        "the", "a", "an", "is", "it", "in", "of", "to", "and", "for",
        "that", "this", "rt", "de", "la", "en", "with", "at", "on",
        "are", "was", "be", "have", "has", "he", "she", "they", "we",
        "you", "i", "my", "our", "his", "her", "but", "not", "so", "if",
        "worldcup", "fifaworldcup", "worldcup2026", "amp", "just", "get",
    }

    with get_db() as db:
        rows = (
            db.query(Tweet.cleaned_text)
            .filter(Tweet.created_at >= cutoff, Tweet.cleaned_text.isnot(None))
            .limit(500)
            .all()
        )

    freq: dict[str, int] = {}
    for (text,) in rows:
        if not text:
            continue
        for word in text.lower().split():
            w = word.strip(".,!?;:'\"()")
            if w and len(w) > 3 and w not in STOPWORDS and w.isalpha():
                freq[w] = freq.get(w, 0) + 1

    sorted_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:top_n]
    return dict(sorted_words)

# Gets momentum score.
def get_momentum_score(seconds: int = 30) -> float:
    
    cutoff = datetime.utcnow() - timedelta(seconds=seconds)

    with get_db() as db:
        rows = (
            db.query(Tweet.sentiment, Tweet.confidence, Tweet.created_at)
            .filter(Tweet.created_at >= cutoff)
            .all()
        )

    if not rows:
        return 0.0

    total_w, total_s = 0.0, 0.0
    now = datetime.utcnow()
    for sentiment, confidence, created_at in rows:
        age = max(0, (now - created_at).total_seconds())
        recency_weight = 1.0 / (1.0 + age / 10)
        w = (confidence or 0.5) * recency_weight
        if sentiment == "POSITIVE":
            v = 1.0
        elif sentiment == "NEGATIVE":
            v = -1.0
        else:
            v = 0.0
        total_s += v * w
        total_w += w

    return total_s / total_w if total_w else 0.0
