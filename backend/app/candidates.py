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

# How the Advanced Edit names an item (a Text Layer, a Music Clip, an Overlay, a Segment), for the
# editor to address it.
ItemId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,32}$")]
# Where an item of the Advanced Edit starts in Timeline time (seconds into the output), how long it
# lasts, and how far into its file a song's or a video's starts.
TimelineStart = Annotated[FiniteFloat, Field(ge=0, le=3600)]
TimelineSecs = Annotated[FiniteFloat, Field(ge=0.1, le=3600)]
FileOffset = Annotated[FiniteFloat, Field(ge=0, le=3600)]


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

    id: ItemId
    text: Annotated[str, StringConstraints(max_length=TEXT_LAYER_MAX_CHARS)]
    start: TimelineStart
    secs: TimelineSecs
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


# A Media Library item's id (app/media.py).
MediaId = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]
# A volume, as a factor of the sound's own: 0 mutes it, 2 doubles it.
Volume = Annotated[FiniteFloat, Field(ge=0, le=2)]


@dataclass(frozen=True)
class MusicClip:
    """A song (or a video's sound) from the Media Library under the Clip: `secs` of it from `offset`
    seconds into the file, heard from `start`, in Timeline time, at `volume`, faded in and out over
    `fade_in` and `fade_out` seconds."""

    id: ItemId
    media: MediaId
    start: TimelineStart
    secs: TimelineSecs
    offset: FileOffset = 0.0
    volume: Volume = 1.0
    fade_in: Annotated[FiniteFloat, Field(ge=0, le=10)] = 0.0
    fade_out: Annotated[FiniteFloat, Field(ge=0, le=10)] = 0.0


@dataclass(frozen=True)
class Overlay:
    """A video or image from the Media Library laid over the Clip (picture in picture): from `start`
    for `secs`, in Timeline time, a video from `offset` seconds into it; centred on (x, y) in output
    pixels, `size` pixels wide (as tall as its shape makes it), at `opacity`, a video's sound at
    `volume` (none by default)."""

    id: ItemId
    media: MediaId
    start: TimelineStart
    secs: TimelineSecs
    offset: FileOffset = 0.0
    x: Annotated[FiniteFloat, Field(ge=0, le=1080)] = 540
    y: Annotated[FiniteFloat, Field(ge=0, le=1920)] = 960
    size: Annotated[int, Field(ge=16, le=2160)] = 540
    opacity: Annotated[FiniteFloat, Field(ge=0, le=1)] = 1.0
    volume: Volume = 0.0


class Fit(StrEnum):
    """How a video from the Media Library fills the vertical frame: cropped to fill it, or whole over
    a blurred copy of itself (as the Blur Layout shows a wide shot)."""

    FILL = "fill"
    BLUR = "blur"


@dataclass(frozen=True)
class Segment:
    """A piece of the Main Track (docs/adr/0002-segments-and-timeline-time.md): the Source from `start`
    to `end` on its timeline, snapped to Words as a Clip's edges are; or, with `media`, a video from
    the Media Library from `start` to `end` seconds into it, filling the frame as `fit` says, its own
    sound at `volume`. A Clip's Segments play in order, back to back. `id` names it in the editor."""

    id: ItemId
    start: Annotated[FiniteFloat, Field(ge=0)]
    end: Annotated[FiniteFloat, Field(ge=0)]
    media: MediaId | None = None
    fit: Fit = Fit.BLUR
    volume: Volume = 1.0


class TransitionKind(StrEnum):
    """How one Segment gives way to the next (ffmpeg's xfade transitions of the same names)."""

    FADE = "fade"
    FADEBLACK = "fadeblack"
    FADEWHITE = "fadewhite"
    SLIDELEFT = "slideleft"
    SLIDERIGHT = "slideright"
    SLIDEUP = "slideup"
    SLIDEDOWN = "slidedown"
    WIPELEFT = "wipeleft"
    ZOOMIN = "zoomin"
    CIRCLEOPEN = "circleopen"


@dataclass(frozen=True)
class Transition:
    """A Transition from the Segment `after` into the one after it, lasting `secs`: the two overlap
    by that long, so the Clip is that much shorter. Kept to half the shorter of the two by the planner."""

    after: ItemId
    kind: TransitionKind = TransitionKind.FADE
    secs: Annotated[FiniteFloat, Field(ge=0.2, le=1.5)] = 0.5


def transition_overlap(secs: float, before: float, after: float) -> float:
    """How long a Transition of `secs` overlaps the Segments either side of its join, `before` and
    `after` seconds long: half the shorter of them at most."""
    return round(min(secs, before / 2, after / 2), 3)


def timeline_length(segments: list["Segment"], transitions: list[Transition]) -> float:
    """How long a Main Track of `segments` plays: their lengths, less their Transitions' overlaps."""
    by_join = {transition.after: transition for transition in transitions}
    total = sum(segment.end - segment.start for segment in segments)
    for before, after in zip(segments, segments[1:]):
        if (transition := by_join.get(before.id)) is not None:
            total -= transition_overlap(transition.secs, before.end - before.start, after.end - after.start)
    return round(total, 3)


# The id of a Clip's one Segment when it isn't cut.
WHOLE = "main"


@dataclass(frozen=True)
class Candidate:
    # Set once, when Selection (or the owner, for a manual one) creates the Candidate; review edits
    # address it by this.
    id: str
    # On the Source's timeline, from just before a Word's start to just after a Word's end. With
    # several Segments, the hull of the Source they show.
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
    # Its Music Clips, mixed under its own sound, which is at `source_volume`.
    music: list[MusicClip] = field(default_factory=list)
    source_volume: Volume = 1.0
    # Its Main Track, in order; none (the default) for one Segment from `start` to `end`.
    segments: list[Segment] = field(default_factory=list)
    # Laid over its Segments, in this order (the last on top).
    overlays: list[Overlay] = field(default_factory=list)
    # Between its Segments, each by the Segment it follows.
    transitions: list[Transition] = field(default_factory=list)

    def main_track(self) -> list[Segment]:
        """Its Main Track: its Segments, or the one from `start` to `end`."""
        return self.segments or [Segment(WHOLE, self.start, self.end)]

    def source_segments(self) -> list[Segment]:
        """The Segments of its Main Track that show the Source, not the Media Library."""
        return [segment for segment in self.main_track() if segment.media is None]

    @property
    def duration(self) -> float:
        """How long its Clip is."""
        return timeline_length(self.main_track(), self.transitions)

    def media_ids(self) -> set[str]:
        """The Media Library items it uses."""
        return (
            {clip.media for clip in self.music}
            | {segment.media for segment in self.segments if segment.media}
            | {overlay.media for overlay in self.overlays}
        )

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
