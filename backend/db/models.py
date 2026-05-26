"""
Database models and connection layer for World Cup Sentiment Tracker.
Uses SQLAlchemy with SQLite (swappable to PostgreSQL via env var).
"""

import os
import logging
from datetime import datetime
from contextlib import contextmanager

from sqlalchemy import (
    create_engine, Column, Integer, String, Float,
    DateTime, Text, Index, event
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy.pool import StaticPool

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/sentiment.db")

# SQLite performance tuning
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=-64000")  # 64MB cache
    cursor.close()

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
    poolclass=StaticPool if "sqlite" in DATABASE_URL else None,
)

if "sqlite" in DATABASE_URL:
    event.listen(engine, "connect", _set_sqlite_pragma)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Tweet(Base):
    """Stores cleaned, analyzed tweets."""
    __tablename__ = "tweets"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    tweet_id    = Column(String(64), unique=True, nullable=False)
    username    = Column(String(128), nullable=True)
    text        = Column(Text, nullable=False)
    cleaned_text= Column(Text, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
    sentiment   = Column(String(16), nullable=True)   # POSITIVE / NEGATIVE / NEUTRAL
    confidence  = Column(Float, nullable=True)
    emotion     = Column(String(32), nullable=True)   # joy / anger / excitement / etc.
    team_tag    = Column(String(64), nullable=True)
    language    = Column(String(8), nullable=True)
    retweet_count = Column(Integer, default=0)
    like_count  = Column(Integer, default=0)
    is_viral    = Column(Integer, default=0)  # 0/1 flag

    __table_args__ = (
        Index("ix_tweets_created_at", "created_at"),
        Index("ix_tweets_sentiment", "sentiment"),
        Index("ix_tweets_team_tag", "team_tag"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "tweet_id": self.tweet_id,
            "username": self.username,
            "text": self.text,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "sentiment": self.sentiment,
            "confidence": round(self.confidence, 4) if self.confidence else None,
            "emotion": self.emotion,
            "team_tag": self.team_tag,
            "language": self.language,
            "is_viral": bool(self.is_viral),
        }


class MatchEvent(Base):
    """Detected match events (goals, cards, VAR spikes)."""
    __tablename__ = "events"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    event_type      = Column(String(64), nullable=False)   # GOAL / RED_CARD / SPIKE / etc.
    timestamp       = Column(DateTime, default=datetime.utcnow, nullable=False)
    sentiment_shift = Column(Float, nullable=True)          # delta in sentiment score
    tweet_volume    = Column(Integer, nullable=True)        # tweets in detection window
    team_tag        = Column(String(64), nullable=True)
    description     = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_events_timestamp", "timestamp"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "event_type": self.event_type,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "sentiment_shift": self.sentiment_shift,
            "tweet_volume": self.tweet_volume,
            "team_tag": self.team_tag,
            "description": self.description,
        }


class AggregatedMetric(Base):
    """Per-minute bucketed aggregations for fast dashboard queries."""
    __tablename__ = "aggregated_metrics"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    bucket_time     = Column(DateTime, nullable=False)      # floored to minute
    team_tag        = Column(String(64), nullable=True)
    tweet_count     = Column(Integer, default=0)
    positive_count  = Column(Integer, default=0)
    negative_count  = Column(Integer, default=0)
    neutral_count   = Column(Integer, default=0)
    avg_confidence  = Column(Float, nullable=True)
    sentiment_score = Column(Float, nullable=True)          # -1 to +1 composite

    __table_args__ = (
        Index("ix_metrics_bucket", "bucket_time"),
        Index("ix_metrics_team", "team_tag", "bucket_time"),
    )


def init_db():
    """Create all tables."""
    os.makedirs("data", exist_ok=True)
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created/verified.")


@contextmanager
def get_db() -> Session:
    """Context manager for database sessions."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
