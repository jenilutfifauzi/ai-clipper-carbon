"""Candidates: proposed clips awaiting review."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Descriptions:
    """Posting copy per platform, without the hashtags."""

    tiktok: str
    instagram: str
    shorts: str


@dataclass(frozen=True)
class Candidate:
    # Set once, when Selection creates the Candidate; review edits address it by this.
    id: str
    # On the Source's timeline, from just before a Word's start to just after a Word's end.
    start: float
    end: float
    predicted_score: int
    hook_strength: int
    emotion: str
    reason: str
    retention_notes: str
    hook_text: str
    # Also the YouTube Shorts title.
    title: str
    descriptions: Descriptions
    hashtags: list[str]
    # The shortlisted Window it came from, and that Window's Score-pass score.
    window_id: str
    window_score: int | None
