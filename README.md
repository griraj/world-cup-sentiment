# ⚽ World Cup Sentiment Tracker

A production-grade real-time fan sentiment analytics platform for World Cup matches.
Ingests live tweets, runs NLP sentiment analysis, detects match events, and visualizes
emotional momentum on a live Plotly Dash dashboard.

---

## 🖥️ Dashboard Preview

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ⚽ WORLD CUP SENTIMENT                              ● LIVE   UTC 20:14:33 │
├──────┬──────┬──────┬──────┬──────┬──────────────────────────────────────── │
│Total │/min  │Pos%  │Neg%  │Mood  │Viral                                    │
│12,8k │ 42.5 │ 61%  │ 21%  │+0.40 │ 38                                      │
├──────┴──────┴──────┴──────┴──────┴──────────────────────────────────────── │
│  Sentiment Timeline 📊          │  ⚡ Crowd Momentum                       │
│  [Live line graph]              │  [Gauge: ELECTRIC 🔥]                    │
│                                 ├──────────────────────────────────────────│
│                                 │  🚨 Match Events                         │
│                                 │  ⚽ GOAL  – Positive spike +0.61         │
│                                 │  🟥 VAR   – Negative shift -0.38         │
├──────────────────┬──────────────┴──────────────────────────────────────────│
│ Tweet Volume 📈  │ Team Sentiment 🏟️ │ Trending Words 💬                  │
│ [Bar chart]      │ ARG vs BRA vs FRA │ messi neymar goal penalty VAR       │
├──────────────────┴───────────────────┴──────────────────────────────────── │
│  🐦 Live Tweet Feed                                                         │
│  [POS] Messi just nutmegged the entire defense omg 🔥 · @fan_4821 · 94%   │
│  [NEG] That red card was completely unjustified #VAR · @fan_7332 · 89%    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Architecture

```
Twitter Stream / Mock Generator
        │
        ▼
 ┌─────────────┐
 │ Tweet Queue  │  (in-process, bounded)
 └──────┬──────┘
        │  batch
        ▼
 ┌─────────────────────┐
 │  Sentiment Analyzer  │  (HuggingFace DistilBERT + Emotion model)
 └──────────┬──────────┘
            │
       ┌────┴────┐
       │         │
       ▼         ▼
 ┌──────────┐  ┌─────────────────┐
 │ Database  │  │  Event Detector  │
 │ (SQLite / │  │  (sliding window │
 │ Postgres) │  │   spike detect)  │
 └──────┬───┘  └────────┬────────┘
        │               │ persist events
        └───────┬───────┘
                ▼
        Plotly Dash Dashboard
        (auto-refresh every 3–30s)
```

---

## 📁 Project Structure

```
world_cup_sentiment/
├── app.py                          # Entry point
├── requirements.txt
├── .env.example                    # Template for secrets
├── Dockerfile
├── docker-compose.yml
│
├── backend/
│   ├── db/
│   │   └── models.py               # SQLAlchemy models (tweets, events, metrics)
│   ├── streaming/
│   │   └── stream.py               # Tweepy v2 stream + MockStreamManager
│   ├── sentiment/
│   │   └── analyzer.py             # HuggingFace sentiment + emotion pipeline
│   ├── events/
│   │   └── detector.py             # Sliding-window event detection
│   ├── pipeline.py                 # Orchestrator (queue + threads + DB)
│   └── dashboard_data.py           # Dashboard query layer
│
├── frontend/
│   └── dashboard.py                # Full Plotly Dash app + all callbacks
│
├── utils/
│   └── text_cleaner.py             # Tweet cleaning, spam filter, team tagging
│
├── tests/
│   └── test_pipeline.py            # pytest test suite
│
└── data/                           # Auto-created at runtime
    ├── sentiment.db                # SQLite database
    └── app.log                     # Application log
```

---

## 🚀 Quick Start

### Option A: Local (no Docker)

