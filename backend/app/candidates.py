"""Candidates: proposed clips awaiting review."""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Annotated

from pydantic import Field, FiniteFloat, StringConstraints

from app.fonts import DEFAULT_FONT
from app.styles import DEFAULT_PRESET, Animation, Colour, FontId, StyleOverrides

# The longest text a Word Edit gives a Word.
WORD_EDIT_MAX_CHARS = 40


# The longest hook text, its Emphasis marks included, and the longest Kicker (a word or two over
# the hook). The UI warns well before the hook's limit, once the Preview Plan sets the hook smaller
# than its style's size.
HOOK_MAX_CHARS = 200
KICKER_MAX_CHARS = 24
# The longest text a Text Layer holds, its newlines included.
TEXT_LAYER_MAX_CHARS = 300


@dataclass(frozen=True)
class Descriptions:
    """Posting copy per platform, without the hashtags."""

    tiktok: str
    instagram: str
    shorts: str


class Origin(StrEnum):
    # Proposed by Selection.
    AI = "ai"
    # Added by the owner from a transcript range: no AI score, reasoning or copy.
    MANUAL = "manual"


class Layout(StrEnum):
    """How the clip is framed. Auto lets the Render Planner choose per scene; the others replace its
    choice for every scene."""

    AUTO = "auto"
    TRACK = "track"
    SPLIT = "split"
    BLUR = "blur"


@dataclass(frozen=True)
class WordEdit:
    """The owner's correction of one caption Word: the Word whose span holds `at` (seconds on the
    Source's timeline), or failing that the nearest within WORD_EDIT_REACH_SECS (app/planner.py).
    `text` replaces the Word's text (None keeps it; empty removes the Word), and `break_before`
    starts a caption line at it. Keyed by time, not by the Word's place, since a Clip's Words are
    transcribed again when its range changes."""

    at: FiniteFloat
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=WORD_EDIT_MAX_CHARS)] | None = None
    break_before: bool = False


@dataclass(frozen=True)
class LayoutOverride:
    """The Layout of the one Scene (as planned, short ones merged) that holds `at`, seconds on the
    Source's timeline, in place of the Candidate's Layout there. Auto chooses that Scene's by its
    faces even where the Candidate's Layout is forced."""

    at: FiniteFloat
    layout: Layout


class TextAlign(StrEnum):
    """How a Text Layer's lines line up with each other."""

    CENTER = "center"
    LEFT = "left"
    RIGHT = "right"


@dataclass(frozen=True)
class TextLayer:
    """A free text overlay of the Advanced Edit: `text` (its lines split at newlines) on screen from
    `start` for `secs`, in Timeline time (seconds into the Clip, so that trimming the Clip leaves it
    where it was in it), centred on (x, y) in output pixels. Its look is its own: the font at `size`
    (libass's), its colour and outline, an optional box behind it, and the hook's animations. `id`
    names it in the editor."""

    id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,32}$")]
    text: Annotated[str, StringConstraints(max_length=TEXT_LAYER_MAX_CHARS)]
    start: Annotated[FiniteFloat, Field(ge=0, le=3600)]
    secs: Annotated[FiniteFloat, Field(ge=0.1, le=3600)]
    x: Annotated[FiniteFloat, Field(ge=0, le=1080)] = 540
    y: Annotated[FiniteFloat, Field(ge=0, le=1920)] = 960
    font: FontId = DEFAULT_FONT
    size: Annotated[int, Field(ge=16, le=320)] = 80
    colour: Colour = "#FFFFFF"
    # In output pixels; none at 0.
    outline: Annotated[int, Field(ge=0, le=20)] = 0
    outline_colour: Colour = "#000000"
    # A rounded box behind the lines.
    box: bool = False
    box_colour: Colour = "#000000"
    box_opacity: Annotated[float, Field(ge=0, le=1)] = 0.7
    align: TextAlign = TextAlign.CENTER
    animation_in: Animation = Animation.NONE
    animation_out: Animation = Animation.NONE
    animation_ms: Annotated[int, Field(ge=100, le=2000)] = 300


@dataclass(frozen=True)
class Candidate:
    # Set once, when Selection (or the owner, for a manual one) creates the Candidate; review edits
    # address it by this.
    id: str
    # On the Source's timeline, from just before a Word's start to just after a Word's end.
    start: float
    end: float
    # The AI's assessment; None for a manual Candidate.
    predicted_score: int | None
    hook_strength: int | None
    emotion: str
    reason: str
    retention_notes: str
    hook_text: str
    # Also the YouTube Shorts title.
    title: str
    descriptions: Descriptions
    hashtags: list[str]
    # The shortlisted Window it came from, and that Window's Score-pass score; None for a manual one.
    window_id: str | None
    window_score: int | None
    origin: Origin = Origin.AI
    layout: Layout = Layout.AUTO
    # Chosen for rendering.
    selected: bool = False
    # The owner has changed its bounds, hook text, layout or style.
    edited: bool = False
    # Its Style Preset (Default, if that has been deleted) and the fields of it replaced (app/styles.py).
    preset_id: str = DEFAULT_PRESET
    style_overrides: StyleOverrides = field(default_factory=StyleOverrides)
    # Corrections of its caption Words.
    word_edits: list[WordEdit] = field(default_factory=list)
    # When the hook comes on, in seconds into the Clip, and how long it stays (both kept in the Clip).
    hook_start: float = 0.0
    hook_secs: float = 3.0
    # Layouts of single Scenes.
    layout_overrides: list[LayoutOverride] = field(default_factory=list)
    # A short label in a pill above the hook ("" for none).
    hook_kicker: str = ""
    # The Advanced Edit's Text Layers, drawn in this order (the last on top).
    text_layers: list[TextLayer] = field(default_factory=list)

    @property
    def reviewed(self) -> bool:
        """Whether it holds the owner's review work, which a new run of Selection must keep."""
        return self.origin is Origin.MANUAL or self.edited or self.selected


def manual_candidate(id: str, start: float, end: float) -> Candidate:
    return Candidate(
        id=id,
        start=start,
        end=end,
        predicted_score=None,
        hook_strength=None,
        emotion="",
        reason="",
        retention_notes="",
        hook_text="",
        title="",
        descriptions=Descriptions("", "", ""),
        hashtags=[],
        window_id=None,
        window_score=None,
        origin=Origin.MANUAL,
    )
