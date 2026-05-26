# ─────────────────────────────────────────────────────
#  World Cup Sentiment Tracker – Dockerfile
#  Multi-stage build: slim production image
# ─────────────────────────────────────────────────────

FROM python:3.11-slim AS base

# System deps for torch + transformers
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Install Python deps ───────────────────────────────
COPY requirements.txt .

# Install CPU-only torch first (smaller image)
RUN pip install --no-cache-dir \
    torch==2.2.2+cpu \
    --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir -r requirements.txt

# Pre-download HuggingFace models at build time
# (avoids cold-start delay at runtime)
RUN python -c "\
from transformers import pipeline; \
pipeline('sentiment-analysis', model='distilbert-base-uncased-finetuned-sst-2-english'); \
print('Sentiment model cached.')"

RUN python -c "\
from transformers import pipeline; \
pipeline('text-classification', model='j-hartmann/emotion-english-distilroberta-base'); \
print('Emotion model cached.')" || echo "Emotion model cache skipped (optional)."

# ── Copy application source ───────────────────────────
COPY . .

# Create data directory
RUN mkdir -p data

# ── Runtime ───────────────────────────────────────────
EXPOSE 8050

ENV USE_MOCK_STREAM=true
ENV PORT=8050
ENV HOST=0.0.0.0

CMD ["python", "app.py"]
