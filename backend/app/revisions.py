"""Who saved a Candidate's Revisions, and which of its parts each changed (ADR 0003)."""

from dataclasses import dataclass

from app.candidates import Candidate

# The editors that save Candidates, as they name themselves; any other is unknown (a CLI run, an
# older caller).
SOURCES = frozenset({"advanced-edit", "clip-editor", "agent", "restore"})
UNKNOWN = "unknown"

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
