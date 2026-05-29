

import re
import unicodedata
import logging
from typing import Optional

logger = logging.getLogger(__name__)

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

# Cleans text.
def clean_text(text: str, keep_hashtags: bool = True) -> str:
    
    if not text:
        return ""

    text = _RT_RE.sub("", text)
    text = _URL_RE.sub(" ", text)
    text = _MENTION_RE.sub(" ", text)

    if keep_hashtags:

        text = _HASHTAG_RE.sub(r"\1 ", text)
    else:
        text = _HASHTAG_RE.sub(" ", text)

    text = unicodedata.normalize("NFKD", text)

    text = _SPECIAL_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()

    return text

# Handles is spam.
def is_spam(text: str, min_length: int = 10) -> bool:
    
    if not text or len(text) < min_length:
        return True

    alpha_chars = [c for c in text if c.isalpha()]
    if alpha_chars and sum(c.isupper() for c in alpha_chars) / len(alpha_chars) > 0.9:
        return True

    words = text.lower().split()
    if len(words) > 3 and len(set(words)) / len(words) < 0.3:
        return True

    return False

# Detects team tag.
def detect_team_tag(text: str) -> Optional[str]:
    
    lower = text.lower()
    for team, keywords in TEAM_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return team
    return None

# Handles is retweet.
def is_retweet(raw_text: str) -> bool:
    
    return bool(_RT_RE.match(raw_text.strip()))

# Handles extract hashtags.
def extract_hashtags(text: str) -> list[str]:
    
    return _HASHTAG_RE.findall(text.lower())