```bash
# 1. Clone and enter project
git clone https://github.com/you/world-cup-sentiment.git
cd world_cup_sentiment

# 2. Create virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.example .env
# Edit .env – for demo mode, USE_MOCK_STREAM=true (no API key needed)

# 5. Run!
python app.py
```

Open **http://localhost:8050** in your browser.

---

### Option B: Docker (recommended)

```bash
# 1. Build and start
docker-compose up --build

# 2. Open dashboard
open http://localhost:8050
```

---

### Option C: Live Twitter stream

1. Apply for a Twitter Developer account at https://developer.twitter.com
2. Create a project and app with **Filtered Stream** access
3. Copy your Bearer Token into `.env`:
   ```
   TWITTER_BEARER_TOKEN=AAAAAAAAAAAAAAAAAAAAAfoo...
   USE_MOCK_STREAM=false
   ```
4. Run `python app.py`

---

## ⚙️ Configuration

All settings live in `.env` (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `USE_MOCK_STREAM` | `true` | Use synthetic tweets (no API key) |
| `TWITTER_BEARER_TOKEN` | — | Twitter v2 Bearer Token |
| `SENTIMENT_MODEL` | `distilbert-base-uncased-finetuned-sst-2-english` | HuggingFace model |
| `EMOTION_MODEL` | `j-hartmann/emotion-english-distilroberta-base` | Emotion classifier |
| `DATABASE_URL` | `sqlite:///./data/sentiment.db` | SQLAlchemy DB URL |
| `PIPELINE_BATCH_SIZE` | `16` | Tweets per inference batch |
| `FLUSH_INTERVAL_SECONDS` | `2.0` | DB write interval |
| `VIRAL_LIKE_THRESHOLD` | `200` | Min likes to flag viral |
| `PORT` | `8050` | Dashboard port |

---

## 🧪 Running Tests

```bash
pytest tests/ -v
```

---

## 🌐 Deployment

### Render / Railway

```bash
# Set environment variables in Render/Railway dashboard
# Start command:
gunicorn app:server -w 2 -b 0.0.0.0:$PORT
```

### AWS / DigitalOcean (Docker)

```bash
docker build -t worldcup-sentiment .
docker run -p 8050:8050 --env-file .env worldcup-sentiment
```

### Kubernetes (bonus)

See `docker-compose.yml` for service definitions.
Adapt to K8s Deployments + Services + PersistentVolumeClaim for `/app/data`.

---

## 🔧 Extending the App

### Switch to PostgreSQL

```bash
# In .env:
DATABASE_URL=postgresql://user:pass@host:5432/worldcup
```

### Add a new NLP model

```python
# In backend/sentiment/analyzer.py, change:
SENTIMENT_MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest"
```

### Add Kafka streaming (bonus)

Install `confluent-kafka` and replace `MockStreamManager` with a Kafka consumer
that writes to the same `tweet_queue`.

---

## 📊 Database Schema

### `tweets`
| Column | Type | Description |
|---|---|---|
| `tweet_id` | VARCHAR | Unique tweet ID |
| `text` | TEXT | Raw tweet text |
| `cleaned_text` | TEXT | Cleaned for NLP |
| `created_at` | DATETIME | Tweet timestamp |
| `sentiment` | VARCHAR | POSITIVE/NEGATIVE/NEUTRAL |
| `confidence` | FLOAT | Model confidence score |
| `emotion` | VARCHAR | joy/anger/surprise/etc. |
| `team_tag` | VARCHAR | Detected team |
| `is_viral` | INT | 1 if likes ≥ threshold |

### `events`
| Column | Type | Description |
|---|---|---|
| `event_type` | VARCHAR | GOAL/RED_CARD/SPIKE/etc. |
| `timestamp` | DATETIME | Detection time |
| `sentiment_shift` | FLOAT | Delta in sentiment score |
| `tweet_volume` | INT | Tweets in detection window |

### `aggregated_metrics`
Per-minute bucketed stats for fast dashboard queries.

---

## 📜 License

MIT License. Build freely, deploy proudly.

---

*Built with ❤️ for football fans worldwide.*
