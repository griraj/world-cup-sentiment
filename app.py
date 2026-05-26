"""
World Cup Sentiment Tracker – Application Entry Point

Usage:
    python app.py                        # Full app (mock stream)
    USE_MOCK_STREAM=false python app.py  # Live Twitter stream (requires .env)
    python app.py --port 8080            # Custom port
"""

import os
import sys
import logging
import argparse
from dotenv import load_dotenv

# Load .env before anything else
load_dotenv()

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("data/app.log", mode="a"),
    ],
)

# Silence noisy libraries
logging.getLogger("tweepy").setLevel(logging.WARNING)
logging.getLogger("transformers").setLevel(logging.WARNING)
logging.getLogger("werkzeug").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="World Cup Sentiment Tracker")
    parser.add_argument("--port",  type=int, default=int(os.getenv("PORT", "8050")))
    parser.add_argument("--host",  default=os.getenv("HOST", "0.0.0.0"))
    parser.add_argument("--debug", action="store_true", default=os.getenv("DEBUG", "false").lower() == "true")
    args = parser.parse_args()

    os.makedirs("data", exist_ok=True)

    logger.info("=" * 60)
    logger.info("  ⚽  World Cup Sentiment Tracker")
    logger.info("=" * 60)
    logger.info("  Mock stream : %s", os.getenv("USE_MOCK_STREAM", "true"))
    logger.info("  Port        : %d", args.port)
    logger.info("  Debug       : %s", args.debug)
    logger.info("=" * 60)

    # Start data pipeline (stream + sentiment + DB)
    from backend.pipeline import get_pipeline
    pipeline = get_pipeline()
    pipeline.start()

    # Build and run Dash dashboard
    from frontend.dashboard import create_app
    app = create_app()

    # Expose the underlying Flask server for production WSGI deployment
    server = app.server

    app.run(
        host=args.host,
        port=args.port,
        debug=args.debug,
        use_reloader=False,  # Prevent double-start in debug mode
    )


if __name__ == "__main__":
    main()
