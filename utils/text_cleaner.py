"""
Text cleaning and preprocessing utilities for tweet normalization.
"""

import re
import unicodedata
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Compile regex patterns once
_URL_RE       = re.compile(r"https?://\S+|www\.\S+")
_MENTION_RE   = re.compile(r"@\w+")
_HASHTAG_RE   = re.compile(r"#(\w+)")
_RT_RE        = re.compile(r"^RT\s+", re.IGNORECASE)
_EMOJI_RE     = re.compile(
    "[\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251]+",
    flags=re.UNICODE
)
_WHITESPACE_RE = re.compile(r"\s+")
_SPECIAL_RE    = re.compile(r"[^\w\s#@!?.,'-]")

# Keywords for team tagging
TEAM_KEYWORDS: dict[str, list[str]] = {
    "Argentina": ["argentina", "arg", "messi", "albiceleste", "scaloni", "dibu"],
    "Brazil":    ["brazil", "brasil", "bra", "neymar", "selecao", "samba"],
    "France":    ["france", "fra", "mbappe", "les bleus", "griezmann"],
    "England":   ["england", "eng", "kane", "three lions", "southgate"],
    "Germany":   ["germany", "ger", "deutschland", "muller", "neuer"],
    "Spain":     ["spain", "esp", "pedri", "morata", "la roja"],
    "Portugal":  ["portugal", "por", "ronaldo", "cr7", "pepe"],
    "Morocco":   ["morocco", "mar", "hakimi", "atlas lions"],
    "Japan":     ["japan", "jpn", "samurai blue"],
    "USA":       ["usa", "usmnt", "pulisic", "berhalter"],
}


def clean_text(text: str, keep_hashtags: bool = True) -> str:
    """
    Normalize a raw tweet for NLP inference.

    Steps:
        1. Strip retweet prefix
        2. Remove URLs
        3. Remove @mentions
        4. Optionally keep/strip hashtag words
        5. Normalize unicode
        6. Collapse whitespace
    """
    if not text:
        return ""

    text = _RT_RE.sub("", text)
    text = _URL_RE.sub(" ", text)
    text = _MENTION_RE.sub(" ", text)

    if keep_hashtags:
        # Keep the word part of hashtags for sentiment signal
        text = _HASHTAG_RE.sub(r"\1 ", text)
    else:
        text = _HASHTAG_RE.sub(" ", text)

    # Normalize unicode (accents, etc.)
    text = unicodedata.normalize("NFKD", text)

    # Remove lingering special chars but keep punctuation
    text = _SPECIAL_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()

    return text


def is_spam(text: str, min_length: int = 10) -> bool:
    """
    Heuristic spam / low-quality filter.

    Returns True if the tweet should be dropped.
    """
    if not text or len(text) < min_length:
        return True

    # All caps (shouting spam)
    alpha_chars = [c for c in text if c.isalpha()]
    if alpha_chars and sum(c.isupper() for c in alpha_chars) / len(alpha_chars) > 0.9:
        return True

    # Excessive repetition
    words = text.lower().split()
    if len(words) > 3 and len(set(words)) / len(words) < 0.3:
        return True

    return False


def detect_team_tag(text: str) -> Optional[str]:
    """
    Return the most likely team mentioned in the text, or None.
    Priority: first match in iteration order.
    """
    lower = text.lower()
    for team, keywords in TEAM_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return team
    return None


def is_retweet(raw_text: str) -> bool:
    """Return True if the raw tweet text is a retweet."""
    return bool(_RT_RE.match(raw_text.strip()))


def extract_hashtags(text: str) -> list[str]:
    """Return list of hashtag strings (without #)."""
    return _HASHTAG_RE.findall(text.lower())
