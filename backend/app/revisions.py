"""Who saved a Candidate's Revisions, which of its parts each changed, and its Revision History
(ADR 0003)."""

from dataclasses import dataclass
from datetime import datetime

from app.candidates import Candidate

# The editors that save Candidates, as they name themselves; any other is unknown (a CLI run, an
# older caller).
SOURCES = frozenset({"advanced-edit", "clip-editor", "agent", "restore"})
UNKNOWN = "unknown"
# The source of a Candidate's first state in its Revision History: as Selection (or the owner, for a
# manual one) made it.
ORIGINAL = "original"
# The most entries a Revision History keeps, and how long after one save from an editor its next
# still goes into the same entry.
HISTORY_MAX = 50
GROUP_SECS = 120.0

# A Candidate's parts as the editors name them, each with the fields it is made of. Choosing it for
# rendering, its Revision and its edited flag aren't parts: they aren't edits.
PARTS: dict[str, tuple[str, ...]] = {
    "Range": ("start", "end"),
    "Segments": ("segments",),
    "Text Layers": ("text_layers",),
    "Music": ("music",),
    "Overlays": ("overlays",),
    "Transitions": ("transitions",),
    "Hook": ("hook_text", "hook_kicker", "hook_start", "hook_secs"),
    "Style": ("preset_id", "style_overrides"),
    "Word Edits": ("word_edits",),
    "Layout": ("layout",),
    "Layout Overrides": ("layout_overrides",),
    "Source volume": ("source_volume",),
}


@dataclass(frozen=True)
class Edit:
    """Who made a save: an editor (one of SOURCES, or unknown) and, for a browser's, its tab."""

    source: str = UNKNOWN
    tab: str | None = None

    @classmethod
    def of(cls, source: str | None, tab: str | None) -> "Edit":
        return cls(source if source in SOURCES else UNKNOWN, tab or None)


def changed_parts(old: Candidate, new: Candidate) -> list[str]:
    """The parts `new` has changed from `old`, in the order of PARTS."""
    return [part for part, names in PARTS.items() if any(getattr(old, name) != getattr(new, name) for name in names)]


@dataclass(frozen=True)
class HistoryEntry:
    """A state of a Candidate in its Revision History: the last of a stretch of saves from one editor
    (in one tab), with when it was saved and the parts changed since the entry before."""

    revision: int
    # None for a state whose save time isn't known (the Candidate as first made, say).
    at: datetime | None
    source: str
    tab: str | None
    parts: list[str]
    candidate: Candidate


def recorded(
    history: list[HistoryEntry],
    before: Candidate,
    after: Candidate,
    edit: Edit,
    before_saved: tuple[Edit, datetime | None],
    now: datetime,
) -> list[HistoryEntry]:
    """The Revision History (oldest first) once `edit` has saved `after` over `before`, which was
    saved by and at `before_saved`. A save from the editor and tab of the newest entry, soon after
    it, goes into it; any other starts an entry, and `before` is kept as one first if it isn't the
    newest."""
    entries = list(history)
    newest = entries[-1] if entries else None
    if newest is not None and newest.revision == before.revision:
        same_editor = (newest.source, newest.tab) == (edit.source, edit.tab)
        if same_editor and newest.at is not None and (now - newest.at).total_seconds() < GROUP_SECS:
            since = entries[-2].candidate if len(entries) > 1 else None
            parts = changed_parts(since, after) if since else _union(newest.parts, changed_parts(before, after))
            entries[-1] = HistoryEntry(after.revision, now, edit.source, edit.tab, parts, after)
            return entries[-HISTORY_MAX:]
    else:
        before_edit, before_at = before_saved
        source = ORIGINAL if before.revision == 1 else before_edit.source
        tab = None if before.revision == 1 else before_edit.tab
        entries.append(HistoryEntry(before.revision, before_at, source, tab, [], before))
    entries.append(HistoryEntry(after.revision, now, edit.source, edit.tab, changed_parts(before, after), after))
    return entries[-HISTORY_MAX:]


def _union(first: list[str], second: list[str]) -> list[str]:
    return [part for part in PARTS if part in first or part in second]
