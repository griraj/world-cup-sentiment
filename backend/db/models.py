

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

# Handles set sqlite pragma.
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=-64000")              
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
    
    __tablename__ = "tweets"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    tweet_id    = Column(String(64), unique=True, nullable=False)
    username    = Column(String(128), nullable=True)
    text        = Column(Text, nullable=False)
    cleaned_text= Column(Text, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
    sentiment   = Column(String(16), nullable=True)                                  
    confidence  = Column(Float, nullable=True)
    emotion     = Column(String(32), nullable=True)                                    
    team_tag    = Column(String(64), nullable=True)
    language    = Column(String(8), nullable=True)
    retweet_count = Column(Integer, default=0)
    like_count  = Column(Integer, default=0)
    is_viral    = Column(Integer, default=0)            

    __table_args__ = (
        Index("ix_tweets_created_at", "created_at"),
        Index("ix_tweets_sentiment", "sentiment"),
        Index("ix_tweets_team_tag", "team_tag"),
    )

    # Handles to dict.
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
    
    __tablename__ = "events"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    event_type      = Column(String(64), nullable=False)                                   
    timestamp       = Column(DateTime, default=datetime.utcnow, nullable=False)
    sentiment_shift = Column(Float, nullable=True)                                    
    tweet_volume    = Column(Integer, nullable=True)                                    
    team_tag        = Column(String(64), nullable=True)
    description     = Column(Text, nullable=True)

    __table_args__ = (
        Index("ix_events_timestamp", "timestamp"),
    )

    # Handles to dict.
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
    
    __tablename__ = "aggregated_metrics"

    id              = Column(Integer, primary_key=True, autoincrement=True)
    bucket_time     = Column(DateTime, nullable=False)                         
    team_tag        = Column(String(64), nullable=True)
    tweet_count     = Column(Integer, default=0)
    positive_count  = Column(Integer, default=0)
    negative_count  = Column(Integer, default=0)
    neutral_count   = Column(Integer, default=0)
    avg_confidence  = Column(Float, nullable=True)
    sentiment_score = Column(Float, nullable=True)                              

    __table_args__ = (
        Index("ix_metrics_bucket", "bucket_time"),
        Index("ix_metrics_team", "team_tag", "bucket_time"),
    )

# Initializes db.
def init_db():
    
    os.makedirs("data", exist_ok=True)
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created/verified.")

@contextmanager
# Gets db.
def get_db() -> Session:
    
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
