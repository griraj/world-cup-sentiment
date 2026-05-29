

import os
import sys
import logging
import argparse
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("data/app.log", mode="a"),
    ],
)

logging.getLogger("tweepy").setLevel(logging.WARNING)
logging.getLogger("transformers").setLevel(logging.WARNING)
logging.getLogger("werkzeug").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# Handles main.
def main():
    parser = argparse.ArgumentParser(description="World Cup Sentiment Tracker")
    parser.add_argument("--port",  type=int, default=int(os.getenv("PORT", "8050")))
    parser.add_argument("--host",  default=os.getenv("HOST", "0.0.0.0"))
    parser.add_argument("--debug", action="store_true", default=os.getenv("DEBUG", "false").lower() == "true")
    args = parser.parse_args()

    os.makedirs("data", exist_ok=True)

    logger.info("  ⚽  World Cup Sentiment Tracker")

    logger.info("  Mock stream : %s", os.getenv("USE_MOCK_STREAM", "true"))
    logger.info("  Port        : %d", args.port)
    logger.info("  Debug       : %s", args.debug)
    logger.info("=" * 60)

    from backend.pipeline import get_pipeline
    pipeline = get_pipeline()
    pipeline.start()

    from frontend.dashboard import create_app
    app = create_app()

    server = app.server

    app.run(
        host=args.host,
        port=args.port,
        debug=args.debug,
        use_reloader=False,                                      
    )

if __name__ == "__main__":
    main()
