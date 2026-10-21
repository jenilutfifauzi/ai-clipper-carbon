"""The Render Planner: how a Clip is cut from its Source and framed on its Candidate's Canvas
(app/canvas.py, docs/adr/0022; 1080×1920 for 9:16, as below), as a Render Plan that the Renderer executes. Pure, so it is tested on synthetic input (Seam B): the Clip's
Scenes and face detections are found before planning (app/analysis.py) and passed in.

Each Scene of a landscape Source gets its own Layout, from its number of faces in LAYOUT_SAMPLES of
its sampled frames (scenes shorter than MIN_SCENE_SECS are first merged into a neighbour, so that the
layout doesn't flicker). The Candidate's layout override, unless Auto, replaces the choice in every Scene.
- One face: Track, a full-height 9:16 crop that follows the speaker's face.
- Two faces: Split, two panels, each with its own camera following its face: stacked on 9:16 and 4:5
  (1080×960 and 1080×675), the left face's on top, and side by side on 1:1 and 16:9 (540×1080 and
  960×1080), the left face's on the left. Forced with fewer than two faces, Split shows the frame's
  left and right halves in the same panels.
- None, or three or more: Blur, the whole shot as wide as the output, centred over a blurred copy
  of itself that fills it.

The cameras:
- the Speaker Tracker gives each face an identity across the Scene's sampled frames; Track follows
  the largest and most often seen, sticking with it unless another clearly takes over, and Split
  the two seen most;
- the Smooth Camera moves a crop towards its face like a critically damped spring, once the face
  leaves its dead-zone, ignoring a detection that jumps away until others confirm it, and holds
  still while the face is lost.
A crop's path is kept as change points: the frames at which its position changes. A Scene starts
already framed on its faces, and the tracker starts afresh at every cut.

A Manual Scene (a Layout Override of Manual, or the Candidate's Layout of Manual where it has
none) is the Source drawn as a Picture placed by that Framing, over its Background, as a media
Segment's Scene is (`framed_scene`): still for the whole Scene, its faces not needed. Auto never
chooses it. Every other Scene offers the Framing that draws its first frame (`_first_framing`),
which the editors copy when it is switched to Manual, so that nothing jumps.

A portrait Source is passed through whole, or on a Canvas wider than it, shown as Blur shows a shot.

Captions come from the Clip's own Words (transcribed for it, on the Clip's timeline). They are
Cues of one short line, broken by the Caption Style's limits (by default UPPERCASE, at most 16
characters or 1.4 s long), each Word highlighted while it is spoken. With the style's Auto
position a line sits on the seam between the panels in a stacked Split Scene, under the shot in a
Blur Scene when there is room for it below it in the Safe Area, and in the lower third otherwise, and moves when the Layout changes under it; the other positions put every line in one
place.

The hook (the Candidate's hook text, as last edited) is shown for the Clip's first HOOK_SECS in a
box, at the top of the Canvas's Safe Area unless its Hook Style places it elsewhere: on one line if it fits,
else on two, set smaller when even two lines at the style's size would be too wide (`fit_hook`,
which Review also asks, to warn). With the default positions it stays above the captions in every
Layout: they never go above the seam's band, y 860.

Like the hook, captions stay inside the Safe Area, clear of the platforms' buttons and text. Both are
measured with their bundled font's own widths (`font_metrics`), the font libass sets them in. The
styles (app/styles.py) are kept in the plan, for the Renderer to draw it in them.

The Watermark (text, or one of the Logos) shows for the whole Clip. At one of its nine positions it
sits WATERMARK_MARGIN inside the Safe Area's corners, edges or middle; at the Custom position it is
centred where the owner dragged it, kept inside the frame.

Text Layers (the Advanced Edit's free text) are centred where the owner put them, as Overlays are
(their pictures may go past the frame's edges), each in its own look. Their words are never set
smaller: they break into lines at their wrap width, or the frame less TEXT_MARGIN either side
(app/line_breaks.py), and their box grows to hold them, at least their wrap width wide and their
fixed height tall. Each is drawn as a picture (docs/adr/0010): its layout (`TextLayout`)
holds its box and room round it for its ink, its lines placed from its corner, so that moving it
keeps the same picture, named by a hash of what it shows.
Each line is split into runs by Face (`text_runs`): a character its Face hasn't got is set in the
bundled CJK Face (FALLBACK_FACE) when that has it, and measured with it, or else left out. The line
pitch stays its own Face's.

Shapes (the Advanced Edit's figures, docs/adr/0011) are centred where the owner put them too, their
figure its style's width and height (a line's or an arrow's its length by its thickness), drawn
inside that box; each is drawn as a picture (`ShapeLayout`) of its figure and the room round it for
its softened edge and its shadow.

Shapes and Text Layers are the plan's picture layers (`PictureLayer`): items drawn as the picture
libass makes once of their layout (`PictureLayout`), placed by their Transform and Keyframes as an
Overlay's picture is (`layer_picture`), over the captions and under the hook, in the plan's order:
its Shapes, then its Text Layers (`RenderPlan.picture_layers`). The renderer, the pictures' maker
(app/layer_pictures.py) and the preview read them by these alone, whatever kind of item each draws.

Music Clips are heard where the owner put them, cut where the Clip or the song ends, under the
Clip's own sound at its `source_volume`. A keyed one's sound carries its volume Keyframes
(`gain`), in seconds from its start, which its fades multiply (`gain_at`).

Overlays (videos and images laid over the Clip) are each drawn as a Picture, cut by its Crop (in its
item's pixels: what is kept is what is fitted) and placed by its Transform: its centre kept on the
frame and the picture free to go past the frame's edges; its corners rounded by a share of its drawn
shorter side, and its border and shadow in output pixels; cut where the Clip or their video ends,
drawn over the Segments and under the Watermark. A video's sound, when turned up or keyed, is heard
as a Music Clip is. A keyed Overlay's Picture carries its motion (docs/adr/0008): its Keyframes in
seconds into the Clip, sampled for each frame by the renderer and the preview alike (`picture_at`),
and it is planned whole, never cut to what is on the frame.

A Clip cut into several Segments (docs/adr/0002-segments-and-timeline-time.md) is planned Segment
by Segment: each framed on its own, from its own Scenes and faces, its Scenes moved to where it
plays in the Clip. A Segment of a Media Library video is one Scene, with no captions: the video
drawn as a Picture placed by its Framing, over its Background (a blurred copy of what its Crop keeps,
covering the frame, or a colour) (`framed_scene`). A keyed one's Picture carries its motion in
seconds into the Clip, as a keyed Overlay's does, and its sound its volume Keyframes, from its
start; its Background is left out when the moving picture covers the frame at every one of its
frames (`keyed_scene`). A Manual Scene whose Layout Override is keyed moves so too, its
Keyframes counted from its Scene's start on the Source's timeline in every Segment that shows it
(`_keyed_manual`). A Transition overlaps
the Segments either side of a join by its length (at most half the shorter of them), so the Clip
is that much shorter; each side's captions end or start at its middle. Its ends are cuts: no Scene crosses one, and a caption line breaks at one.
Each Segment's sound is faded in from its start and out to its end (a Transition's overlap
included), its fades fitted to its length as a Music Clip's are (`fades_within`).
Everything else is planned over the whole Clip, in seconds into it.
"""

import hashlib
import json
import math
import unicodedata
from collections import Counter
from dataclasses import asdict, dataclass, field, replace
from enum import StrEnum
from functools import cache
from typing import Protocol, TypeVar

from pydantic import ConfigDict, computed_field

from app.candidates import (
    key_range,
    AdjustmentLayer,
    PICTURE_KEYS,
    Background,
    BackgroundKind,
    BlendMode,
    Border,
    Crop,
    CueEdit,
    Ease,
    Framing,
    Grade,
    Keyframe,
    KeyProperty,
    Keys,
    Layout,
    LINEAR,
    LayoutOverride,
    MAX_SCALE,
    MusicClip,
    Overlay,
    Shadow,
    Shape,
    ShapeStyle,
    TextAlign,
    TextLayer,
    TextStyle,
    Transform,
    WordEdit,
)
from app.audio_effects import AudioEffect, enabled_effects
from app.canvas import Aspect, Box, Canvas
from app.video_effects import VideoEffect, enabled_video_effects, scaled_effects
from app.config import CameraTuning, DuckTuning
from app.ducking import Span, duck_at, ducked_stretches, heard_words, speech_spans, touching
from app.emoji import IMAGE_SET, clusters, image_of, is_emoji
from app.fonts import DEFAULT_FONT, FALLBACK_FACE, on_change, registry
from app.keyframes import value_at
from app.line_breaks import broken_lines
from app.pictures import cover_scale, drawn_size, fitted, kept, turned_size
from app.segment_time import SegmentTime, overlay_time, transition_overlap
from app.styles import (
    Animation,
    CaptionPosition,
    CaptionStyle,
    HookAlign,
    HookPosition,
    HookShape,
    HookStyle,
    WatermarkKind,
    WatermarkPosition,
    WatermarkStyle,
)
from app.transcript import Word
from app.transition_kinds import TransitionKind, TransitionSound
from app.video_source import SourceMetadata

# A Scene's Layout follows its number of faces in this many of its sampled frames, spread through it.
LAYOUT_SAMPLES = 5
# A Scene shorter than this is merged into a neighbour before Layouts are chosen.
MIN_SCENE_SECS = 1.0
# In a stacked Split panel, the face's centre is put this far down the panel (as a share of its
# height), where the frame allows: a little above the middle, leaving the seam between the panels
# clear. Side by side, it is in the middle.
SPLIT_FACE_AT = 0.4
# A caption line stays on screen this long after its last Word, unless the next line comes sooner.
# (How lines are broken is the Caption Style's.)
CAPTION_LINGER_SECS = 0.3
# A Word Edit applies to the Word whose span holds its time, or failing that to the nearest Word
# within this long of it.
WORD_EDIT_REACH_SECS = 0.25
# Where the Layout changes under a line, the line moves; it isn't shown for less than this in one place.
CAPTION_MIN_SECS = 0.2
# The hook is shown from the Clip's start for this long, in at most two lines at its style's font
# size (Default's: 88, as libass sets Montserrat, like the captions': 56 px to the em, capitals 39 px
# tall), unless it is too long for them.
HOOK_SECS = 3.0
HOOK_SIZE = HookStyle().size
# The smallest a hook or a caption line is set, however much its tracking takes of its width.
MIN_SIZE = 1.0
# Its lines' baselines are its style's line_height sizes apart: by default this many.
HOOK_LEADING = HookStyle().line_height
# The box's padding, in pixels, unless its Hook Style gives its own: either side of the longest line,
# above the capitals of the first and below the descenders of the last.
HOOK_PAD_X = 36
HOOK_PAD_Y = 26
# A strip's padding, in sizes, unless its Hook Style gives its own: either side of its line, and
# above the capitals and below the descenders; and the gap between one strip and the next at the
# default line height (a line height moves them apart, or together until they touch, by as much as
# it moves a block's lines).
STRIP_PAD_X = 0.25
STRIP_PAD_Y = 0.14
STRIP_GAP = 0.06
# The Kicker is set at this share of the hook's size, in a pill padded by these many of its own
# sizes either side and above its capitals and below its descenders, this many hook sizes above it.
KICKER_SCALE = 0.8
KICKER_PAD_X = 0.5
KICKER_PAD_Y = 0.28
KICKER_GAP = 0.25
# The Quote Mark's badge is a square this many hook sizes wide over the top-left corner of the first
# line's box, reaching into it by QUOTE_INSET of the box's padding (so never over the text); with no
# box, just above and left of the first line's text.
QUOTE_SCALE = 0.9
QUOTE_INSET = 0.75
# A Text Layer is at most as wide as the frame less this many pixels either side.
TEXT_MARGIN = 48
# A Text Layer's picture holds its box and this many of its sizes round it, plus its stroke: room
# for what its letters draw past their advances and above their capitals (accents, a slanted face).
TEXT_INK_ROOM = 0.5
# A picture layer's picture is at most this many pixels on its longest side, whatever its scale.
MAX_LAYER_PICTURE = 4096
# A picture layer's picture is made at the first of these scales the largest it is drawn at doesn't pass
# (`reached_scale`): scaling it within one step is drawing the same picture smaller or larger, and
# only a scale past it makes a new one, as sharp. Never at less than 1; MAX_SCALE is the last.
LAYER_PICTURE_SCALES = (1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0)
# A Shape's picture holds its figure and this many pixels round it, at scale 1: room for the edge
# libass softens (and its shadow's reach past that).
SHAPE_ROOM = 2


# The planner's input, found by app/analysis.py.


@dataclass(frozen=True)
class Scene:
    """A shot between two cuts, in seconds into the Clip."""

    start: float
    end: float


@dataclass(frozen=True)
class Face:
    """A detected face's box in Source pixels, from its top-left corner, and the detector's confidence."""

    x: float
    y: float
    width: float
    height: float
    score: float

    @property
    def centre_x(self) -> float:
        return self.x + self.width / 2

    @property
    def centre_y(self) -> float:
        return self.y + self.height / 2


@dataclass(frozen=True)
class Join:
    """A Transition into a Segment from the one before: its kind, how long the two overlap, and how
    its sound crosses, and its knobs (unset: its kind's own)."""

    kind: TransitionKind
    secs: float
    sound: TransitionSound = TransitionSound.LINEAR
    strength: float | None = None
    colour: str | None = None


@dataclass(frozen=True)
class SegmentInput:
    """A Segment of a Clip cut into several, as the planner frames it: the Source from `start` to
    `end`, its shots `scenes` and sampled `faces` (None: unanalysed), and the Layout Overrides that
    fall in it, all in seconds into the given. With `media`, a Media Library video `width` x `height`
    instead, from `start` to `end` seconds into it, placed by its `framing`, its own sound at `volume`
    (none when `silent`)."""

    start: float
    end: float
    scenes: list["Scene"] | None = None
    faces: list["FrameFaces"] | None = None
    layout_overrides: list[LayoutOverride] = field(default_factory=list)
    media: str | None = None
    width: int = 0
    height: int = 0
    # None: fitted, at the Canvas's centre.
    framing: Framing | None = None
    volume: float = 1.0
    silent: bool = False
    # Its Words and the Word Edits that fall in it, in seconds into it (None: no captions), and the
    # Transition into it from the Segment before, if any.
    words: list[Word] | None = None
    word_edits: list[WordEdit] = field(default_factory=list)
    join: Join | None = None
    # A video's Keyframes, in seconds from its start (docs/adr/0008); and its Segment's id.
    keys: Keys = field(default_factory=dict)
    id: str = ""
    # How it plays its range (docs/adr/0009): at its Speed, forwards or in Reverse, or held.
    speed: float = 1.0
    reverse: bool = False
    hold: float | None = None
    # A held one's of the Source (a Freeze frame): the range of the Source its `scenes`, `faces` and
    # `layout_overrides` are of (in seconds into it), which holds its frame. None: from its frame on.
    analysed: tuple[float, float] | None = None
    # Whether its sound's pitch follows its Speed.
    pitch: bool = False
    # Its sound's fades as set, in seconds (the plan fits them to its length).
    fade_in: float = 0.0
    fade_out: float = 0.0
    # Its sound switched silent (docs/adr/0016).
    muted: bool = False
    # Its colour (docs/adr/0013), carried to its plan as given.
    grade: Grade = Grade()
    # Its sound's Audio Effects (docs/adr/0017), checked, in order; the plan keeps the enabled ones.
    audio_effects: list[AudioEffect] = field(default_factory=list)
    # Its frame's Video Effects (docs/adr/0014), checked, in order; the plan keeps the enabled ones.
    video_effects: list[VideoEffect] = field(default_factory=list)

    @property
    def time(self) -> SegmentTime:
        return SegmentTime(self.start, self.end, self.speed, self.reverse, self.hold)


@dataclass(frozen=True)
class FrameFaces:
    """The faces found in the sampled frame `at` seconds into the Clip."""

    at: float
    faces: list[Face]


# The Render Plan.


class SceneLayout(StrEnum):
    """How a scene is framed: the Layouts of review, and a portrait Source shown as it is."""

    TRACK = "track"
    SPLIT = "split"
    BLUR = "blur"
    PASSTHROUGH = "passthrough"
    # A Media Library video placed by its Framing.
    MEDIA = "media"
    # The Source placed by a Framing by hand.
    MANUAL = "manual"


def hook_width(canvas: Canvas) -> int:
    """The widest a hook line can be on `canvas`: its box, padding included, is as wide as the
    captions' area (its caption places are the Canvas's, app/canvas.py)."""
    return kicker_widest(canvas) - 2 * HOOK_PAD_X


def kicker_widest(canvas: Canvas) -> int:
    """The widest a Kicker's pill can be on `canvas`: as wide as the captions' area."""
    return canvas.caption_width


# How far inside the Safe Area's edges the Watermark sits, at its nine positions.
WATERMARK_MARGIN = 32
# Punctuation is left out of the captions at either end of a Word ("HALO" for "halo,"), except for
# the question and exclamation marks that end one ("KENAPA?") and signs that belong to it ("50%",
# "#1"). Inside a Word it stays ("MAIN-MAIN", "2,5").
_SIGNS = "%#@&"


@dataclass(frozen=True)
class CropPoint:
    """From `at` seconds into the Clip on, the panel's crop has its top-left corner at (x, y) in the Source."""

    at: float
    x: int
    y: int


@dataclass(frozen=True)
class Panel:
    """Part of the output frame, showing a crop of the Source scaled to fill it."""

    # Where the panel sits in the output frame.
    area: Box
    # The crop's size in Source pixels, with about the aspect of `area`.
    crop_width: int
    crop_height: int
    # Where the crop is: its change points in time order, the first at the scene's start. The crop
    # stays put between them.
    path: list[CropPoint]
    # Shown blurred: Blur's background.
    blur: bool = False


@dataclass(frozen=True)
class ScenePlan:
    # Seconds into the Clip.
    start: float
    end: float
    layout: SceneLayout
    # Laid over one another in order. Under a picture, its Background's: the one blurred cover, or
    # none for a colour.
    panels: list[Panel]
    # A media Segment's or a Manual Scene's: its one picture, drawn over its panels, or over `colour`
    # without any.
    picture: "Picture | None" = None
    colour: str | None = None
    # The Framing that draws its first frame (`_first_framing`): what a switch to Manual starts from.
    framing: Framing | None = None
    # A Manual Scene of a Layout Override's: where its Keyframes count from (`_keyed_manual`), in
    # seconds into the Clip (before the Scene, where it is shown from part way into its shot), and
    # those of them past its shot's end, which it never reaches, in seconds into the Clip too.
    keys_from: float | None = None
    ignored: Keys = field(default_factory=dict)


@dataclass(frozen=True)
class CaptionWord:
    """A Word of a caption line, highlighted from `start` (when it is spoken) to `end` (when the next
    one is, or the line goes), in seconds into the Clip."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class CueKey:
    """What a Cue is known by (and a Cue Edit keys it by): the middle of its first Word on that Word's
    timeline, `at` seconds into the Source (or, with `media`, into that Media Library item)."""

    # A Word Edit's or Cue Edit's key is one too, as the MCP's remove_candidate_items takes it: a
    # tool's argument, which takes no other field.
    __pydantic_config__ = ConfigDict(extra="forbid")

    at: float
    media: str | None = None


@dataclass(frozen=True)
class Cue:
    """A Cue: captions shown at once, from `start` to `end` (seconds into the Clip), centred in `area`
    (its place's, made as tall as its lines when they are taller) at font `size` (the Caption Style's,
    or smaller for a line too wide for the area). Its `lines` of Words (one font size apart, as
    libass sets them), as captions show them, are highlighted one after another, from its start to
    its end;
    `plain` is each line as its Words are written, with the Word Edits (not in the Caption Style's
    case, nor with its stripping), for subtitle files. `edited`: a Cue Edit applies to it;
    `joinable`: merged into the Cue before, it would still fit the line limits; `needs_join`: a
    pause, a sentence's end or the longest-Cue limit parts it from the Cue before, so merging it
    takes a `join` Cue Edit. A Cue Edit of it is kept from `low` to `high` (seconds into the Clip:
    its Segment, the Cue before's end and what the Cue after leaves it), its times divided by its
    Segment's `speed`. `word_ats` is each of its Words' middle on its timeline (as `key.at` is its
    first's), and `cue_edit_ats` the `at`, as given, of the Cue Edit matched to each: the first's
    starts it, another's is a join keeping it in. A Cue moved at a Layout change is one of these in
    each place, keyed alike."""

    start: float
    end: float
    lines: list[list[CaptionWord]]
    plain: list[str]
    area: Box
    size: float
    key: CueKey
    edited: bool = False
    joinable: bool = False
    needs_join: bool = False
    low: float = 0.0
    high: float = 0.0
    speed: float = 1.0
    word_ats: list[float] = field(default_factory=list)
    cue_edit_ats: list[float | None] = field(default_factory=list)

    @property
    def words(self) -> list[CaptionWord]:
        """Its Words, line after line."""
        return [word for line in self.lines for word in line]

    @property
    def text(self) -> str:
        """What it shows: its lines, one under the other."""
        return "\n".join(" ".join(word.text for word in line) for line in self.lines)


@dataclass(frozen=True)
class HookKicker:
    """The Kicker's text at font `size` on its pill `box`, placed by its anchor: the middle of its
    text and its baseline."""

    text: str
    size: float
    box: Box
    anchor: tuple[float, float]


@dataclass(frozen=True)
class HookEvent:
    """The hook's lines, set at font `size`, on screen from `start` to `end` (seconds into the Clip).
    `area` holds all of it. Each line is placed by its anchor, the middle of its text and its
    baseline, over `boxes`: one behind every line (a block), one behind each (strips), or none."""

    lines: list[str]
    start: float
    end: float
    area: Box
    size: float
    anchors: list[tuple[float, float]]
    boxes: list[Box]
    # Each line's emphasised runs, as [start, end) ranges of its characters.
    emphasis: list[list[tuple[int, int]]]
    # Above the lines; None without one.
    kicker: HookKicker | None = None
    # The Quote Mark's badge; None without one.
    quote: Box | None = None


@dataclass(frozen=True)
class WatermarkEvent:
    """The Watermark, in `area` for the whole Clip at `opacity`: the text set at font `size` and
    centred in it, or the Logo (its id) scaled to fill it."""

    kind: WatermarkKind
    area: Box
    opacity: float
    text: str = ""
    size: float = 0
    logo: str | None = None


@dataclass(frozen=True)
class AudioEvent:
    """A Music Clip (or an Overlay video's sound) as heard: the Media Library item `media` (None: the
    Source) from `offset` seconds into it, from `start` to `end` seconds into the Clip, at `volume`,
    faded in over `fade_in` and out over `fade_out`. A keyed one's `gain` is its volume Keyframes (docs/adr/0008)
    in seconds from its start, which set its volume in place of `volume`; its fades multiply them
    (`gain_at`). `id` is its item's. It plays at its `speed` (docs/adr/0009, 0016), its pitch
    following it with `pitch`: (end − start) × speed of its item, backwards when `reverse`. A
    `muted` one (docs/adr/0016) keeps its volume and Keyframes but isn't heard. With `source` it is
    the Source's sound, which the Clip's own volume scales too (and stays so once `media` names the
    Retimed copy it is read from). A ducked one (a Music Clip's with `duck`, docs/adr/0016) is turned
    down by that many dB under the spans of speech that reach it (`speech_spans`, app/ducking.py), in
    seconds into the Clip, as the plan's `ducking` says, and `ducked` where that is, ramps included,
    within it (`ducked_stretches`). One marked `speech` (a Music Clip marked Speech, docs/adr/0018) is
    speech over its whole span, and is never ducked. A Music Clip's Detached from a Segment names it
    (`detached_from`). Its `audio_effects` (docs/adr/0017) are its item's enabled ones, in order."""

    media: str | None
    start: float
    end: float
    offset: float
    volume: float
    fade_in: float
    fade_out: float
    gain: list[Keyframe] = field(default_factory=list)
    id: str = ""
    speed: float = 1.0
    pitch: bool = False
    reverse: bool = False
    muted: bool = False
    source: bool = False
    duck: float | None = None
    speech_spans: list[Span] = field(default_factory=list)
    ducked: list[Span] = field(default_factory=list)
    speech: bool = False
    detached_from: str | None = None
    # Heard after its Speed and before its volume (× its duck), fades and delay.
    audio_effects: list[AudioEffect] = field(default_factory=list)

    @property
    def time(self) -> SegmentTime:
        """How it plays its item (`overlay_time`), `offset`s being seconds from its `start` into the Clip."""
        return overlay_time(self.offset, self.end - self.start, self.speed, self.reverse)


@dataclass(frozen=True)
class SegmentPlan:
    """A Segment as played: the Source (or the Media Library video `media`) from `source_start` to
    `source_end`, at `speed`, forwards or in `reverse`, or its frame at `source_start` held for
    `hold` (docs/adr/0009), from `start` to `end` seconds into the Clip; a video's own sound at
    `volume`, or none when it is `silent`, faded in over `fade_in` and out over `fade_out`. A keyed
    one's `gain` is its volume Keyframes (docs/adr/0008), in seconds from its start, which set its
    volume in place of `volume`. `id` is its Segment's."""

    start: float
    end: float
    source_start: float
    source_end: float
    media: str | None = None
    volume: float = 1.0
    silent: bool = False
    # How many of the plan's Scenes, in order, are its.
    scenes: int = 1
    gain: list[Keyframe] = field(default_factory=list)
    id: str = ""
    speed: float = 1.0
    reverse: bool = False
    hold: float | None = None
    # Whether its sound's pitch follows its Speed, as tape does; kept by default.
    pitch: bool = False
    # The renderer's (app/retimed.py's `read_from_copies`): a Segment of the Source read from this
    # file of the render's, its Retimed copy, in place of the Source.
    read_from: str | None = None
    # Fitted to its length (`fades_within`), from `start` and to `end`: under a Transition, they and
    # its crossfade multiply.
    fade_in: float = 0.0
    fade_out: float = 0.0
    # Its sound switched silent (docs/adr/0016), keeping its volume, Keyframes and fades.
    muted: bool = False
    # Its Grade (docs/adr/0013), as given, not folded: the renderer folds it (app/grading.py) and so
    # does the preview, which draws a dragged dial before the plan comes.
    grade: Grade = Grade()
    # Its sound's enabled Audio Effects (docs/adr/0017), in order, heard after its Speed and before
    # its volume, Keyframes and fades.
    audio_effects: list[AudioEffect] = field(default_factory=list)
    # Its frame's enabled Video Effects (docs/adr/0014), in order, drawn after its Grade and before the
    # joins; their sizes in the Canvas's pixels (scale 1).
    video_effects: list[VideoEffect] = field(default_factory=list)

    @property
    def time(self) -> SegmentTime:
        """How it plays its range, `offset`s being seconds from its `start` into the Clip."""
        return SegmentTime(self.source_start, self.source_end, self.speed, self.reverse, self.hold)


@dataclass(frozen=True)
class TransitionEvent:
    """A Transition as drawn: from `start` to `end` seconds into the Clip, the Segment before gives way
    to the next one as `kind` says (by its knobs `strength` and `colour`, unset for its kind's own),
    their sounds crossing as `sound` says."""

    kind: TransitionKind
    start: float
    end: float
    sound: TransitionSound = TransitionSound.LINEAR
    strength: float | None = None
    colour: str | None = None

    @property
    def length(self) -> float:
        """How long the two Segments overlap."""
        return self.end - self.start


@dataclass(frozen=True)
class MediaInfo:
    """What the planner needs of a Media Library item: its picture's size (0 for a song), its length
    (None for an image), and whether it has sound."""

    width: int
    height: int
    duration: float | None
    has_audio: bool


@dataclass(frozen=True)
class Picture:
    """A picture as drawn, the same in the renderer and the preview (docs/adr/0007): the pixels in
    `crop` of its item, which is `item_size` (width, height) large, scaled to `width` x `height`
    (even pixels), mirrored as `flip_h` and `flip_v` say, turned `rotation` degrees clockwise about
    `centre` (in output pixels, on the frame), at `opacity`. `bounds` holds it once turned, and may
    go past the frame's edges: what the Smart Guides and the agent's dry run go by. An Overlay's
    corners are rounded `radius` output pixels before it is turned, and it may have a `border` and a
    `shadow`, in output pixels too.

    A keyed picture (docs/adr/0008) also carries its `motion`: the Keyframes of each keyed property
    (its centre's `x` and `y`, `scale`, `rotation` and `opacity`) in seconds into the Clip, and its
    drawn size at scale 1 (`unscaled`: its fitted size times its stretch), so that a sampled scale
    gives its drawn size (`picture_at`). Its other fields are its constants', and so are its bounds."""

    crop: Box
    item_size: tuple[int, int]
    width: int
    height: int
    centre: tuple[float, float]
    rotation: float
    flip_h: bool
    flip_v: bool
    opacity: float
    bounds: Box
    radius: float = 0.0
    border: Border | None = None
    shadow: Shadow | None = None
    motion: Keys = field(default_factory=dict)
    unscaled: tuple[float, float] | None = None


@dataclass(frozen=True)
class AdjustmentEvent:
    """An Adjustment Layer as drawn (docs/adr/0013): its `grade` (as given, folded by the renderer and
    the preview) laid over the Main Track and the Overlays from `start` to `end` seconds into the
    Clip, mixed over the picture as it was by `strength` percent times its ramp, up over `fade_in`
    from its start and down over `fade_out` to its end. Its `video_effects` (docs/adr/0014) are drawn
    after its Grade and mixed with it. `id` is the layer's."""

    id: str
    start: float
    end: float
    grade: Grade
    strength: float = 100.0
    fade_in: float = 0.0
    fade_out: float = 0.0
    # Its enabled Video Effects, in order, after its Grade; their sizes in the Canvas's pixels (scale 1).
    video_effects: list[VideoEffect] = field(default_factory=list)


def adjustment_event(layer: AdjustmentLayer, duration: float) -> AdjustmentEvent | None:
    """The Adjustment Layer in a Clip lasting `duration`: cut at its end, its fades then each held to
    half of what is left; None when it would start at or after the end."""
    start = round(layer.start, 3)
    if start >= duration:
        return None
    end = round(min(layer.start + layer.secs, duration), 3)
    half = (end - start) / 2
    return AdjustmentEvent(
        layer.id, start, end, layer.grade, layer.strength, round(min(layer.fade_in, half), 3), round(min(layer.fade_out, half), 3),
        enabled_video_effects(layer.video_effects),
    )


@dataclass(frozen=True)
class OverlayEvent:
    """An Overlay as drawn: the Media Library item `media` (an image, or a video from `offset` seconds
    into it, (end − start) × `speed` of it, its sound's pitch following the Speed with `pitch`; that
    range played backwards when `reverse`) drawn as `picture` says, from `start` to `end` seconds into
    the Clip, coming on and going off by its Overlay's animations, its picture graded by `grade`
    (docs/adr/0013; as given, folded by the renderer and the preview), then drawn through its
    `video_effects` (docs/adr/0014), and laid over what is under it by its `blend`. `id` is the
    Overlay's."""

    media: str
    picture: Picture
    start: float
    end: float
    offset: float
    image: bool
    id: str = ""
    speed: float = 1.0
    pitch: bool = False
    reverse: bool = False
    animation_in: Animation = Animation.NONE
    animation_out: Animation = Animation.NONE
    animation_ms: int = 300
    grade: Grade = Grade()
    # Its enabled Video Effects, in order, after its Grade; their sizes already times its scale
    # (`overlay_scale`), as drawn.
    video_effects: list[VideoEffect] = field(default_factory=list)
    blend: BlendMode = BlendMode.NORMAL

    @property
    def time(self) -> SegmentTime:
        """How a video's plays it (`overlay_time`), `offset`s being seconds from its `start` into the Clip."""
        return overlay_time(self.offset, self.end - self.start, self.speed, self.reverse)


@dataclass(frozen=True)
class TextRun:
    """A piece of a Text Layer's line set in one Face (`text_runs`): its `text`, drawn in the Face
    `face` from `x` for `width` pixels at its style's size. Its text has no space at either end:
    a space between two runs is only room between them.

    An emoji run is one emoji sequence, drawn from the emoji `image` (app/emoji.py) as a square 1 em
    of its line's Face wide (`emoji_square`)."""

    text: str
    face: str
    x: float = 0.0
    width: float = 0.0
    image: str | None = None


class PictureLayout:
    """What a picture layer's picture shows (docs/adr/0010, docs/adr/0011): in its own pixels,
    `width` x `height` at scale 1, rasterised `scale` times as large, by libass from the ASS script
    app/layer_pictures.py writes of it (`layout_script`). Its picture's file is `name`, a hash of all
    of it, so that the same picture is one file wherever the layer is; it is drawn in its `faces`.
    Each kind of picture layer has a frozen dataclass of its own with these: a Text Layer's is a
    TextLayout, a Shape's a ShapeLayout."""

    width: int
    height: int
    scale: float

    @property
    def raster(self) -> tuple[int, int]:
        """The picture's size in its own pixels: its size at scale 1 times its scale."""
        return max(1, round(self.width * self.scale)), max(1, round(self.height * self.scale))

    @property
    def name(self) -> str:
        raise NotImplementedError

    @property
    def picture_key(self) -> str:
        """What its picture shows at any scale: its name at scale 1, without the extension. The
        pictures of one key are the same, only larger or smaller."""
        return replace(self, scale=1.0).name.removesuffix(".png")

    @property
    def faces(self) -> set[str]:
        """The Faces it is drawn in: none unless it draws text."""
        return set()


@dataclass(frozen=True)
class TextLayout(PictureLayout):
    """What a Text Layer's picture shows (docs/adr/0010), in its own pixels, `width` x `height` at
    scale 1: its `lines` set in `style`, each placed by its anchor (the middle of its text and its
    baseline) and drawn as its `runs`, over its plate's rectangles `plates` (its Block, or a Strip
    per line) with corners `radius` pixels round. Its shadow, when on, is its runs again moved by
    `shadow` (right and down), between them and the plate. The picture is rasterised `scale` times
    as large (app/layer_pictures.py; the largest scale the layer is drawn at, up to the next of
    LAYER_PICTURE_SCALES), and named by a hash of all of it (`name`), so that the same picture is one
    file wherever the layer is."""

    style: TextStyle
    lines: list[str]
    anchors: list[tuple[float, float]]
    # Each line's, placed from the picture's left edge.
    runs: list[list[TextRun]]
    width: int
    height: int
    scale: float = 1.0
    plates: list[Box] = field(default_factory=list)
    radius: int = 0
    shadow: tuple[float, float] | None = None

    @property
    def name(self) -> str:
        """Its picture's file name: a hash of the layout, of its Faces' files (an id may name another
        file once its Face is deleted and another imported), of how pictures are drawn
        (TEXT_PICTURE_FORMAT) and, when it has emoji, of their images' set."""
        faces = [registry().find(face_id) for face_id in sorted(self.faces)]
        files = [face and face.sha256 for face in faces]
        if any(run.image for line in self.runs for run in line):
            files.append(IMAGE_SET)
        drawn = json.dumps([TEXT_PICTURE_FORMAT, files, asdict(self)], sort_keys=True, default=str)
        return f"{hashlib.sha256(drawn.encode()).hexdigest()[:24]}.png"

    @property
    def faces(self) -> set[str]:
        """The Faces it is drawn in: its style's, and any its runs fall back to."""
        return {self.style.font, *(run.face for line in self.runs for run in line)}


# How Text Layers' and Shapes' pictures are drawn: a new one is new pictures, under new names.
TEXT_PICTURE_FORMAT = "v1-libass-matte"
SHAPE_PICTURE_FORMAT = "v1-libass-matte-shape"


@dataclass(frozen=True)
class ShapeLayout(PictureLayout):
    """What a Shape's picture shows (docs/adr/0011), in its own pixels, `width` x `height` at scale 1:
    its figure as its `style` draws it, centred, SHAPE_ROOM and its shadow's reach round it. Its
    stroke, corners and shadow are its style's, in its own pixels too. Rasterised `scale` times as
    large (as a Text Layer's, the largest scale the Shape is drawn at, up to the next of
    LAYER_PICTURE_SCALES) and named by a hash of all of it and of SHAPE_PICTURE_FORMAT, so that the
    same picture is one file wherever the Shape is. It draws no text: it has no Faces."""

    style: ShapeStyle
    width: int
    height: int
    scale: float = 1.0

    @property
    def name(self) -> str:
        drawn = json.dumps([SHAPE_PICTURE_FORMAT, asdict(self)], sort_keys=True, default=str)
        return f"{hashlib.sha256(drawn.encode()).hexdigest()[:24]}.png"


@dataclass(frozen=True)
class PictureLayer:
    """A picture layer as drawn (docs/adr/0010, docs/adr/0011): an item of the Advanced Edit (`layer`: its id,
    Transform, Keyframes and in/out animations) drawn as the picture of its `layout`, from `start` to
    `end` seconds into the Clip, between the captions and the hook. It is placed as `picture` says,
    with the Overlay's maths (`layer_picture`). `area` is what its Grips hold (its box, without the
    room its picture keeps round it), and `bounds` that area once turned and scaled (`bounds_at`
    for a keyed one at a time). In its JSON too: its picture's file `image`, and `picture_key`, which
    names its pictures at every scale (PictureLayout.picture_key): the preview draws a larger picture
    of the same key it has rather than fetch a smaller one. Each kind has a frozen dataclass of its
    own made from it, which names its kind's item and layout: a Text Layer's is a TextEvent, a
    Shape's a ShapeEvent."""

    layer: TextLayer | Shape
    start: float
    end: float
    area: Box
    layout: PictureLayout
    picture: Picture
    bounds: Box

    @computed_field
    @property
    def image(self) -> str:
        return self.layout.name

    @computed_field
    @property
    def picture_key(self) -> str:
        return self.layout.picture_key


@dataclass(frozen=True)
class TextEvent(PictureLayer):
    """A Text Layer as drawn, a picture layer (`PictureLayer`) on screen from `start` to `end`
    (seconds into the Clip). `area` is its box, padded when it has a plate: a Block plate is `box`
    (the area), Strips are its layout's. Its lines are placed on the frame by `anchors`: the middle
    of each one's text and its baseline (its layout has them from its picture's corner).

    Its picture is its box and the room round it for its ink, centred about the middle of its area
    (to within half a pixel). Its layout gives its `lines` (broken at its wrap width), in its JSON
    too."""

    layer: TextLayer
    layout: TextLayout
    anchors: list[tuple[float, float]]
    box: Box | None = None

    @computed_field
    @property
    def lines(self) -> list[str]:
        return self.layout.lines


@dataclass(frozen=True)
class ShapeEvent(PictureLayer):
    """A Shape as drawn, a picture layer (`PictureLayer`) on screen from `start` to `end` (seconds
    into the Clip). `area` is its figure's box, `width` x `height` of its style about its Transform's
    centre (to within half a pixel), whatever its stroke, which is drawn inside it; its picture is
    that and SHAPE_ROOM and its shadow's reach round it, centred on the same centre."""

    layer: Shape
    layout: ShapeLayout


@dataclass(frozen=True)
class RenderPlan:
    # The Clip's range on the Source's timeline; with several Segments, the hull of what they show.
    start: float
    end: float
    source_width: int
    source_height: int
    # The frame rate the Clip is planned and encoded at: the Source's own (`source_fps`, 0 when it
    # isn't known), or the export's, above which the Source's frames repeat (docs/adr/0021).
    fps: float
    source_fps: float
    # Back to back, covering the Clip from 0 to its duration.
    scenes: list[ScenePlan]
    # The Candidate's Canvas (docs/adr/0022), in whose pixels the plan is, and its Safe Area.
    width: int
    height: int
    safe_area: Box
    captions: list[Cue] = field(default_factory=list)
    hook: HookEvent | None = None
    # What the captions and the hook look like.
    caption_style: CaptionStyle = CaptionStyle()
    hook_style: HookStyle = HookStyle()
    watermark: WatermarkEvent | None = None
    watermark_style: WatermarkStyle = WatermarkStyle()
    # The Text Layers that show, in drawing order.
    texts: list[TextEvent] = field(default_factory=list)
    # The Music Clips heard, under the Clip's own sound at `source_volume`.
    audio: list[AudioEvent] = field(default_factory=list)
    source_volume: float = 1.0
    # A Clip cut into several Segments: each, in order; none for a Clip of one range.
    segments: list[SegmentPlan] = field(default_factory=list)
    # Laid over the Segments, in drawing order.
    overlays: list[OverlayEvent] = field(default_factory=list)
    # Between Segments, in order.
    transitions: list[TransitionEvent] = field(default_factory=list)
    # The Shapes that show, in drawing order, under the Text Layers.
    shapes: list[ShapeEvent] = field(default_factory=list)
    # The Cue Edits given whose Word isn't shown, which do nothing (and are kept).
    unused_cue_edits: list[CueEdit] = field(default_factory=list)
    # The shortest a Cue Edit leaves its Cue shown, where it has room (CAPTION_MIN_SECS).
    cue_min_secs: float = CAPTION_MIN_SECS
    # How its ducked sounds follow speech (docs/adr/0016): the render's and the preview's ramps.
    ducking: DuckTuning = DuckTuning()
    # The Candidate's Grade (docs/adr/0013), as given, not folded: laid over the joined Main Track (a
    # Clip of one range's frame too), before the Overlays.
    grade: Grade = Grade()
    # The Adjustment Layers that show (docs/adr/0013), in the order they are applied: over the Overlays,
    # under the Watermark, captions, picture layers and hook.
    adjustment_layers: list[AdjustmentEvent] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.segments[-1].end if self.segments else SegmentTime(self.start, self.end).length

    @property
    def picture_layers(self) -> list[PictureLayer]:
        """Its picture layers in drawing order, over the captions and under the hook: its Shapes, then
        its Text Layers."""
        return [*self.shapes, *self.texts]


def reframes(source: SourceMetadata) -> bool:
    """Whether Clips of `source` are reframed, and so need their Scenes and faces: all but a portrait
    Source, which is passed through (but in a Manual Scene, framed by hand as any other)."""
    return source.height <= source.width


def plan_render(
    start: float,
    end: float,
    source: SourceMetadata,
    scenes: list[Scene] | None = None,
    faces: list[FrameFaces] | None = None,
    layout: Layout = Layout.AUTO,
    words: list[Word] | None = None,
    hook: str = "",
    camera: CameraTuning = CameraTuning(),
    caption_style: CaptionStyle = CaptionStyle(),
    hook_style: HookStyle = HookStyle(),
    word_edits: list[WordEdit] | None = None,
    hook_start: float = 0.0,
    hook_secs: float = HOOK_SECS,
    layout_overrides: list[LayoutOverride] | None = None,
    hook_kicker: str = "",
    watermark_style: WatermarkStyle = WatermarkStyle(),
    logo_size: tuple[int, int] | None = None,
    text_layers: list[TextLayer] | None = None,
    music: list[MusicClip] | None = None,
    source_volume: float = 1.0,
    main_track: list[SegmentInput] | None = None,
    overlays: list[Overlay] | None = None,
    media_info: dict[str, MediaInfo] | None = None,
    framing: Framing | None = None,
    shapes: list[Shape] | None = None,
    cue_edits: list[CueEdit] | None = None,
    fps: float | None = None,
    captioned: bool = True,
    music_words: dict[str, list[Word]] | None = None,
    ducking: DuckTuning = DuckTuning(),
    grade: Grade = Grade(),
    adjustment_layers: list[AdjustmentLayer] | None = None,
    *,
    canvas: Canvas,
) -> RenderPlan:
    """The Render Plan for the Clip from `start` to `end` seconds of `source`, whose shots are `scenes`
    and whose sampled frames have `faces` (both in seconds into the Clip), framed in `layout` (Auto:
    each Scene by its faces), captioned with `words` (in seconds into the Clip; those beyond its
    ends are left out) in `caption_style` and corrected by `word_edits` (their times in seconds into
    the Clip), with the `hook` text and its `hook_kicker` in `hook_style` from `hook_start` for
    `hook_secs`. A Scene that holds one of `layout_overrides` (their times in seconds into the
    Clip) takes its Layout instead of `layout`, the last one if it holds several. Without `scenes`
    the Clip is one Scene; without `faces` (not analysed) an Auto Scene is tracked with its crop in
    the middle; without `words`, nothing is captioned; with a blank `hook`, no hook is shown. A
    Manual Scene is the Source placed by its override's Framing, or by `framing` (the Candidate's)
    without one (`framed_scene`), and needs no faces; its override's Keyframes move it (`_keyed_manual`). The
    Watermark is in `watermark_style`, its Logo `logo_size` pixels (None: no Logo, which shows none).
    `text_layers` and `shapes` (their times in seconds into the Clip) are drawn as `text_event` and
    `shape_event` place them, and `music` is heard as `audio_events` places it, given what
    `media_info` says of its songs (and `source` of the Source, for its Music Clips of the Source).

    `overlays` are laid over it as `overlay_events` places them, given what `media_info` says of
    their items (whose videos' sound, when turned up, joins the music).

    `cue_edits` change single Cues (`_captions`). Unlike the other times, theirs are on their own
    timelines: the Source's, or with `media` that item's. Each applies in every Segment that shows
    its time (in a Clip of one range, from `start`), its times divided by that Segment's Speed; those
    whose Word isn't shown are listed in the plan's `unused_cue_edits`.

    With `main_track` (each Segment's SegmentInput), the Clip is cut into those Segments, back to back (`start` and `end` being the hull
    of what they show) but for their Transitions, each framed and captioned from its own (ignoring
    `scenes`, `faces`, `layout_overrides`, `words` and `word_edits`); the other times are all in
    seconds into the Clip.

    The Words (the Clip's, or each Segment's) are speech, which ducks the music (`_ducked`, by
    `ducking`), with those of its Music Clips of the Source (`music_words`, by id); not `captioned`,
    they are heard and not captioned. Its `grade` (the Candidate's, docs/adr/0013) is carried as given,
    and its `adjustment_layers` as `adjustment_event` places them.

    The Clip is planned at `fps` frames a second, the export's frame rate (docs/adr/0021), or at the
    Source's own without one: the rate it is encoded at, and the frames its keyed pictures are drawn
    at and checked on. At another rate than the Source's, its Freeze frames and Transitions last whole
    frames of it. The Preview Plan is always made at the Source's.

    Everything is placed on `canvas`, the Candidate's (docs/adr/0022), in its pixels."""
    if not 0 <= start < end:
        raise ValueError(f"A Clip runs forwards from 0 s or later, not {start:g}–{end:g} s")
    segments: list[SegmentPlan] = []
    transitions: list[TransitionEvent] = []
    cuts: list[float] = []
    fps = source.fps if fps is None else fps
    # The frames a keyed picture is drawn at, as the renderer draws them.
    rate = fps if fps > 0 else 30.0
    # At another rate than the Source's, a Freeze frame or a Transition lasts whole frames of it (at
    # least one), as the renderer holds and joins the Segments brought to it; at the Source's, the
    # Source's frames are joined as they come, as the Candidate says.
    resampled = fps != source.fps

    def whole_frames(secs: float) -> float:
        return round(max(1, round(secs * rate)) / rate, 3) if resampled else secs
    if main_track:
        plans, at, showings, stills, before = [], 0.0, [], [], 0.0
        for i, given in enumerate(main_track):
            hold = None if given.hold is None else whole_frames(given.hold)
            length = round(given.time.length if hold is None else hold, 3)
            if i and given.join is not None:
                # Overlapping the one before by the Transition's length, half the shorter at most.
                overlap = whole_frames(transition_overlap(given.join.secs, before, length))
                at = round(at - overlap, 3)
                transitions.append(TransitionEvent(given.join.kind, at, round(at + overlap, 3), given.join.sound, given.join.strength, given.join.colour))
                cuts.append(round(at + overlap / 2, 3))
            elif i:
                cuts.append(at)
            placed = given.framing or _centred_framing(canvas)
            if given.media is not None:
                framed = [framed_scene(0.0, length, SceneLayout.MEDIA, given.width, given.height, placed, canvas)]
            elif given.hold is not None:
                still, held = _still(given, length, source, layout, camera, framing, len(plans), canvas)
                framed = [still]
                stills += [(showing, given.start) for showing in held]
            else:
                # Framed over its range as at 1×, then put on the Timeline at its Speed (in Reverse, mirrored).
                reach = round(given.time.span, 3)
                framed = _framed(reach, source, given.scenes, given.faces, layout, camera, given.layout_overrides, canvas, framing)
                showings += _manual_showings(framed, given.layout_overrides, reach, given.time, len(plans))
                framed = _retimed(framed, given.time, length, source, canvas)
            moved = [_moved(scene, at) for scene in framed]
            if given.media is not None:
                moved = [keyed_scene(scene, placed.transform, given.keys, at, rate, canvas) for scene in moved]
            plans.extend(moved)
            fade_in, fade_out = fades_within(given.fade_in, given.fade_out, length)
            segments.append(
                SegmentPlan(
                    at, round(at + length, 3), given.start, given.end, given.media, given.volume, given.silent, len(framed),
                    given.keys.get(KeyProperty.VOLUME, []), given.id, given.speed, given.reverse, hold, given.pitch,
                    fade_in=fade_in, fade_out=fade_out, muted=given.muted, grade=given.grade,
                    audio_effects=enabled_effects(given.audio_effects), video_effects=enabled_video_effects(given.video_effects),
                )
            )
            at, before = round(at + length, 3), length
        duration = at
        words, keys, word_edits = _segment_words(main_track, segments, cuts, duration)
        retimes = _segment_cue_edits(main_track, segments, cue_edits or [])
        # Speech is the Source's, not a Muted Segment's (docs/adr/0016).
        unheard = [given if given.media is None and not given.muted else replace(given, words=None) for given in main_track]
        heard = _segment_words(unheard, segments, cuts, duration)[0] or []
        plans = _keyed_manual(_frozen(plans, stills, showings, source, canvas), showings, rate, canvas)
    else:
        duration = round(SegmentTime(start, end).length, 3)
        keys = [CueKey(round(start + (word.start + word.end) / 2, 3)) for word in words or []]
        retimes = [(i, replace(edit, at=round(edit.at - start, 3))) for i, edit in enumerate(cue_edits or []) if edit.media is None]
        plans = _framed(duration, source, scenes, faces, layout, camera, layout_overrides, canvas, framing)
        plans = _keyed_manual(plans, _manual_showings(plans, layout_overrides or [], duration, SegmentTime(start, end), 0), rate, canvas)
        heard = heard_words(words or [], 0.0, duration)
    audio = audio_events(music or [], duration, media_info or {}, source.duration) + overlay_sound(overlays or [], duration, media_info or {}, canvas)
    # Not captioned, the Words are heard only (they still duck the music above).
    captions, used = _captions(
        (words or []) if captioned else [], plans, duration, caption_style, word_edits or [], cuts,
        keys if captioned else [], retimes, [segment.speed for segment in segments], [edit.at for edit in cue_edits or []], canvas=canvas,
    )
    return RenderPlan(
        start=start,
        end=end,
        source_width=source.width,
        source_height=source.height,
        fps=fps,
        source_fps=source.fps,
        scenes=plans,
        captions=captions,
        hook=_hook(hook, duration, hook_style, canvas, hook_start, hook_secs, hook_kicker),
        caption_style=caption_style,
        hook_style=hook_style,
        width=canvas.width,
        height=canvas.height,
        safe_area=canvas.safe_area,
        watermark=watermark(watermark_style, logo_size, canvas=canvas),
        watermark_style=watermark_style,
        texts=[event for layer in text_layers or [] if (event := text_event(layer, duration, canvas)) is not None],
        audio=_ducked(audio, heard, music_words or {}, ducking),
        source_volume=source_volume,
        segments=segments,
        overlays=overlay_events(overlays or [], duration, media_info or {}, canvas),
        transitions=transitions,
        shapes=[event for shape in shapes or [] if (event := shape_event(shape, duration)) is not None],
        unused_cue_edits=[edit for i, edit in enumerate(cue_edits or []) if i not in used],
        ducking=ducking,
        grade=grade,
        adjustment_layers=[event for layer in adjustment_layers or [] if (event := adjustment_event(layer, duration)) is not None],
    )


def edit_shown(edit: "TimelineKeyed", media: str | None, start: float, end: float) -> bool:
    """Whether a Word Edit or Cue Edit can apply in a Segment showing `start`-`end` of the timeline
    `media` (None: the Source's): it is of that timeline, within WORD_EDIT_REACH_SECS of the range."""
    return edit.media == media and start - WORD_EDIT_REACH_SECS <= edit.at <= end + WORD_EDIT_REACH_SECS


def _segment_cue_edits(
    main_track: list[SegmentInput], segments: list[SegmentPlan], cue_edits: list[CueEdit]
) -> list[tuple[int, CueEdit]]:
    """The Cue Edits each Segment shows, with their place in `cue_edits`: those of its timeline (the
    Source's, or its item's) within WORD_EDIT_REACH_SECS of its range, as Word Edits are given, in
    seconds into the Clip, their times divided by its Speed. A Freeze frame and a reversed Segment,
    which have no Words, show none."""
    shown = []
    for given, segment in zip(main_track, segments):
        if given.hold is not None or given.reverse or given.words is None:
            continue
        time = given.time
        for i, edit in enumerate(cue_edits):
            if edit_shown(edit, given.media, given.start, given.end):
                shown.append((i, replace(
                    edit,
                    at=round(time.offset_of(edit.at - given.start) + segment.start, 3),
                    shift=edit.shift / given.speed,
                    start_delta=edit.start_delta / given.speed,
                    end_delta=edit.end_delta / given.speed,
                )))
    return sorted(shown, key=lambda pair: pair[1].at)


def _segment_words(
    main_track: list[SegmentInput], segments: list[SegmentPlan], cuts: list[float], duration: float
) -> tuple[list[Word] | None, list[CueKey], list[WordEdit]]:
    """The Segments' Words and Word Edits in seconds into the Clip: each Segment's Words whose middle
    is between the cuts either side of it (where the Segment before ends, or a Transition's middle),
    kept between them; and each of those Words' middle on its own timeline: the Source's, or a media
    Segment's item's (its Media Words). None when no Segment is captioned."""
    if all(given.words is None for given in main_track):
        return None, [], []
    edges = [0.0, *cuts, duration]
    words, at, edits = [], [], []
    for i, (given, segment) in enumerate(zip(main_track, segments)):
        low, high = edges[i], edges[i + 1]
        if given.hold is not None or given.reverse:
            # A Freeze frame is silent, and speech played backwards can't be read: nothing to caption.
            continue
        time = given.time
        for word in given.words or []:
            on, off = time.offset_of(word.start) + segment.start, time.offset_of(word.end) + segment.start
            if low <= (on + off) / 2 < high:
                words.append(Word(word.text, round(max(on, low), 3), round(min(off, high), 3)))
                at.append(CueKey(round(given.start + (word.start + word.end) / 2, 3), given.media))
        edits += [replace(edit, at=round(time.offset_of(edit.at) + segment.start, 3)) for edit in given.word_edits]
    return words, at, sorted(edits, key=lambda edit: edit.at)


def _ducked(audio: list[AudioEvent], words: list[Word], music_words: dict[str, list[Word]], ducking: DuckTuning) -> list[AudioEvent]:
    """The sounds, each ducked one with the spans of speech that reach it and where it is turned down
    (app/ducking.py): `words`, the Source Segments' as heard, the Words of each Music Clip of the
    Source heard forwards and not Muted (`music_words`, by its id, in seconds from its offset), where it
    plays, and the whole span of each Music Clip marked Speech that isn't Muted (`speech`, docs/adr/0018),
    cut to the Clip as it is heard."""
    if all(event.duck is None for event in audio):
        return audio
    said = list(words)
    for event in audio:
        if event.source and not event.muted and not event.reverse:
            said += heard_words(music_words.get(event.id, []), event.start, event.end, event.speed)
        if event.speech and not event.muted:
            said.append(Word("", event.start, event.end))
    spans = speech_spans(said, ducking)
    return [
        replace(event, speech_spans=touching(spans, event.start, event.end, ducking), ducked=ducked_stretches(spans, event.start, event.end, ducking))
        if event.duck is not None else event
        for event in audio
    ]


def _framed(
    duration: float,
    source: SourceMetadata,
    scenes: list[Scene] | None,
    faces: list[FrameFaces] | None,
    layout: Layout,
    camera: CameraTuning,
    layout_overrides: list[LayoutOverride] | None,
    canvas: Canvas,
    framing: Framing | None = None,
) -> list[ScenePlan]:
    """The Scenes of a range of `source` lasting `duration`, whose shots are `scenes` and whose
    sampled frames have `faces`, framed on `canvas` as plan_render says (a Manual one by its
    override's Framing, or else by `framing`); in seconds into the range. A portrait Source is passed through, but in a
    Manual Scene: as one Scene, unless one is Manual."""
    held_here = [o for o in layout_overrides or [] if 0 <= o.at <= duration]
    if not reframes(source) and layout is not Layout.MANUAL and all(o.layout is not Layout.MANUAL for o in held_here):
        return [_portrait(0.0, duration, source, canvas)]
    cuts = sorted({round(scene.start, 3) for scene in scenes or []} - {0.0})
    edges = [0.0, *(cut for cut in cuts if cut < duration), duration]
    plans = []
    for a, b in _merge_short(edges):
        override = _held(layout_overrides or [], a, b, duration)
        wanted = override.layout if override else layout
        if wanted is Layout.MANUAL:
            # Still: neither its faces nor a new run of the analysis move it.
            by_hand = (override.framing if override else framing) or _centred_framing(canvas)
            plans.append(framed_scene(a, b, SceneLayout.MANUAL, source.width, source.height, by_hand, canvas))
            continue
        if not reframes(source):
            plans.append(_portrait(a, b, source, canvas))
            continue
        seen = None if faces is None else [frame for frame in faces if a <= frame.at < b]
        count = None if seen is None else _face_count(seen)
        chosen = _choose(wanted, count)
        if chosen is SceneLayout.TRACK:
            panels = [_track(a, b, seen, source, camera, canvas)]
        elif chosen is SceneLayout.SPLIT:
            panels = _split(a, b, seen if count and count >= 2 else None, source, camera, canvas)
        else:
            panels = _blur(a, source, canvas)
        plans.append(ScenePlan(a, b, chosen, panels, framing=_first_framing(chosen, panels, source, canvas)))
    return plans


def _still(
    given: SegmentInput, length: float, source: SourceMetadata, layout: Layout, camera: CameraTuning, framing: Framing | None, first: int,
    canvas: Canvas,
) -> tuple[ScenePlan, list["_ManualShowing"]]:
    """The one Scene of a held Segment of the Source (a Freeze frame), `length` long: of the Scenes of
    its analysed range, framed as `_framed` frames them, the one holding its frame, as it is at that
    frame and held there: its Layout (an override's, or `layout`), each panel's crop where the camera
    is then. A Manual one is its Framing, unkeyed (a Freeze frame has no Keyframes); and, when it is
    an override's, its showing as the plan's Scene `first`, whose Keyframes `_frozen` samples."""
    low, high = given.analysed or (given.start, given.start + length)
    at = round(given.start - low, 3)
    reach = round(high - low, 3)
    framed = _framed(reach, source, given.scenes, given.faces, layout, camera, given.layout_overrides, canvas, framing)
    scene = next((scene for scene in framed if scene.start <= at < scene.end), framed[-1])

    def held(panel: Panel) -> Panel:
        point = next((point for point in reversed(panel.path) if point.at <= at + 1e-6), panel.path[0])
        return replace(panel, path=[replace(point, at=0.0)])

    panels = [held(panel) for panel in scene.panels]
    shown = _first_framing(scene.layout, panels, source, canvas) if scene.layout is SceneLayout.TRACK else scene.framing
    showings = _manual_showings([scene], given.layout_overrides, reach, SegmentTime(low, high), first)
    return ScenePlan(0.0, length, scene.layout, panels, scene.picture, scene.colour, shown), showings


def _frozen(
    plans: list[ScenePlan], stills: list[tuple["_ManualShowing", float]], showings: list["_ManualShowing"], source: SourceMetadata,
    canvas: Canvas,
) -> list[ScenePlan]:
    """`plans` with each Freeze frame of a keyed Manual Scene in `stills` (its showing, and its frame
    on the Source's timeline) framed as the Scene is at that frame: its override's Keyframes sampled
    there as `_keyed_manual` moves the Segments of `showings` that show the Scene (counted from the
    earliest one's start, those past the latest one's end ignored), or from its own Scene's start
    when none does. The sampled values become its Framing's constants."""
    plans = list(plans)
    for still, frame in stills:
        if not any(still.override.keys.values()):
            continue
        alike = [other for other in showings if still.same_scene_as(other)] or [still]
        start, end = min(other.start for other in alike), max(other.end for other in alike)
        given = still.override.framing
        assert given is not None
        sampled = {}
        for prop, keys in still.override.keys.items():
            if within := [key for key in keys if key.at <= end - start + 1e-3]:
                low, high = key_range(prop, canvas.size)
                value = value_at(within, frame - start, getattr(given.transform, prop.value))
                sampled[prop.value] = math.fmod(value, 360) if prop is KeyProperty.ROTATION else min(max(value, low), high)
        scene = plans[still.index]
        held = replace(given, transform=replace(given.transform, **sampled))
        plans[still.index] = framed_scene(scene.start, scene.end, scene.layout, source.width, source.height, held, canvas)
    return plans


def _held(overrides: list[LayoutOverride], start: float, end: float, duration: float) -> LayoutOverride | None:
    """The Layout Override of the Scene from `start` to `end` of a range lasting `duration`: the last
    one whose time is in it (the range's end being in its last Scene)."""
    held = [o for o in overrides if start <= o.at < end or (end == duration and o.at == end)]
    return held[-1] if held else None


@dataclass(frozen=True)
class _ManualShowing:
    """A Manual Scene of the plan framed by a Layout Override: its place among the plan's
    Scenes, the override, and where the Scene starts and ends and the override is, on the Source's
    timeline."""

    index: int
    override: LayoutOverride
    start: float
    end: float
    at: float
    # The Speed of the Segment showing it, and whether it shows it backwards.
    speed: float = 1.0
    reverse: bool = False

    def same_scene_as(self, other: "_ManualShowing") -> bool:
        """Whether `other` shows the same override's Scene (in another Segment, or the same piece
        again): its time, to rounding, and its Framing and Keyframes."""
        same = (self.override.framing, self.override.keys) == (other.override.framing, other.override.keys)
        return same and abs(self.at - other.at) < _SAME_OVERRIDE_SECS


# Two Layout Overrides this close on the Source's timeline, alike, are one (shown again): their
# times reach the planner rounded from each Segment's start.
_SAME_OVERRIDE_SECS = 0.002


def _manual_showings(
    framed: list[ScenePlan], overrides: list[LayoutOverride], duration: float, time: SegmentTime, first: int
) -> list[_ManualShowing]:
    """The Manual Scenes among `framed` (a range lasting `duration` that plays as `time`, its Scenes
    `first` onwards among the plan's, in seconds into the range; in Reverse, in the opposite order)
    framed by one of `overrides` (in seconds into the range too)."""
    found = []
    for i, scene in enumerate(framed):
        override = _held(overrides, scene.start, scene.end, duration) if scene.layout is SceneLayout.MANUAL else None
        if override is not None and override.layout is Layout.MANUAL:
            on, off = round(time.start + scene.start, 3), round(time.start + scene.end, 3)
            index = first + (len(framed) - 1 - i if time.reverse else i)
            found.append(_ManualShowing(index, override, on, off, time.start + override.at, time.speed, time.reverse))
    return found


def _keyed_manual(plans: list[ScenePlan], showings: list[_ManualShowing], fps: float, canvas: Canvas) -> list[ScenePlan]:
    """`plans` with each Manual Scene of `showings` moved by its override's Keyframes (`keyed_scene`).
    They are in seconds from its Scene's start on the Source's timeline: where the earliest of the
    Segments showing that Scene starts it, so that a Segment starting part way into it (the tail of
    a split) shows the motion from there on, and a piece of it shown twice moves alike both times.
    In a sped Segment they are divided by its Speed, on the same frames. Those past the latest end
    any of them shows are ignored. In a reversed Segment the motion is run backwards on the same
    frames (`_keys_backwards`); it has no `keys_from`, so the editor keys the Scene where it plays
    forwards."""
    plans = list(plans)
    for showing in showings:
        alike = [other for other in showings if showing.same_scene_as(other)]
        start, end = min(other.start for other in alike), max(other.end for other in alike)
        scene = plans[showing.index]
        speed = showing.speed
        assert showing.override.framing is not None
        if showing.reverse:
            reach = end - start + 1e-3
            backwards = {
                prop: _keys_backwards(within, showing.end - start, speed)
                for prop, given in showing.override.keys.items()
                if (within := [key for key in given if key.at <= reach])
            }
            plans[showing.index] = keyed_scene(scene, showing.override.framing.transform, backwards, scene.start, fps, canvas)
            continue
        keys_from = round(scene.start - (showing.start - start) / speed, 3)
        kept: Keys = {}
        ignored: Keys = {}
        for prop, given in showing.override.keys.items():
            if within := [replace(key, at=round(key.at / speed, 6)) for key in given if key.at <= end - start + 1e-3]:
                kept[prop] = within
            if past := [replace(key, at=round(keys_from + key.at / speed, 4)) for key in given if key.at > end - start + 1e-3]:
                ignored[prop] = past
        keyed = keyed_scene(scene, showing.override.framing.transform, kept, keys_from, fps, canvas)
        plans[showing.index] = replace(keyed, keys_from=keys_from, ignored=ignored)
    return plans


def _keys_backwards(keys: list[Keyframe], until: float, speed: float) -> list[Keyframe]:
    """`keys` (in seconds from a Scene's start on the Source's timeline) as a Segment playing the
    Source backwards at `speed` from `until` seconds into that Scene shows them: in seconds into it,
    last first, each span eased as it was, run backwards."""
    turned = [replace(key, at=round((until - key.at) / speed, 6)) for key in reversed(keys)]
    for i in range(1, len(turned)):
        x1, y1, x2, y2 = turned[i - 1].ease
        turned[i] = replace(turned[i], ease=Ease(*(round(1 - value, 6) for value in (x2, y2, x1, y1))))
    return [replace(turned[0], ease=LINEAR), *turned[1:]] if turned else turned


def _portrait(start: float, end: float, source: SourceMetadata, canvas: Canvas) -> ScenePlan:
    """A Scene of a portrait `source` from `start` to `end`: passed through, or on a Canvas wider than
    it (1:1 or 16:9, say), whole over its blur, as Blur shows a shot, rather than over black. On 9:16
    it is always passed through, as before Canvas Aspects."""
    if canvas.aspect is not Aspect.PORTRAIT and canvas.width * source.height > source.width * canvas.height:
        panels = _blur(start, source, canvas)
        return ScenePlan(start, end, SceneLayout.BLUR, panels, framing=_first_framing(SceneLayout.BLUR, panels, source, canvas))
    return _passed_through(start, end, source, canvas)


def _passed_through(start: float, end: float, source: SourceMetadata, canvas: Canvas) -> ScenePlan:
    """A Scene of a portrait `source` from `start` to `end`, whole and as large as fits, over black,
    as its Framing (scale 1 over black) draws it too."""
    shown = Framing(background=Background(BackgroundKind.COLOUR, "#000000"))
    return ScenePlan(start, end, SceneLayout.PASSTHROUGH, [_fitted(source.width, source.height, start, canvas)], framing=shown)


def _first_framing(layout: SceneLayout, panels: list[Panel], source: SourceMetadata, canvas: Canvas) -> Framing:
    """The Framing that draws the first frame of a Scene in `layout` of `source`, whose `panels` are
    planned: Track's first crop; Blur's whole frame fitted over its blur; and, for Split, which shows
    two pictures, a centred cover of the frame."""
    if layout is SceneLayout.TRACK:
        [panel] = panels
        start = panel.path[0]
        return _showing(source.width, source.height, Box(start.x, start.y, panel.crop_width, panel.crop_height), canvas)
    if layout is SceneLayout.SPLIT:
        return _centred_framing(canvas, min(cover_scale(source.width, source.height, canvas.size), MAX_SCALE))
    return _centred_framing(canvas)


def _centred_framing(canvas: Canvas, scale: float = 1.0) -> Framing:
    """The Framing of a picture centred on `canvas` at `scale`."""
    x, y = canvas.centre
    return Framing(Transform(x=x, y=y, scale=scale))


def _showing(width: int, height: int, box: Box, canvas: Canvas) -> Framing:
    """The Framing that draws the `box` of a `width` x `height` picture over the whole of `canvas`, as a
    panel filling the frame with it does: scaled to cover the frame with it and centred on it. Where
    the box is so far from the picture's middle that the picture's centre would be off the frame,
    the picture's far side is cropped off, just enough to bring it back on."""
    # Output pixels per pixel of the picture.
    frame_width, frame_height = canvas.size
    zoom = max(frame_width / box.width, frame_height / box.height)

    def cuts(size: int, start: int, length: int, frame: int) -> tuple[float, float]:
        # The shares cut off either end of one axis, so that the middle of what is kept is at most
        # half the frame (in the picture's pixels) from the box's.
        middle, reach = start + length / 2, frame / 2 / zoom
        if size / 2 > middle + reach:
            return 0.0, round(1 - 2 * (middle + reach) / size, 4)
        if size / 2 < middle - reach:
            return round((2 * (middle - reach) - size) / size, 4), 0.0
        return 0.0, 0.0

    (left, right), (top, bottom) = cuts(width, box.x, box.width, frame_width), cuts(height, box.y, box.height, frame_height)
    crop = Crop(left, top, right, bottom)
    cut = Box(*kept(width, height, crop))
    scale = zoom / min(frame_width / cut.width, frame_height / cut.height)
    x = frame_width / 2 + (cut.x + cut.width / 2 - (box.x + box.width / 2)) * zoom
    y = frame_height / 2 + (cut.y + cut.height / 2 - (box.y + box.height / 2)) * zoom
    centre = (round(min(max(x, 0.0), frame_width), 2), round(min(max(y, 0.0), frame_height), 2))
    return Framing(Transform(x=centre[0], y=centre[1], scale=round(min(scale, MAX_SCALE), 4)), crop)


def framed_scene(
    start: float, end: float, layout: SceneLayout, width: int, height: int, framing: Framing, canvas: Canvas
) -> ScenePlan:
    """A Scene from `start` to `end` of a `width` x `height` picture (a media Segment's video, or the
    Source in a Manual Scene) placed on `canvas` by its `framing`, which it carries: the
    picture (`picture_of`) over its Background, which is the largest crop of the Canvas's shape from
    the middle of what its Crop keeps, blurred, filling the frame (as Blur's background is), or its colour."""
    picture = picture_of(width, height, framing.transform, framing.crop, canvas=canvas)
    if framing.background.kind is BackgroundKind.COLOUR:
        return ScenePlan(start, end, layout, [], picture, framing.background.colour, framing)
    cropped, cover = picture.crop, _filled(picture.crop.width, picture.crop.height, start, canvas)
    point = replace(cover.path[0], x=cover.path[0].x + cropped.x, y=cover.path[0].y + cropped.y)
    return ScenePlan(start, end, layout, [replace(cover, path=[point], blur=True)], picture, framing=framing)


def keyed_scene(scene: ScenePlan, transform: Transform, keys: Keys, start: float, fps: float, canvas: Canvas) -> ScenePlan:
    """`scene`, of one picture placed by `transform` (a media Segment's or a Manual Scene's), moved by
    the `keys` of its item, whose Keyframes count from `start` seconds into the Clip (`with_motion`;
    before the Scene, for a Manual one shown from part way into it): its Background is left out when
    the picture covers `canvas` at every one of its frames at `fps` (`covers`), each at n / `fps`
    seconds into the Scene, as the renderer draws it. Unkeyed, as it is."""
    assert scene.picture is not None
    picture = with_motion(scene.picture, keys, start, stretched_fit(scene.picture, transform, canvas))
    if not picture.motion:
        return scene
    count = math.ceil((scene.end - scene.start) * fps - 1e-6)
    if all(covers(picture_at(picture, scene.start + n / fps, canvas.size), canvas) for n in range(count)):
        return replace(scene, picture=picture, panels=[], colour=None)
    return replace(scene, picture=picture)


# A corner of the frame this far outside a picture is still covered by it, in output pixels.
_COVER_REACH = 1e-3


def covers(picture: Picture, canvas: Canvas) -> bool:
    """Whether a still `picture` hides the whole of `canvas`: opaque, with every corner of it inside
    the picture once it is turned."""
    if picture.opacity < 1:
        return False
    angle = math.radians(picture.rotation)
    cos, sin = math.cos(angle), math.sin(angle)
    (cx, cy), half_width, half_height = picture.centre, picture.width / 2 + _COVER_REACH, picture.height / 2 + _COVER_REACH
    for px, py in ((0, 0), (canvas.width, 0), (0, canvas.height), canvas.size):
        # The corner in the picture's own directions, from its centre (frames.py turns it so).
        across, down = (px - cx) * cos + (py - cy) * sin, -(px - cx) * sin + (py - cy) * cos
        if abs(across) > half_width or abs(down) > half_height:
            return False
    return True


def _retimed(framed: list[ScenePlan], time: SegmentTime, length: float, source: SourceMetadata, canvas: Canvas) -> list[ScenePlan]:
    """The Scenes `framed` of a range of `source` (in seconds into it) as a Segment playing it as
    `time` says shows them, `length` long on the Timeline: their times and their crops' change points
    divided by its Speed; in Reverse, first mirrored (`_mirrored_scene`), the last Scene first."""
    speed = time.speed
    if time.reverse:
        span = framed[-1].end
        framed = [_mirrored_scene(scene, span, source, canvas) for scene in reversed(framed)]
    if speed == 1 and not time.reverse:
        return framed

    def on_timeline(scene: ScenePlan) -> ScenePlan:
        panels = [replace(panel, path=[replace(point, at=round(point.at / speed, 3)) for point in panel.path]) for panel in scene.panels]
        return replace(scene, start=round(scene.start / speed, 3), end=round(scene.end / speed, 3), panels=panels)

    retimed = [on_timeline(scene) for scene in framed]
    retimed[-1] = replace(retimed[-1], end=length)
    return retimed


def _mirrored_scene(scene: ScenePlan, span: float, source: SourceMetadata, canvas: Canvas) -> ScenePlan:
    """`scene`, of a range `span` long (in seconds into it), as the range played backwards shows it:
    from `span − end` to `span − start`, each crop held over the mirror of the time it was held
    (its camera path run backwards), its first frame the forward Scene's last (`framing`)."""

    def mirrored(panel: Panel) -> Panel:
        ends = [point.at for point in panel.path[1:]] + [scene.end]
        path = [replace(point, at=round(span - until, 3)) for point, until in zip(reversed(panel.path), reversed(ends))]
        return replace(panel, path=path)

    panels = [mirrored(panel) for panel in scene.panels]
    shown = _first_framing(scene.layout, panels, source, canvas) if scene.layout is SceneLayout.TRACK else scene.framing
    return replace(scene, start=round(span - scene.end, 3), end=round(span - scene.start, 3), panels=panels, framing=shown)


def _moved(scene: ScenePlan, by: float) -> ScenePlan:
    """The Scene `by` seconds later, its crops' change points with it."""
    if not by:
        return scene
    panels = [replace(panel, path=[replace(point, at=round(point.at + by, 3)) for point in panel.path]) for panel in scene.panels]
    return replace(scene, start=round(scene.start + by, 3), end=round(scene.end + by, 3), panels=panels)


def watermark(style: WatermarkStyle, logo_size: tuple[int, int] | None = None, *, canvas: Canvas) -> WatermarkEvent | None:
    """The Watermark in `style` on `canvas`, its Logo `logo_size` pixels; None when it shows nothing: off, blank
    text (without emoji, which the bundled fonts haven't got), or a Logo that is missing."""
    if style.kind is WatermarkKind.TEXT:
        text = without_emoji(style.text).strip()
        if not text:
            return None
        width = math.ceil(font_metrics(style.font).width(text, style.size))
        # As wide as the frame at most: set smaller when it is wider.
        size = float(style.size) if width <= canvas.width else math.floor(style.size * canvas.width / width * 10) / 10
        area = _watermark_area(style, min(width, canvas.width), math.ceil(size), canvas)
        return WatermarkEvent(WatermarkKind.TEXT, area, style.opacity, text=text, size=size)
    if style.kind is WatermarkKind.LOGO and style.logo is not None and logo_size is not None:
        logo_width, logo_height = logo_size
        height = min(style.size, canvas.height)
        width = max(1, round(height * logo_width / logo_height))
        if width > canvas.width:
            width, height = canvas.width, max(1, round(canvas.width * logo_height / logo_width))
        return WatermarkEvent(WatermarkKind.LOGO, _watermark_area(style, width, height, canvas), style.opacity, logo=style.logo)
    return None


def _watermark_area(style: WatermarkStyle, width: int, height: int, canvas: Canvas) -> Box:
    """Where a `width` x `height` Watermark goes on `canvas` at the style's position."""
    if style.position is WatermarkPosition.CUSTOM:
        # Its place is in the Reference Space; its size isn't mapped.
        centre_x, centre_y = canvas.x_from_reference(style.x), canvas.y_from_reference(style.y)
        x = min(max(round(centre_x - width / 2), 0), canvas.width - width)
        y = min(max(round(centre_y - height / 2), 0), canvas.height - height)
        return Box(x, y, width, height)
    vertical, _, horizontal = style.position.value.rpartition("_")
    vertical = vertical or (horizontal if horizontal in ("top", "bottom") else "")
    safe = canvas.safe_area
    left, top = safe.x + WATERMARK_MARGIN, safe.y + WATERMARK_MARGIN
    right = safe.x + safe.width - WATERMARK_MARGIN - width
    bottom = safe.y + safe.height - WATERMARK_MARGIN - height
    # Its middle column is centred in the frame, as the captions and the hook are.
    x = {"left": left, "right": right}.get(horizontal, (canvas.width - width) // 2)
    y = {"top": top, "bottom": bottom}.get(vertical, (safe.y * 2 + safe.height - height) // 2)
    return Box(min(max(x, 0), canvas.width - width), min(max(y, 0), canvas.height - height), width, height)


def fades_within(fade_in: float, fade_out: float, secs: float) -> tuple[float, float]:
    """A sound's fades in a sound `secs` long: as set, or when together they are longer, both
    shortened by the same share to fit. This is the rule, a Music Clip's and a Segment's; the
    Timeline draws the fades by a copy of it (fadesWithin in frontend/src/pages/job/advanced/edits.ts),
    tested on the same cases (tests/fixtures/gain_vectors.json)."""
    share = min(1.0, secs / ((fade_in + fade_out) or 1.0))
    return round(fade_in * share, 3), round(fade_out * share, 3)


def audio_events(
    music: list[MusicClip], duration: float, items: dict[str, "MediaInfo"], source: float = math.inf
) -> list[AudioEvent]:
    """The Music Clips as heard in a Clip lasting `duration`, each at its Speed, forwards or in
    Reverse, and cut where the Clip or its song (whose length is in `items`; the Source's, `source`)
    ends, as an Overlay's sound is (`overlay_time`: in Reverse, a cut at the Clip's end leaves out
    the start of its part, so its `offset` begins later); its fades fitted to what is left
    (`fades_within`). One whose song is gone, or that would start at or after either end, isn't heard."""
    events = []
    for clip in music:
        item = items.get(clip.media) if clip.media is not None else None
        length = source if clip.media is None else (item.duration if item is not None else None)
        start = round(clip.start, 3)
        if length is None or start >= duration or clip.offset >= length:
            continue
        time = overlay_time(clip.offset, clip.secs, clip.speed, clip.reverse, length, duration - start)
        end = round(start + time.length, 3)
        fade_in, fade_out = fades_within(clip.fade_in, clip.fade_out, end - start)
        events.append(
            AudioEvent(
                clip.media, start, end, round(time.start, 3), clip.volume, fade_in, fade_out,
                clip.keys.get(KeyProperty.VOLUME, []), clip.id, clip.speed, clip.pitch, clip.reverse, clip.muted,
                clip.media is None, clip.duck, speech=clip.speech, detached_from=clip.detached_from,
                audio_effects=enabled_effects(clip.audio_effects),
            )
        )
    return events


def gain_at(
    event: AudioEvent | SegmentPlan,
    time: float,
    ducking: DuckTuning = DuckTuning(),
    source_volume: float = 1.0,
    crossfade: TransitionEvent | None = None,
) -> float:
    """How loud `event` (a Music Clip's or an Overlay's sound, or a Segment's) is heard `time` seconds
    into the Clip: its volume, or its Keyframes sampled there (app/keyframes.py), the Source's times
    the Clip's own volume (`source_volume`, `own_volume`), through its fades' linear ramps, and a
    ducked one's duck under its speech (`duck_at`, by its plan's `ducking`); silent outside it, and
    Muted. A Segment taken away by the Transition into the next (`crossfade`) falls from 1 to 0 over
    it too, as the render's acrossfade does (its default curves are straight lines). The same rule as
    the preview's (loudness in frontend/src/pages/job/editor/loudness.ts): both are tested on the
    cases in tests/fixtures/gain_vectors.json, so that they can't drift (ADR 0001)."""
    into = time - event.start
    if into < 0 or time > event.end or event.muted:
        return 0.0
    share = 1.0
    if event.fade_in > 0:
        share = min(share, into / event.fade_in)
    if event.fade_out > 0:
        share = min(share, (event.end - time) / event.fade_out)
    taken = (crossfade.end - time) / (crossfade.end - crossfade.start) if crossfade and time > crossfade.start else 1.0
    ducked = duck_at(event.speech_spans, event.duck, time, ducking) if isinstance(event, AudioEvent) and event.duck is not None else 1.0
    level = value_at(event.gain, into, event.volume) * own_volume(event, source_volume)
    return level * min(max(share, 0.0), 1.0) * min(max(taken, 0.0), 1.0) * ducked


def own_volume(event: AudioEvent | SegmentPlan, source_volume: float) -> float:
    """What the Clip's own volume (`source_volume`) scales `event` by: all of it for the Source's
    sound (a Source Segment's, a Music Clip of the Source's), after its volume or Keyframes; 1 for
    any other."""
    source = event.source if isinstance(event, AudioEvent) else event.media is None
    return source_volume if source else 1.0


def overlay_events(overlays: list[Overlay], duration: float, items: dict[str, MediaInfo], canvas: Canvas) -> list[OverlayEvent]:
    """The Overlays as drawn on `canvas` in a Clip lasting `duration` (`_overlay_event`)."""
    return [event for overlay in overlays if (event := _overlay_event(overlay, duration, items, canvas)) is not None]


def overlay_sound(overlays: list[Overlay], duration: float, items: dict[str, MediaInfo], canvas: Canvas) -> list[AudioEvent]:
    """The sound of the Overlays' videos that are turned up, or keyed, heard as Music Clips are, while
    they show (a Muted one's too, which isn't heard)."""
    sounds = []
    for overlay in overlays:
        event = _overlay_event(overlay, duration, items, canvas)
        gain = overlay.keys.get(KeyProperty.VOLUME, [])
        if event is None or event.image or (overlay.volume <= 0 and not gain) or not items[overlay.media].has_audio:
            continue
        sounds.append(
            AudioEvent(
                overlay.media, event.start, event.end, event.offset, overlay.volume, 0.0, 0.0, gain, overlay.id, event.speed, event.pitch, event.reverse,
                overlay.muted, audio_effects=enabled_effects(overlay.audio_effects),
            )
        )
    return sounds


def _overlay_event(overlay: Overlay, duration: float, items: dict[str, MediaInfo], canvas: Canvas) -> OverlayEvent | None:
    """The Overlay as drawn: its item placed by its Transform (`picture_of`) with its corners, border
    and shadow, cut where the Clip or its video ends (`overlay_time`). Its `offset` is where the part
    of its video it shows begins: in Reverse, which shows that part from its end, a cut at the Clip's
    end leaves out the start of the part, so it begins later. None when its item is gone or it would
    start at or after either end."""
    item = items.get(overlay.media)
    start = round(overlay.start, 3)
    if item is None or not item.width or not item.height or start >= duration:
        return None
    if item.duration is not None and overlay.offset >= item.duration:
        return None
    video = math.inf if item.duration is None else item.duration
    time = overlay_time(overlay.offset, overlay.secs, overlay.speed, overlay.reverse, video, duration - start)
    end = round(start + time.length, 3)
    offset = 0.0 if item.duration is None else round(time.start, 3)
    placed = picture_of(item.width, item.height, overlay.transform, overlay.crop, canvas=canvas)
    picture = with_motion(placed, overlay.keys, start, stretched_fit(placed, overlay.transform, canvas))
    # The radius is a share of the shorter side as drawn, so it scales with the picture; the border
    # and shadow are in output pixels, so they don't.
    radius = round(overlay.radius * min(picture.width, picture.height), 2)
    picture = replace(picture, radius=radius, border=overlay.border, shadow=overlay.shadow)
    return OverlayEvent(
        overlay.media, picture, start, end, offset, item.duration is None, overlay.id, overlay.speed, overlay.pitch, overlay.reverse,
        overlay.animation_in, overlay.animation_out, overlay.animation_ms, overlay.grade,
        scaled_effects(enabled_video_effects(overlay.video_effects), overlay_scale(overlay.transform)), overlay.blend,
    )


def overlay_scale(transform: Transform) -> float:
    """How many times its fitted size an Overlay is drawn, for its Video Effects' sizes (docs/adr/0014):
    the larger of its scale times its stretch on each axis."""
    return transform.scale * max(transform.stretch_x, transform.stretch_y)


def with_motion(picture: Picture, keys: Keys, start: float, unscaled: tuple[float, float]) -> Picture:
    """`picture`, moved by the `keys` of an item that starts `start` seconds into the Clip: its motion
    in seconds into the Clip, and its drawn size at scale 1, `unscaled` (`stretched_fit` for a picture
    fitted to its Canvas). Unkeyed (a volume isn't the picture's), as it is."""
    keys = {prop: given for prop, given in keys.items() if prop in PICTURE_KEYS}
    if not keys:
        return picture
    motion = {prop: [replace(key, at=round(start + key.at, 4)) for key in given] for prop, given in keys.items()}
    return replace(picture, motion=motion, unscaled=unscaled)


def stretched_fit(picture: Picture, transform: Transform, canvas: Canvas) -> tuple[float, float]:
    """The drawn size at scale 1 of `picture`, placed by `transform`: its crop's fitted size on
    `canvas`, stretched."""
    across, down = fitted(picture.crop.width, picture.crop.height, canvas.size)
    return across * transform.stretch_x, down * transform.stretch_y


def picture_at(picture: Picture, time: float, frame: tuple[int, int]) -> Picture:
    """`picture` as drawn at `time` seconds into the Clip: each keyed property sampled from its motion
    (app/keyframes.py) and held to its range (its centre on the `frame` it is drawn on: the plan's
    Canvas, or the size the plan is drawn at), its size its drawn size at scale 1 times the sampled
    scale (in fractions of a pixel), its corners' radius in step with its shorter side (its border and
    shadow stay as they are), and its bounds turned about the sampled centre; a still Picture,
    without motion. The same rule as the preview's (pictureAt in frontend/src/pages/job/editor/picture.ts).
    An unkeyed picture is itself."""
    motion = picture.motion
    if not motion:
        return picture

    def sampled(prop: KeyProperty, constant: float) -> float:
        if prop not in motion:
            return constant
        low, high = key_range(prop, frame)
        value = value_at(motion[prop], time, constant)
        return value if prop is KeyProperty.ROTATION else min(max(value, low), high)

    width, height = float(picture.width), float(picture.height)
    if KeyProperty.SCALE in motion and picture.unscaled is not None:
        scale = sampled(KeyProperty.SCALE, 1.0)
        width, height = picture.unscaled[0] * scale, picture.unscaled[1] * scale
    x, y = sampled(KeyProperty.X, picture.centre[0]), sampled(KeyProperty.Y, picture.centre[1])
    rotation = sampled(KeyProperty.ROTATION, picture.rotation)
    across, down = turned_size(width, height, rotation)
    radius = picture.radius * min(width, height) / min(picture.width, picture.height) if picture.radius else 0.0
    return replace(
        picture,
        width=width,
        height=height,
        radius=radius,
        centre=(x, y),
        rotation=rotation,
        opacity=sampled(KeyProperty.OPACITY, picture.opacity),
        bounds=Box(round(x - across / 2), round(y - down / 2), round(across), round(down)),
        motion={},
    )


def key_times(picture: Picture) -> list[float]:
    """The times, in seconds into the Clip, at which a keyed picture has a Keyframe of any property:
    each once, in order."""
    return sorted({key.at for keys in picture.motion.values() for key in keys})


def picture_of(width: int, height: int, transform: Transform, crop: Crop = Crop(), *, canvas: Canvas) -> Picture:
    """A `width` x `height` item cut by `crop` and drawn on `canvas` as `transform` places it: what it
    keeps at its drawn size (app/pictures.py), its centre kept on the frame, the picture not."""
    cut = Box(*kept(width, height, crop))
    drawn_width, drawn_height = drawn_size(cut.width, cut.height, transform, canvas.size)
    x = round(min(max(transform.x, 0.0), canvas.width), 2)
    y = round(min(max(transform.y, 0.0), canvas.height), 2)
    across, down = turned_size(drawn_width, drawn_height, transform.rotation)
    bounds = Box(round(x - across / 2), round(y - down / 2), round(across), round(down))
    return Picture(
        cut, (width, height), drawn_width, drawn_height, (x, y), transform.rotation,
        transform.flip_h, transform.flip_v, transform.opacity, bounds,
    )


def on_frame(picture: Picture, frame: tuple[int, int]) -> Picture:
    """The part of an unturned `picture` that is on the `frame` (width, height; the plan's, or the
    size it is drawn at), as a Picture of its own: what it draws there, without scaling what is off
    it (a picture zoomed in or covering the frame is larger than the frame). A turned picture is
    given back whole, and so is a keyed one, whose part on the frame changes as it moves."""
    if picture.rotation % 360 or picture.motion:
        return picture
    x, y = picture.centre
    left, top = x - picture.width / 2, y - picture.height / 2
    shown = (max(left, 0.0), max(top, 0.0), min(left + picture.width, frame[0]), min(top + picture.height, frame[1]))
    if shown[2] <= shown[0] or shown[3] <= shown[1]:
        return picture
    crop = picture.crop
    # Shares of its drawn width and height, mirrored where it is flipped.
    across = sorted(_mirrored((shown[0] - left) / picture.width, (shown[2] - left) / picture.width, picture.flip_h))
    down = sorted(_mirrored((shown[1] - top) / picture.height, (shown[3] - top) / picture.height, picture.flip_v))
    cut_x, cut_right = round(crop.x + across[0] * crop.width), round(crop.x + across[1] * crop.width)
    cut_y, cut_bottom = round(crop.y + down[0] * crop.height), round(crop.y + down[1] * crop.height)
    if (cut_x, cut_y, cut_right - cut_x, cut_bottom - cut_y) == (crop.x, crop.y, crop.width, crop.height):
        return picture
    width, height = max(2, _even(shown[2] - shown[0])), max(2, _even(shown[3] - shown[1]))
    centre = (round((shown[0] + shown[2]) / 2, 2), round((shown[1] + shown[3]) / 2, 2))
    return replace(
        picture,
        crop=Box(cut_x, cut_y, max(1, cut_right - cut_x), max(1, cut_bottom - cut_y)),
        width=width,
        height=height,
        centre=centre,
        bounds=Box(round(centre[0] - width / 2), round(centre[1] - height / 2), width, height),
    )


def _mirrored(low: float, high: float, flipped: bool) -> tuple[float, float]:
    return (1 - high, 1 - low) if flipped else (low, high)


def text_event(layer: TextLayer, duration: float, canvas: Canvas) -> TextEvent | None:
    """The Text Layer in a Clip lasting `duration`, until its end if that comes sooner: its words
    (what no Face nor emoji image has left out, blank lines at either end left out) broken into
    lines at its wrap width (`text_lines`), each split into runs by Face (`text_runs`), and set in its
    box (`text_box`), centred on its Transform's centre (on the frame, its picture maybe past the
    edges, as an Overlay's). None when it is blank or would start at or after the Clip's end."""
    start = round(layer.start, 3)
    if start >= duration:
        return None
    style = layer.style
    lines = text_lines(layer.text, style, canvas)
    if not lines:
        return None
    runs = [text_runs(line, style.font) for line in lines]
    metrics = font_metrics(style.font)
    widths = [runs_width(line, style.size, style.tracking) for line in runs]
    width, height, (pad_x, top) = text_box(style, widths)
    x, y = round(layer.transform.x - width / 2), round(layer.transform.y - height / 2)
    area = Box(x, y, width, height)

    def middle(line: float) -> float:
        if style.align is TextAlign.LEFT:
            return x + pad_x + line / 2
        if style.align is TextAlign.RIGHT:
            return x + width - pad_x - line / 2
        return x + width / 2

    anchors = [
        (middle(line), y + top + (metrics.cap_height / metrics.units + i * style.line_height) * style.size)
        for i, line in enumerate(widths)
    ]
    end = round(min(start + layer.secs, duration), 3)
    plates = _plates(style, area, lines, widths, anchors)
    radius = min(round(style.plate.radius), min(box.height for box in plates) // 2) if plates else 0
    placed = [placed_runs(line, x - width / 2, style.size, style.tracking) for line, width, (x, _) in zip(runs, widths, anchors)]
    layout, origin = _text_layout(layer, lines, placed, area, anchors, plates, radius)
    picture = layer_picture(layout, origin, layer, start)
    return TextEvent(
        layer=layer, start=start, end=end, area=area, layout=layout, picture=picture,
        bounds=_turned_box(area, picture.centre, layer.transform), anchors=anchors,
        box=area if style.plate.shape is HookShape.BLOCK else None,
    )


def shape_event(shape: Shape, duration: float) -> ShapeEvent | None:
    """The Shape in a Clip lasting `duration`, until its end if that comes sooner: its figure (its
    style's `size`: `width` x `height`, or a line's length by its thickness), centred on its
    Transform's centre (on the frame, its picture maybe past the edges), drawn as the picture of its
    layout. None when it would start at or after the Clip's end."""
    start = round(shape.start, 3)
    if start >= duration:
        return None
    style, (x, y) = shape.style, (shape.transform.x, shape.transform.y)
    (figure_width, figure_height), room = style.size, SHAPE_ROOM + style.shadow.reach
    width, height = figure_width + 2 * room, figure_height + 2 * room
    # Made even, as a Text Layer's, the figure staying in its middle.
    width, height = width + width % 2, height + height % 2
    layout = ShapeLayout(style, width, height, picture_scale(shape, width, height))
    area = Box(round(x - figure_width / 2), round(y - figure_height / 2), figure_width, figure_height)
    picture = layer_picture(layout, (x - width / 2, y - height / 2), shape, start)
    end = round(min(start + shape.secs, duration), 3)
    return ShapeEvent(
        layer=shape, start=start, end=end, area=area, layout=layout, picture=picture,
        bounds=_turned_box(area, picture.centre, shape.transform),
    )


def text_lines(text: str, style: TextStyle, canvas: Canvas) -> list[str]:
    """A Text Layer's `text` as the lines it is set in, in `style`: without what no Face nor emoji
    image has (`text_runs`), blank lines at either end left out, broken at its newlines and between
    its words where a line, measured run by run in its Faces (an emoji 1 em), would be wider than its
    wrap width less its plate's padding either side (`text_room`). Never set smaller."""
    paragraphs = ["".join(run.text for run in text_runs(line, style.font)) for line in text.split("\n")]
    while paragraphs and not paragraphs[0]:
        paragraphs.pop(0)
    while paragraphs and not paragraphs[-1]:
        paragraphs.pop()
    if not paragraphs:
        return []
    return broken_lines(
        "\n".join(paragraphs), text_room(style, canvas), lambda line: runs_width(text_runs(line, style.font), style.size, style.tracking)
    )


def text_room(style: TextStyle, canvas: Canvas) -> float:
    """How wide a Text Layer's lines in `style` may be: its wrap width, or the width of `canvas` less
    TEXT_MARGIN either side when it has none, less its plate's padding either side."""
    pad_x = style.plate.padding_x if style.plate.shape is not HookShape.NONE else 0.0
    return (style.wrap_width or canvas.width - 2 * TEXT_MARGIN) - 2 * pad_x


def text_box(style: TextStyle, widths: list[float]) -> tuple[int, int, tuple[float, float]]:
    """The box of a Text Layer's lines `widths` wide in `style`, in whole pixels: as wide as its
    widest line and as tall as its lines (capitals to descenders, `line_height` apart), plus its
    plate's padding either side; and at least its wrap width wide and its fixed height tall,
    its padding then inside them, its lines centred down it. With where its lines start inside it:
    how far in from either side they are aligned, and how far down the first's capitals are."""
    metrics = font_metrics(style.font)
    plated = style.plate.shape is not HookShape.NONE
    pad_x, pad_y = (style.plate.padding_x, style.plate.padding_y) if plated else (0.0, 0.0)
    letters = metrics.letters_height(style.size) + (len(widths) - 1) * style.line_height * style.size
    width = math.ceil(max(max(widths) + 2 * pad_x, style.wrap_width))
    height = math.ceil(max(letters + 2 * pad_y, style.fixed_height))
    return width, height, (pad_x, pad_y + max(style.fixed_height - letters - 2 * pad_y, 0) / 2)


def _plates(style: TextStyle, area: Box, lines: list[str], widths: list[float], anchors: list[tuple[float, float]]) -> list[Box]:
    """The rectangles of a Text Layer's plate on the frame, its lines (`widths` wide, at `anchors`)
    set in `area`: none, its Block (the area), or a Strip round each line but a blank one, padded as
    the area is round the widest and from the capitals down to the descenders."""
    plate = style.plate
    if plate.shape is HookShape.NONE:
        return []
    if plate.shape is HookShape.BLOCK:
        return [area]
    metrics = font_metrics(style.font)
    pad_x, pad_y = plate.padding_x, plate.padding_y
    height = math.ceil(metrics.letters_height(style.size) + 2 * pad_y)
    strips = []
    for line, line_width, (x, baseline) in zip(lines, widths, anchors):
        if not line:
            continue
        width = min(math.ceil(line_width + 2 * pad_x), area.width)
        left = min(max(round(x - width / 2), area.x), area.x + area.width - width)
        strips.append(Box(left, round(baseline - metrics.cap_height / metrics.units * style.size - pad_y), width, height))
    return strips


def _text_layout(
    layer: TextLayer,
    lines: list[str],
    runs: list[list[TextRun]],
    area: Box,
    anchors: list[tuple[float, float]],
    plates: list[Box],
    radius: int,
) -> tuple[TextLayout, tuple[int, int]]:
    """A Text Layer's layout, set in `area` with its lines at `anchors` drawn as `runs` (placed on
    the frame) over its `plates` (their corners `radius` round), and where its picture's
    top-left corner is on the frame: its area and TEXT_INK_ROOM round it, and its shadow's reach,
    made even across and down. Its anchors, runs and plates are kept from that corner, so that the
    layout (and its picture) is the same wherever the layer is; the area stays in the picture's
    middle, which the Transform turns it about."""
    style = layer.style
    room = math.ceil(style.stroke_width + TEXT_INK_ROOM * style.size) + style.shadow.reach
    left, top = area.x - room, area.y - room
    width, height = area.width + 2 * room, area.height + 2 * room
    width, height = width + width % 2, height + height % 2
    local = [(round(x - left, 4), round(y - top, 4)) for x, y in anchors]
    local_runs = [[replace(run, x=round(run.x - left, 4)) for run in line] for line in runs]
    plates = [Box(box.x - left, box.y - top, box.width, box.height) for box in plates]
    shadow = style.shadow.offset if style.shadow.on else None
    return (
        TextLayout(style, lines, local, local_runs, width, height, picture_scale(layer, width, height), plates, radius, shadow),
        (left, top),
    )


def reached_scale(layer: TextLayer | Shape) -> float:
    """The largest scale a picture layer's item is drawn at: its Transform's, or its largest scale
    Keyframe's while its scale is keyed (the Keyframes replace it). Pop grows it to its scale, never
    past it (app/renderer.py's POP_FROM)."""
    keyed = layer.keys.get(KeyProperty.SCALE)
    return max(key.value for key in keyed) if keyed else layer.transform.scale


def picture_scale(layer: TextLayer | Shape, width: int, height: int) -> float:
    """The scale a picture layer's picture, `width` x `height` at scale 1, is rasterised at: the first
    of LAYER_PICTURE_SCALES its item's reached scale doesn't pass, and no more than MAX_LAYER_PICTURE
    on its longest side."""
    stepped = next((step for step in LAYER_PICTURE_SCALES if reached_scale(layer) <= step), LAYER_PICTURE_SCALES[-1])
    return round(min(stepped, MAX_LAYER_PICTURE / max(width, height)), 4)


def layer_picture(layout: PictureLayout, origin: tuple[float, float], layer: TextLayer | Shape, start: float) -> Picture:
    """How a picture layer's picture is drawn, its top-left corner at `origin` at scale 1: scaled,
    turned and faded by its item's Transform about its middle, as an Overlay's is. Keyed, it moves as
    an Overlay does (`with_motion`, its Keyframes from `start` seconds into the Clip), its whole
    picture scaled from its size at scale 1."""
    transform = layer.transform
    raster = layout.raster
    width, height = max(2, _even(layout.width * transform.scale)), max(2, _even(layout.height * transform.scale))
    centre = (origin[0] + layout.width / 2, origin[1] + layout.height / 2)
    across, down = turned_size(width, height, transform.rotation)
    bounds = Box(round(centre[0] - across / 2), round(centre[1] - down / 2), round(across), round(down))
    picture = Picture(
        Box(0, 0, *raster), raster, width, height, centre, transform.rotation, False, False, transform.opacity, bounds,
    )
    return with_motion(picture, layer.keys, start, (layout.width, layout.height))


def _turned_box(area: Box, centre: tuple[float, float], transform: Transform, to: tuple[float, float] | None = None) -> Box:
    """What holds `area` once scaled and turned by `transform` about `centre`, and moved for `centre`
    to be at `to` when that is given: rounded to the pixel as a picture's bounds are."""
    angle = math.radians(transform.rotation)
    cos, sin = math.cos(angle), math.sin(angle)
    # The area's middle, off `centre` by up to half a pixel, scaled and turned with it.
    u = (area.x + area.width / 2 - centre[0]) * transform.scale
    v = (area.y + area.height / 2 - centre[1]) * transform.scale
    x, y = to or centre
    x, y = x + u * cos - v * sin, y + u * sin + v * cos
    across, down = turned_size(area.width * transform.scale, area.height * transform.scale, transform.rotation)
    return Box(round(x - across / 2), round(y - down / 2), round(across), round(down))


def bounds_at(event: PictureLayer, time: float, frame: tuple[int, int]) -> Box:
    """What holds a picture layer's area at `time` seconds into the Clip, as its Keyframes have it then
    (`picture_at`, on `frame`): scaled and turned about its picture's sampled centre. Unkeyed, its `bounds`."""
    picture = event.picture
    if not picture.motion or picture.unscaled is None:
        return event.bounds
    drawn = picture_at(picture, time, frame)
    scale = drawn.width / picture.unscaled[0] if KeyProperty.SCALE in picture.motion else event.layer.transform.scale
    return _turned_box(event.area, picture.centre, replace(event.layer.transform, scale=scale, rotation=drawn.rotation), drawn.centre)


def text_runs(line: str, face_id: str) -> list[TextRun]:
    """`line` split into runs by Face and emoji (docs/adr/0010), not yet placed: each emoji sequence
    a run of its own, drawn from its image (app/emoji.py's `image_of`) on the line of the Face
    `face_id`; each other character in that Face, or in FALLBACK_FACE (CJK) when only that has it.
    An emoji with no image and a character neither Face has are left out: the line closes up round
    them. A space goes with the run it follows, when that run's Face has it."""
    kept: list[tuple[str, str | None]] = []
    for text, emoji in clusters(line):
        image = image_of(text) if emoji else None
        if text.isspace():
            if kept and kept[-1][0] != " ":
                kept.append((" ", None))
        elif image is not None or (not emoji and _run_face(text, face_id)):
            kept.append((text, image))
    if kept and kept[-1][0] == " ":
        kept.pop()
    runs: list[TextRun] = []
    for text, image in kept:
        last = runs[-1] if runs else None
        if image is not None:
            runs.append(TextRun(text, face_id, image=image))
            continue
        if last is not None and text == " " and text in font_metrics(last.face).advances:
            face = last.face
        else:
            face = _run_face(text, face_id)
        if face is None:
            continue
        if last is not None and last.face == face and (last.image is None or text == " "):
            runs[-1] = replace(last, text=last.text + text)
        else:
            runs.append(TextRun(text, face))
    return runs


def _run_face(char: str, face_id: str) -> str | None:
    """The Face a Text Layer in the Face `face_id` sets `char` in: its own, the fallback, or None."""
    for face in (face_id, FALLBACK_FACE):
        if char in font_metrics(face).advances:
            return face
    return None


def runs_width(runs: list[TextRun], size: float, tracking: float = 0.0) -> float:
    """How wide a line of `runs` is at font `size`, each measured in its own Face (an emoji 1 em),
    with `tracking` pixels after every character but the last."""
    width = sum(_run_width(run, run.text, size) for run in runs)
    count = sum(_character_count(run, run.text) for run in runs)
    return width + tracking * (count - 1) if tracking and count else width


def placed_runs(runs: list[TextRun], left: float, size: float, tracking: float = 0.0) -> list[TextRun]:
    """A line of `runs` set at font `size` from `left`, `tracking` pixels after every character but
    the last: each placed where the one before ends, and drawn without the spaces at its end."""
    placed, x = [], left
    for run in runs:
        drawn = run.text.rstrip()
        placed.append(replace(run, text=drawn, x=round(x, 4), width=round(_run_width(run, drawn, size, tracking), 4)))
        x += _run_width(run, run.text, size, tracking) + tracking
    return placed


def _run_width(run: TextRun, text: str, size: float, tracking: float = 0.0) -> float:
    """How wide `text`, the whole of `run`'s text or its start, is at font `size` in its Face, with
    `tracking` pixels after every character but the last. An emoji run's emoji is 1 em wide."""
    metrics = font_metrics(run.face)
    if run.image is None:
        return metrics.width(text, size, tracking)
    spaces = text[len(text.rstrip()) :]
    return emoji_size(run.face, size) + metrics.width(spaces, size) + tracking * len(spaces)


def _character_count(run: TextRun, text: str) -> int:
    """How many characters `text` of `run` counts for tracking: an emoji sequence is one."""
    return len(text) if run.image is None else 1 + len(text) - len(text.rstrip())


def emoji_size(face_id: str, size: float) -> float:
    """How wide an emoji is on a line of the Face `face_id` set at font `size`: 1 em of that Face
    (libass sets its ascent plus descent, not its em, at the size)."""
    metrics = font_metrics(face_id)
    return size * metrics.em / metrics.units


def emoji_square(run: TextRun, baseline: float, size: float) -> tuple[float, float, float]:
    """Where the emoji run `run` is drawn on a line set at font `size` with its baseline at
    `baseline`: the left and top of its square and its side, its width, centred down on the middle
    of the capitals of its line's Face. Its image fills the square across or down, keeping its
    shape."""
    metrics = font_metrics(run.face)
    middle = baseline - metrics.cap_height / metrics.units * size / 2
    return run.x, middle - run.width / 2, run.width


def fit_hook(text: str, style: HookStyle = HookStyle(), *, canvas: Canvas) -> tuple[list[str], float]:
    """How the hook `text` is set in `style` on `canvas`: its lines (none when it is blank) and their font size.
    The fewest lines, up to the style's max_lines, that fit in `hook_width` at its size with its
    tracking (or, with the style's own padding across, whose box is as wide as the captions' area),
    broken between words where the longest is shortest. Lines still too wide are set smaller (their
    tracking staying as wide, the style's padding shrinking with them), so that the longest just
    fits: the text fits when the size is the style's."""
    words = [word for word, _ in _hook_words(text, style.uppercase)]
    if not words:
        return [], style.size
    metrics = font_metrics(style.font)
    tracking = style.tracking
    own = style.padding_x is not None and style.shape != HookShape.NONE
    room, padding = (kicker_widest(canvas), 2 * style.padding_x) if own else (hook_width(canvas), 0.0)

    def widest(lines: list[str]) -> float:
        return max(metrics.width(line, style.size, tracking) for line in lines)

    for count in range(1, min(style.max_lines, len(words)) + 1):
        lines = _balanced(words, count, metrics, tracking * metrics.units / style.size)
        if widest(lines) + padding <= room:
            return lines, style.size
    size = min(style.size * (room - tracking * (len(line) - 1)) / (metrics.width(line, style.size) + padding) for line in lines)
    return lines, max(math.floor(size * 10) / 10, MIN_SIZE)


def _hook_padding(style: HookStyle, size: float) -> tuple[float, float]:
    """The hook's box padding across and down, in output pixels, set at `size`: the style's (given at
    its size), or its Shape's own: HOOK_PAD_X and HOOK_PAD_Y round a block (and round lines with no
    box, which the style's don't change), STRIP_PAD_X and STRIP_PAD_Y of the size round a strip."""
    if style.shape == HookShape.STRIPS:
        own = STRIP_PAD_X * size, STRIP_PAD_Y * size
    else:
        own = HOOK_PAD_X, HOOK_PAD_Y
    if style.shape == HookShape.NONE:
        return own
    scale = size / style.size
    return (
        own[0] if style.padding_x is None else style.padding_x * scale,
        own[1] if style.padding_y is None else style.padding_y * scale,
    )


def without_emoji(text: str) -> str:
    """`text` with its emoji left out and its whitespace collapsed."""
    return " ".join("".join(char for char in text if not is_emoji(char)).split())


def _hook_words(text: str, uppercase: bool) -> list[tuple[str, tuple[bool, ...]]]:
    """The hook `text`'s words as shown, each with which of its characters are emphasised: those
    between a pair of asterisks, which aren't shown (an unpaired last one is). Without emoji, and in
    capitals if `uppercase`."""
    stars = [i for i, char in enumerate(text) if char == "*"]
    paired = stars[: len(stars) // 2 * 2]
    marks = set(paired)
    chars: list[tuple[str, bool]] = []
    inside = False
    for i, char in enumerate(text):
        if i in marks:
            inside = not inside
        elif not is_emoji(char):
            # A capital may be more than one letter (ß is SS): each keeps the emphasis.
            chars.extend((shown, inside) for shown in (char.upper() if uppercase else char))
    words, word = [], []
    for char, emphasised in [*chars, (" ", False)]:
        if char.isspace():
            if word:
                words.append(("".join(c for c, _ in word), tuple(e for _, e in word)))
            word = []
        else:
            word.append((char, emphasised))
    return words


def _emphasis(words: list[tuple[str, tuple[bool, ...]]]) -> list[tuple[int, int]]:
    """The emphasised runs of a line of `words` (joined by spaces), as [start, end) ranges of its
    characters; a space between two emphasised characters is in their run."""
    flags = [flag for i, (_, word) in enumerate(words) for flag in ((False,) if i else ()) + word]
    for i in range(1, len(flags) - 1):
        flags[i] = flags[i] or (flags[i - 1] and flags[i + 1])
    spans, start = [], None
    for i, flag in enumerate([*flags, False]):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            spans.append((start, i))
            start = None
    return spans


def _balanced(words: list[str], count: int, metrics: "FontMetrics", tracking: float = 0.0) -> list[str]:
    """`words` on `count` lines, broken where the widest line is narrowest (of equals, with the
    earliest breaks), with `tracking` (in the font's units) after every character of a line but its
    last."""
    space = metrics.advances.get(" ", metrics.units) + tracking
    ends: list[float] = [0]
    for word in words:
        ends.append(ends[-1] + sum(metrics.advances.get(char, metrics.units) + tracking for char in word))

    def units(i: int, j: int) -> float:
        return ends[j] - ends[i] + (j - i - 1) * space - tracking

    # best[k][j]: the narrowest widest line of words[:j] on k lines, and where its last line starts.
    best = [{j: (units(0, j), 0) for j in range(1, len(words) + 1)}]
    for k in range(2, count + 1):
        best.append({
            j: min(((max(best[-1][i][0], units(i, j)), i) for i in range(k - 1, j)), key=lambda option: option[0])
            for j in range(k, len(words) + 1)
        })
    lines, j = [], len(words)
    for k in range(count, 0, -1):
        i = best[k - 1][j][1]
        lines.insert(0, " ".join(words[i:j]))
        j = i
    return lines


def _hook(
    text: str, duration: float, style: HookStyle, canvas: Canvas, start: float = 0.0, secs: float = HOOK_SECS, kicker: str = ""
) -> HookEvent | None:
    """The hook `text` from `start` for `secs` seconds of the Clip, which lasts `duration` (until its
    end, if that comes sooner), as large as its lines and padding, its lines centred in the frame
    or its middle at the style's x (kept in the frame), placed by `style`: just below the top of
    the Canvas's Safe Area, in the middle of the frame, just above the bottom of the Safe Area, or
    with its top at the style's height (kept inside the Safe Area).
    None when the text is blank or it would start at or after the Clip's end.

    A line is as wide as its letters and its tracking. A block (or no box) is its padding
    (_hook_padding) wider than the longest line either side, its first line's capitals its padding
    down below its top and the baselines the style's line_height sizes apart. Strips are each their
    line's width, padded, STRIP_GAP apart at the default line height. Left-aligned lines (and
    strips) start at the left of the longest.

    The `kicker`, if any, goes above them in a pill (`_kicker_pill`), centred over them or starting where
    they do, KICKER_GAP of the hook's size away. A Quote Mark (QUOTE_SCALE) is on the first line's
    corner: the lines move down by what of it sticks out above them, but not sideways, so they stay
    centred."""
    lines, size = fit_hook(text, style, canvas=canvas)
    start = round(max(start, 0.0), 3)
    if not lines or start >= duration:
        return None
    words, emphasis = _hook_words(text, style.uppercase), []
    for line in lines:
        count = len(line.split())
        emphasis.append(_emphasis(words[:count]))
        words = words[count:]
    metrics = font_metrics(style.font)
    widths = [metrics.width(line, size, style.tracking) for line in lines]
    left = style.align == HookAlign.LEFT
    pad_x, pad_y = _hook_padding(style, size)
    # Boxes from the hook's top-left corner, and anchors from where it is.
    if style.shape == HookShape.STRIPS:
        strip_height = math.ceil(metrics.letters_height(size) + 2 * pad_y)
        pitch = max(strip_height + round(STRIP_GAP * size) + round((style.line_height - HOOK_LEADING) * size), strip_height)
        strips = [math.ceil(line + 2 * pad_x) for line in widths]
        width, height = max(strips), (len(lines) - 1) * pitch + strip_height
        offsets = [0 if left else (width - strip) // 2 for strip in strips]
        boxes = [Box(x, i * pitch, strip, strip_height) for i, (x, strip) in enumerate(zip(offsets, strips))]

        def anchors(x: int, y: int) -> list[tuple[float, float]]:
            return [
                (x + box.x + box.width / 2, y + box.y + pad_y + metrics.cap_height / metrics.units * size) for box in boxes
            ]
    else:
        # The letters and the padding (whole pixels when it is the Shape's own), rounded up.
        width = math.ceil(max(widths) + 2 * pad_x)
        letters = metrics.letters_height(size) + (len(lines) - 1) * style.line_height * size
        height = math.ceil(letters + 2 * pad_y)
        boxes = [Box(0, 0, width, height)] if style.shape == HookShape.BLOCK else []

        def anchors(x: int, y: int) -> list[tuple[float, float]]:
            return [
                (x + pad_x + line / 2 if left else x + width / 2,
                 y + pad_y + (metrics.cap_height / metrics.units + i * style.line_height) * size)
                for i, line in enumerate(widths)
            ]
    # The lines' place in the whole hook, and the pill's.
    lines_x = lines_y = 0
    lines_height = height
    pill = _kicker_pill(kicker, size, style, canvas)
    if pill is not None:
        lines_y = pill.height + round(KICKER_GAP * size)
        if left:
            # From where the text starts, or nearer the left when that would take it past the
            # captions' width (and the safe area).
            pill_x = min(HOOK_PAD_X if style.shape == HookShape.NONE else 0, max(0, kicker_widest(canvas) - pill.width))
            full_width = max(width, pill_x + pill.width)
        else:
            full_width = max(width, pill.width)
            pill_x, lines_x = (full_width - pill.width) // 2, (full_width - width) // 2
        width = full_width
    badge = round(QUOTE_SCALE * size) if style.quote else 0
    # How far it reaches into the first line's box: into its padding.
    box_pad_x, box_pad_y = (0, 0) if style.shape == HookShape.NONE else (pad_x, pad_y)
    inset_x, inset_y = math.floor(QUOTE_INSET * box_pad_x), math.floor(QUOTE_INSET * box_pad_y)
    if badge:
        lines_y += badge - inset_y
    height = lines_y + lines_height
    safe = canvas.safe_area
    bottom = safe.y + safe.height - height
    top = {
        HookPosition.TOP: safe.y,
        HookPosition.MIDDLE: (canvas.height - height) // 2,
        HookPosition.BOTTOM: bottom,
        HookPosition.CUSTOM: min(max(canvas.y_from_reference(style.y), safe.y), bottom),
    }[style.position]
    area = Box((canvas.width - width) // 2, top, width, height)
    placed = None
    if pill is not None:
        box = Box(area.x + pill_x, area.y, pill.width, pill.height)
        baseline = box.y + pill.pad_y + metrics.cap_height / metrics.units * pill.size
        placed = HookKicker(pill.text, pill.size, box, (box.x + box.width / 2, baseline))
    placed_anchors = anchors(area.x + lines_x, area.y + lines_y)
    placed_boxes = [Box(area.x + lines_x + box.x, area.y + lines_y + box.y, box.width, box.height) for box in boxes]
    quote = None
    if badge:
        if placed_boxes:
            corner_x, corner_y = placed_boxes[0].x, placed_boxes[0].y
        else:
            x, baseline = placed_anchors[0]
            corner_x, corner_y = x - widths[0] / 2, baseline - metrics.cap_height / metrics.units * size
        quote = Box(math.floor(corner_x) + inset_x - badge, math.floor(corner_y) + inset_y - badge, badge, badge)
        left_edge, right_edge = min(area.x, quote.x), max(area.x + area.width, quote.x + quote.width)
        area = Box(left_edge, area.y, right_edge - left_edge, area.height)
    # With its middle at the style's x, or as near as keeps it in the frame.
    dx = 0 if style.x is None else min(max((2 * canvas.x_from_reference(style.x) - area.width) // 2, 0), canvas.width - area.width) - area.x
    if dx and placed is not None:
        placed = replace(placed, box=_shifted(placed.box, dx), anchor=(placed.anchor[0] + dx, placed.anchor[1]))
    return HookEvent(
        lines,
        start,
        round(min(start + secs, duration), 3),
        _shifted(area, dx),
        size,
        anchors=[(x + dx, y) for x, y in placed_anchors],
        boxes=[_shifted(box, dx) for box in placed_boxes],
        emphasis=emphasis,
        kicker=placed,
        quote=quote and _shifted(quote, dx),
    )


def _shifted(box: Box, dx: int) -> Box:
    return Box(box.x + dx, box.y, box.width, box.height) if dx else box


@dataclass(frozen=True)
class _KickerPill:
    """The Kicker as shown, its font size, its pill's width and height, and the padding above its capitals."""

    text: str
    size: float
    width: int
    height: int
    pad_y: float


def _kicker_pill(text: str, size: float, style: HookStyle, canvas: Canvas) -> _KickerPill | None:
    """The Kicker `text` over a hook set at `size` (without emoji, in capitals if the style is), set
    smaller when its pill would be wider than `kicker_widest` on `canvas`. None when it is blank."""
    widest = kicker_widest(canvas)
    text = without_emoji(text)
    if style.uppercase:
        text = text.upper()
    if not text:
        return None
    metrics = font_metrics(style.font)
    pill_size = KICKER_SCALE * size
    padded = metrics.width(text, pill_size) + 2 * KICKER_PAD_X * pill_size
    if padded > widest:
        pill_size = math.floor(pill_size * widest / padded * 10) / 10
    pad_y = KICKER_PAD_Y * pill_size
    width = math.ceil(metrics.width(text, pill_size) + 2 * KICKER_PAD_X * pill_size)
    height = math.ceil(metrics.letters_height(pill_size) + 2 * pad_y)
    return _KickerPill(text, pill_size, width, height, pad_y)


@dataclass(frozen=True)
class FontMetrics:
    """The measures of a font captions or the hook are set in, in its units. libass sets a font so
    that its Windows ascent plus descent, `units`, is the font size."""

    # The advance width of each character the font has.
    advances: dict[str, int]
    units: int
    # Units per em: a browser sets a font so that this is its font size.
    em: int
    # The Windows ascent, from the top of a line to its baseline.
    ascent: int
    # How tall capitals are, and how far below the baseline descenders (g, p) go.
    cap_height: int
    descent: int

    def width(self, text: str, size: float, tracking: float = 0.0) -> float:
        """How wide `text` is at font `size`, in pixels, with `tracking` pixels after every character
        but the last; a character the font hasn't got counts a size wide."""
        width = sum(self.advances.get(char, self.units) for char in text) / self.units * size
        return width + tracking * (len(text) - 1) if tracking and text else width

    def letters_height(self, size: float) -> float:
        """How tall a line's letters are at font `size`, in pixels: from the top of its capitals to the
        bottom of its descenders."""
        return (self.cap_height + self.descent) / self.units * size

    def centre_y(self, baseline: float, size: float) -> float:
        """Where libass centres a line set at font `size` down (\\an5) for its baseline to be at
        `baseline`: the middle of its ascent above the baseline and its descent below, which together
        are the font size."""
        return baseline - self.ascent / self.units * size + size / 2


@cache
def font_metrics(font_id: str = DEFAULT_FONT) -> FontMetrics:
    """A Face's measures (app/fonts.py), read with fontTools; cleared whenever the Faces change.
    MissingFace when its file is gone."""
    from fontTools.ttLib import TTFont

    file = TTFont(registry().file(font_id), lazy=True)
    widths = file["hmtx"]
    os2 = file["OS/2"]
    return FontMetrics(
        advances={chr(code): widths[glyph][0] for code, glyph in file.getBestCmap().items()},
        units=os2.usWinAscent + os2.usWinDescent,
        em=file["head"].unitsPerEm,
        ascent=os2.usWinAscent,
        cap_height=os2.sCapHeight,
        descent=-os2.sTypoDescender,
    )


on_change(font_metrics.cache_clear)


@dataclass(frozen=True)
class _Spoken:
    """A Word as captions show it, on the Clip's timeline; as it is written (`plain`, with its Word
    Edit), and the middle of it on its own timeline (the Source's or a Media Library item's), which
    keys a Cue it starts."""

    text: str
    start: float
    end: float
    ends_sentence: bool
    # Edited to start a line.
    breaks_before: bool = False
    plain: str = ""
    key: CueKey = CueKey(0.0)
    # Its Cue Edit (in seconds into the Clip), and its place among those given: of the Cue it starts,
    # or, a `join`, keeping it with the Cue before.
    cue_edit: CueEdit | None = None
    cue_edit_index: int = -1


class TimelineKeyed(Protocol):
    """What is keyed to a Word as a Word Edit is: a time, on the Source's timeline or (with `media`)
    on that Media Library item's (docs/adr/0020)."""

    @property
    def at(self) -> float: ...

    @property
    def media(self) -> str | None: ...


Keyed = TypeVar("Keyed", bound=TimelineKeyed)


def match_edits(words: list[Word], edits: list[Keyed], timelines: list[str | None] | None = None) -> list[Keyed | None]:
    """Each Word's Word Edit or Cue Edit (anything keyed as one), or None: the Words and
    the edits' times on the same clock. An edit applies to the Word whose span holds its time, else
    to the nearest Word within WORD_EDIT_REACH_SECS; of two edits of one Word, the later in `edits`.
    With `timelines` (each Word's: None for the Source's, else its Media Library item's), an edit
    applies only to a Word of its own timeline, its `media`; without them, to any Word."""
    matched: list[Keyed | None] = [None] * len(words)
    for edit in edits:
        best, distance = None, WORD_EDIT_REACH_SECS
        for i, word in enumerate(words):
            if timelines is not None and timelines[i] != edit.media:
                continue
            gap = max(word.start - edit.at, edit.at - word.end, 0.0)
            if gap < distance:
                best, distance = i, gap
            if gap == 0:
                break
        if best is not None:
            matched[best] = edit
    return matched


def _captions(
    words: list[Word],
    scenes: list[ScenePlan],
    duration: float,
    style: CaptionStyle,
    edits: list[WordEdit],
    cuts: list[float] | None = None,
    at: list[CueKey] | None = None,
    cue_edits: list[tuple[int, CueEdit]] | None = None,
    speeds: list[float] | None = None,
    given_ats: list[float] | None = None,
    *,
    canvas: Canvas,
) -> tuple[list[Cue], set[int]]:
    """The Cues of `words` over the Clip, which lasts `duration` and is laid out in `scenes`, in
    `style`, with the Word Edits `edits` applied (match_edits): an edited Word shows the edit's text
    (none, when it is empty) and a Word edited to break starts a Cue. Each Word's middle on its own
    timeline (the Source's, or its Media Library item's) is in `at` (in the same order; without it,
    its middle into the Clip), which keys the Cue it starts.

    The Words whose middle is in the Clip are taken in order into a Cue, in UPPERCASE (unless the
    style keeps their case) and without the punctuation at their ends, until the next wouldn't fit
    its lines (`_fits`: the style's max_lines lines of max_chars and max_words, a Word edited to
    break starting a line of its own), would make it last more than max_secs, comes after a pause of
    its pause_secs, follows the end of a sentence, or starts in a Scene whose captions go elsewhere.
    The Cue's Words are then set on its lines (`_lines`), its widest line sizing and placing it. A
    Cue starts with its first Word and ends CAPTION_LINGER_SECS after its last, when the next Cue
    starts if that is sooner, and after max_secs at most. A Word is highlighted from when it is
    spoken until the next one is.
    A Cue still being spoken at a Layout change that moves the captions moves there with it (unless
    that would show it for less than CAPTION_MIN_SECS in one place); one whose Words are all spoken
    goes at the change. At each of `cuts` (where a Segment ends and the next starts), a Cue ends and
    the next starts. A Cue is joinable when it and the one before, in one Scene's place and not
    parted by a cut, would fit one Cue's lines (`_fits`, the break before its first Word lifted). It
    needs a join when a pause, the sentence's end or max_secs (to its first Word: only that break is
    what a join cancels) parts it from the one before.

    `cue_edits` (in seconds into the Clip, their times already divided by their Segment's Speed, each
    with its place among those given) are matched to the Words as Word Edits are. A Cue Edit's Word
    always starts a Cue. Once planned, its Cue is moved by its `shift`, its edges by `start_delta`
    and `end_delta`, then kept in its Segment (between the cuts either side of it), not before the
    Cue before ends nor after the Cue after starts (where that is moved later, else its first Word;
    the earlier of two Cues keeps its place), and CAPTION_MIN_SECS long at least: a Cue moved later
    leaves itself that before what follows, and one spoken closer than that to what follows starts
    earlier, the Cue before giving way (but for its own first CAPTION_MIN_SECS). Where its Segment
    leaves less, it fills its room; it is never dropped. Its Words'
    highlight moves with it, kept in it, the first from when it comes up. Its `x` and `y` place it as
    the style's custom position and x would (at its own height, it stays put at a Layout change),
    and its `scale` multiplies the style's size before a line too wide is set smaller. A `join` Cue
    Edit's Word instead goes on in the Cue before, despite a pause, a sentence's end or max_secs,
    when it fits its lines and isn't parted by a cut or a Layout change; else it starts a Cue
    unmoved and in the style's place. It cancels only that break: max_secs still counts from the
    Cue's first Word, so the Words after the joined one break off where it would part them, and the
    Cue shows to the joined Word's end but lingers no longer. Each Cue carries its bounds, its
    Segment's Speed (of `speeds`, one per Segment; without them, 1), its Words' keys and the `at` of
    each one's Cue Edit (as given, of `given_ats` by its place; without them, as in `cue_edits`).
    Also returned: the places of the Cue Edits whose Word is shown."""
    cuts = cuts or []
    retimes = cue_edits or []
    # Each Cue Edit's `at` as it was given, by its place, which names it on the Cue it applies to.
    named = given_ats if given_ats is not None else {i: edit.at for i, edit in retimes}
    keys = at if at is not None else [CueKey(round((word.start + word.end) / 2, 3)) for word in words]
    spoken = []
    heard = sorted(zip(words, keys), key=lambda pair: pair[0].start)
    ordered = [word for word, _ in heard]
    timelines = [key.media for _, key in heard]
    retimed = match_edits(ordered, [edit for _, edit in retimes], timelines)
    places = {id(edit): i for i, edit in retimes}
    for (word, key), edit, retime in zip(heard, match_edits(ordered, edits, timelines), retimed):
        given = edit.text if edit is not None and edit.text is not None else word.text
        text, ends_sentence = _caption_text(given, style.uppercase)
        if text and 0 <= (word.start + word.end) / 2 < duration:
            breaks = edit is not None and edit.break_before
            spoken.append(_Spoken(
                text, max(word.start, 0.0), min(max(word.end, word.start), duration), ends_sentence, breaks, given.strip(), key,
                retime, places[id(retime)] if retime is not None else -1,
            ))

    areas = [_caption_area(style, scene, canvas) for scene in scenes]
    # The Layout changes that move the captions.
    moves = [scene.start for scene, area, before in zip(scenes[1:], areas[1:], areas) if area != before]

    def area_at(at: float) -> Box:
        return next(area for scene, area in zip(reversed(scenes), reversed(areas)) if scene.start <= at or scene is scenes[0])

    def parted(before: list[_Spoken], word: _Spoken) -> bool:
        # A Cue can't go on past a cut, nor into a Scene whose captions go elsewhere.
        return area_at(word.start) != area_at(before[0].start) or any(before[0].start < cut <= word.start for cut in cuts)

    def held(cue: list[_Spoken], word: _Spoken) -> bool:
        # What a `join` cancels: a pause, a sentence's end, or the longest Cue (from its first Word).
        return word.end - cue[0].start > style.max_secs or word.start - cue[-1].end >= style.pause_secs or cue[-1].ends_sentence

    cues: list[list[_Spoken]] = []
    for word in spoken:
        cue = cues[-1] if cues else None
        join = word.cue_edit is not None and word.cue_edit.join
        if cue is not None and join and _fits([*cue, word], style) and not parted(cue, word):
            cue.append(word)
        elif (
            cue is None
            or word.cue_edit is not None
            or not _fits([*cue, word], style)
            or held(cue, word)
            or parted(cue, word)
        ):
            cues.append([word])
        else:
            cue.append(word)

    bounds = [0.0, *cuts, duration]

    def segment_index(cue: list[_Spoken]) -> int:
        # Its Segment's: between the cuts either side of its first Word.
        return next(i for i, high in enumerate(bounds[1:]) if cue[0].start < high or i == len(bounds) - 2)

    def segment_of(cue: list[_Spoken]) -> tuple[float, float]:
        # Its Segment's span on the Timeline.
        i = segment_index(cue)
        return bounds[i], bounds[i + 1]

    # What the Cue before each may not pass, from the last Cue back: its first Word's start; for an
    # edited one, later where its Cue Edit moves its start later (moved earlier, it gives way to the
    # Cue before), but leaving it CAPTION_MIN_SECS before what it may not pass in turn; and where its
    # Words start closer to that than CAPTION_MIN_SECS, earlier, so that it is still shown that long
    # (but not into the Cue before's first CAPTION_MIN_SECS, nor out of its Segment).
    reaches = [0.0] * len(cues)
    for i in reversed(range(len(cues))):
        first, edit = cues[i][0].start, cues[i][0].cue_edit
        if edit is None or edit.join:
            reaches[i] = first
            continue
        low, high = segment_of(cues[i])
        top = (min(high, reaches[i + 1]) if i + 1 < len(cues) else high) - CAPTION_MIN_SECS
        if first <= top:
            reaches[i] = min(max(first + edit.shift + edit.start_delta, first), top)
        else:
            reaches[i] = min(first, max(top, low, cues[i - 1][0].start + CAPTION_MIN_SECS if i else low))

    metrics = font_metrics(style.font)
    events = []
    shown_end = 0.0
    for i, cue in enumerate(cues):
        start = cue[0].start
        # Shown max_secs at most, but to the end of a Word a join kept in it past that.
        longest = max([cue[0].start + style.max_secs, *(word.end for word in cue[1:] if word.cue_edit is not None)])
        end = min(cue[-1].end + CAPTION_LINGER_SECS, longest, duration)
        if i + 1 < len(cues):
            end = min(end, reaches[i + 1])
        end = min([end, *(at for at in [*moves, *cuts] if cue[-1].end <= at < end)])
        edit, shift = cue[0].cue_edit, 0.0
        if edit is not None and edit.join:
            edit = None
        # Where a Cue Edit keeps it: in its Segment, after the Cue before ends, before the Cue after
        # (reaches). Its room is never empty; it is CAPTION_MIN_SECS long but where its Segment, or
        # the Cue before's first CAPTION_MIN_SECS, leaves it less, which it then fills.
        part = segment_of(cue)
        low, high = max(part[0], shown_end), min(part[1], reaches[i + 1]) if i + 1 < len(cues) else part[1]
        if edit is not None:
            shift = edit.shift
            start = min(max(start + shift + edit.start_delta, low), high - CAPTION_MIN_SECS)
            end = min(max(end + shift + edit.end_delta, start + CAPTION_MIN_SECS), high)
            start = max(start, low)
        if end <= start:
            continue
        shown_end = end
        lines = _lines(cue, style) or [cue]
        texts = [" ".join(word.text for word in line) for line in lines]
        widest = max(texts, key=lambda text: metrics.width(text, style.size, style.tracking))
        starts = [min(max(word.start + shift, start), end) for word in cue]
        starts[0] = start
        timed = iter(zip(starts, [*starts[1:], end]))
        highlights = [[(word, *next(timed)) for word in line] for line in lines]
        # Placed at its own height, it stays there at a Layout change.
        placed = edit is not None and edit.y is not None
        edges = [start, *(at for at in moves if start < at < end and not placed), end]
        # Each part of the line between Layout changes, where it is shown: one too short joins the next
        # (the last, the one before it), taking the next one's place.
        parts = [[a, b, area_at(a)] for a, b in zip(edges, edges[1:])]
        while len(parts) > 1:
            short = next((i for i, (a, b, _) in enumerate(parts) if b - a < CAPTION_MIN_SECS), None)
            if short is None:
                break
            if short + 1 < len(parts):
                parts[short + 1][0] = parts[short][0]
            else:
                parts[short - 1][1] = parts[short][1]
            del parts[short]
        joined = [*cues[i - 1], replace(cue[0], breaks_before=False), *cue[1:]] if i > 0 else []
        joinable = i > 0 and not parted(cues[i - 1], cue[0]) and _fits(joined, style)
        needs_join = i > 0 and held(cues[i - 1], cue[0])
        # A Cue Edit's x is the Candidate's, on the Canvas; the style's is in the Reference Space.
        x = edit.x if edit is not None and edit.x is not None else None if style.x is None else canvas.x_from_reference(style.x)
        scale = edit.scale if edit is not None and edit.scale is not None else 1.0
        for a, b, area in parts:
            if placed:
                area = _custom_caption_area(edit.y, canvas)
            size = _caption_size(widest, area, style, scale)
            events.append(Cue(
                start=round(a, 3),
                end=round(b, 3),
                lines=[[CaptionWord(word.text, round(min(max(on, a), b), 3), round(min(max(off, a), b), 3))
                        for word, on, off in line] for line in highlights],
                plain=[" ".join(word.plain for word in line) for line in lines],
                area=_caption_placed(widest, _caption_box(area, len(lines), size), size, style, x, canvas),
                size=size,
                key=cue[0].key,
                edited=edit is not None,
                joinable=joinable,
                needs_join=needs_join,
                low=round(low, 3),
                high=round(high, 3),
                speed=speeds[segment_index(cue)] if speeds else 1.0,
                word_ats=[word.key.at for word in cue],
                cue_edit_ats=[named[word.cue_edit_index] if word.cue_edit is not None else None for word in cue],
            ))
    return events, {word.cue_edit_index for word in spoken if word.cue_edit is not None}


def _fits(words: list[_Spoken], style: CaptionStyle) -> bool:
    """Whether `words` fit the style's line limits as one Cue (`_lines`)."""
    return _lines(words, style) is not None


def _lines(words: list[_Spoken], style: CaptionStyle) -> list[list[_Spoken]] | None:
    """`words` as a Cue's lines: the fewest, up to the style's max_lines, that fit its line limits
    (each line of at most max_chars characters, as _caption_length counts them, unless it is one
    Word, and of at most max_words Words), broken where the longest line is shortest (of equals, with
    the earliest breaks) and before each Word edited to start a line; None when even max_lines lines
    don't fit."""
    starts = {i for i, word in enumerate(words) if word.breaks_before and i}
    # Each run of words that can be one line, by its ends, and how long it counts.
    lengths: dict[tuple[int, int], float] = {}
    for i in range(len(words)):
        for j in range(i + 1, len(words) + 1):
            if (j - 1 > i and j - 1 in starts) or (style.max_words is not None and j - i > style.max_words):
                break
            length = _caption_length(" ".join(word.text for word in words[i:j]), style)
            if j - i > 1 and length > style.max_chars:
                break
            lengths[i, j] = length
    # best[k][j]: the shortest longest line of words[:j] on k + 1 lines, and where its last line starts.
    best = [{j: (length, 0) for (i, j), length in lengths.items() if i == 0}]
    for _ in range(1, style.max_lines):
        if len(words) in best[-1]:
            break
        more: dict[int, tuple[float, int]] = {}
        for (i, j), length in lengths.items():
            if i in best[-1]:
                option = (max(best[-1][i][0], length), i)
                if j not in more or option < more[j]:
                    more[j] = option
        best.append(more)
    if len(words) not in best[-1]:
        return None
    lines, j = [], len(words)
    for k in range(len(best) - 1, -1, -1):
        i = best[k][j][1]
        lines.insert(0, words[i:j])
        j = i
    return lines


def _caption_box(area: Box, count: int, size: float) -> Box:
    """`area`, as tall as `count` lines set at `size` (one each) when they are taller than it, about
    its middle."""
    height = 2 * math.ceil(count * size / 2)
    if height <= area.height:
        return area
    return replace(area, y=round(area.y + area.height / 2 - height / 2), height=height)


def _caption_length(text: str, style: CaptionStyle) -> float:
    """How many characters a caption line counts for against the style's max_chars: its own, as wide
    as the style's tracking makes them (more when it spaces them out, fewer when it pulls them in)."""
    if not style.tracking:
        return len(text)
    metrics = font_metrics(style.font)
    return len(text) * metrics.width(text, style.size, style.tracking) / metrics.width(text, style.size)


def _caption_placed(text: str, area: Box, size: float, style: CaptionStyle, x: float | None, canvas: Canvas) -> Box:
    """`area` moved to have its middle at `x` (the style's, or a Cue Edit's), or as near as keeps the
    line set in it at `size` (with its outline and tracking) in the frame. Without an x, it stays
    centred."""
    if x is None:
        return area
    half = (font_metrics(style.font).width(text, size, style.tracking) + 2 * style.outline) / 2
    centre = min(max(x, half), canvas.width - half)
    return _shifted(area, round(centre - area.width / 2) - area.x)


def _caption_area(style: CaptionStyle, scene: ScenePlan, canvas: Canvas) -> Box:
    """Where a caption line is centred on `canvas` in `scene` (its places are the Canvas's). On Auto:
    on the seam of a stacked Split, under Blur's shot when there is room below it in the Safe Area,
    and otherwise in the lower third."""
    match style.position:
        case CaptionPosition.AUTO:
            if scene.layout is SceneLayout.SPLIT and canvas.stacked:
                return canvas.seam_captions
            if scene.layout is SceneLayout.BLUR and (below := canvas.captions_below(scene.panels[-1].area)) is not None:
                return below
            return canvas.lower_captions
        case CaptionPosition.TOP:
            return canvas.top_captions
        case CaptionPosition.MIDDLE:
            return canvas.seam_captions
        case CaptionPosition.BOTTOM:
            return canvas.lower_captions
        case CaptionPosition.CUSTOM:
            return _custom_caption_area(canvas.y_from_reference(style.y), canvas)


def _custom_caption_area(y: float, canvas: Canvas) -> Box:
    """Where a caption line centred at height `y` goes, kept inside the Safe Area of `canvas`."""
    lower, safe = canvas.lower_captions, canvas.safe_area
    half = lower.height // 2
    centre = min(max(round(y), safe.y + half), safe.y + safe.height - half)
    return replace(lower, y=centre - half)


def _caption_size(text: str, area: Box, style: CaptionStyle, scale: float = 1.0) -> float:
    """The font size for a caption line: the style's (times `scale`, a Cue Edit's), or smaller if the
    line (with its outline and tracking) would be wider than its area at that size. Its tracking
    stays as wide at any size."""
    outline, tracking = style.outline, style.tracking * (len(text) - 1)
    wanted = round(style.size * scale, 1)
    width = font_metrics(style.font).width(text, wanted) + tracking + 2 * outline
    if width <= area.width:
        return wanted
    size = math.floor(wanted * (area.width - 2 * outline - tracking) / (width - 2 * outline - tracking) * 10) / 10
    return max(size, MIN_SIZE)


def _caption_text(text: str, uppercase: bool = True) -> tuple[str, bool]:
    """A Word as captions show it, in UPPERCASE (or its own case) without the punctuation at its ends
    (empty when it is all punctuation), and whether it ends a sentence."""

    def punctuation(char: str) -> bool:
        return unicodedata.category(char)[0] == "P" and char not in _SIGNS

    shown = without_emoji(text)
    first, last = 0, len(shown)
    while first < last and punctuation(shown[first]):
        first += 1
    while last > first and punctuation(shown[last - 1]):
        last -= 1
    ends_sentence = any(char in ".?!…" for char in shown[last:])
    marks = "".join(char for char in shown[last:] if char in "?!")
    shown = shown[first:last] + marks
    return (shown.upper() if uppercase else shown) if first < last else "", ends_sentence


def _merge_short(edges: list[float]) -> list[tuple[float, float]]:
    """The Scenes between `edges`, with each one shorter than MIN_SCENE_SECS joined to the Scene
    before it (the first to the one after it)."""
    shots: list[tuple[float, float]] = []
    for a, b in zip(edges, edges[1:]):
        if shots and b - a < MIN_SCENE_SECS - 1e-9:
            shots[-1] = (shots[-1][0], b)
        else:
            shots.append((a, b))
    if len(shots) > 1 and shots[0][1] - shots[0][0] < MIN_SCENE_SECS - 1e-9:
        shots[:2] = [(shots[0][0], shots[1][1])]
    return shots


def _face_count(frames: list[FrameFaces]) -> int:
    """How many faces a Scene shows: the median count of LAYOUT_SAMPLES of its sampled frames, spread
    evenly through it (all of them in a Scene with fewer), so that a missed or false detection or two
    doesn't change it."""
    if not frames:
        return 0
    if len(frames) > LAYOUT_SAMPLES:
        frames = [frames[(2 * i + 1) * len(frames) // (2 * LAYOUT_SAMPLES)] for i in range(LAYOUT_SAMPLES)]
    counts = sorted(len(frame.faces) for frame in frames)
    return counts[len(counts) // 2]


def _choose(layout: Layout, count: int | None) -> SceneLayout:
    """The Scene's Layout: the override, or by its face count (Track when it wasn't analysed)."""
    if layout is not Layout.AUTO:
        return SceneLayout(layout.value)
    if count is None or count == 1:
        return SceneLayout.TRACK
    return SceneLayout.SPLIT if count == 2 else SceneLayout.BLUR


def _track(
    start: float, end: float, faces: list[FrameFaces] | None, source: SourceMetadata, camera: CameraTuning, canvas: Canvas
) -> Panel:
    """A crop of the Canvas's shape, of the frame's full height (or its full width, on a Canvas wider
    than the Source), that follows the speaker's face through the Scene from `start` to `end`; in the
    middle of the frame while no face is known."""
    panel = _filled(source.width, source.height, start, canvas)
    if not faces:
        return panel
    tracked = _track_faces(faces, source.width, source.height, camera)
    return _follow(panel, _follow_speaker(tracked, source.fps, camera), start, end, source, camera)


def _split(
    start: float, end: float, faces: list[FrameFaces] | None, source: SourceMetadata, camera: CameraTuning, canvas: Canvas
) -> list[Panel]:
    """Two crops, each about half as wide as the frame and of its panel's shape (9:8 on 9:16), for the
    Canvas's two panels (`Canvas.split_panels`: stacked, or side by side on 1:1 and 16:9): the two faces
    seen most in the Scene's sampled frames `faces`, each followed by its own camera, the left one's on
    top or on the left. Without `faces`, the frame's left half there and its right half in the other."""
    width, height = source.width, source.height
    boxes = canvas.split_panels
    panel_width, panel_height = boxes[0].width, boxes[0].height
    crop_width = _even_floor(width / 2)
    crop_height = _even(crop_width * panel_height / panel_width)
    if crop_height > _even_floor(height):
        crop_height = _even_floor(height)
        crop_width = _even(crop_height * panel_width / panel_height)
    y = _centred(height, crop_height)
    halves = [
        Panel(box, crop_width, crop_height, [CropPoint(start, min(max(_even(centre - crop_width / 2), 0), _even_floor(width - crop_width)), y)])
        for box, centre in zip(boxes, (width / 4, width * 3 / 4))
    ]
    if not faces:
        return halves
    tracked = _track_faces(faces, width, height, camera)
    seen = Counter(id for frame in tracked for id in frame.faces)
    area = Counter()
    for frame in tracked:
        for id, face in frame.faces.items():
            area[id] += face.width * face.height
    pair = sorted(seen, key=lambda id: (-seen[id], -area[id]))[:2]
    if len(pair) < 2:
        return halves
    centre = {id: sum(f.faces[id].centre_x for f in tracked if id in f.faces) / seen[id] for id in pair}
    pair.sort(key=centre.__getitem__)
    # Side by side, a panel is tall enough for the face to sit in its middle.
    rise = (0.5 - SPLIT_FACE_AT) * crop_height if canvas.stacked else 0.0
    return [
        _follow(panel, [(frame.at, frame.faces.get(id)) for frame in tracked], start, end, source, camera, rise)
        for panel, id in zip(halves, pair)
    ]


def _blur(start: float, source: SourceMetadata, canvas: Canvas) -> list[Panel]:
    """The whole frame as large as fits on `canvas`, centred over the largest crop of the Canvas's
    shape from its middle, blurred, which fills it."""
    background = replace(_filled(source.width, source.height, start, canvas), blur=True)
    return [background, _fitted(source.width, source.height, start, canvas)]


def _follow(
    panel: Panel,
    targets: list[tuple[float, Face | None]],
    start: float,
    end: float,
    source: SourceMetadata,
    camera: CameraTuning,
    rise: float = 0.0,
) -> Panel:
    """`panel` with its crop following the face of `targets` (its box at each sampled frame, or None
    where it isn't seen) through the Scene from `start` to `end`, a Smooth Camera on each axis. The
    crop's centre is aimed `rise` pixels below the face's centre, so that the face sits above the
    middle."""
    width, height = panel.crop_width, panel.crop_height
    axes = [
        _camera_path(
            [(at, None if face is None else centre(face)) for at, face in targets],
            start, end, source.fps, size / 2, frame - size / 2, size, camera,
        )
        for centre, size, frame in (
            (lambda face: face.centre_x, width, source.width),
            (lambda face: face.centre_y + rise, height, source.height),
        )
    ]
    highest_x, highest_y = _even_floor(source.width - width), _even_floor(source.height - height)
    path: list[CropPoint] = []
    for (at, centre_x), (_, centre_y) in zip(*axes):
        x = min(max(_even(centre_x - width / 2), 0), highest_x)
        y = min(max(_even(centre_y - height / 2), 0), highest_y)
        if not path:
            path.append(CropPoint(start, x, y))
        elif (x, y) != (path[-1].x, path[-1].y):
            path.append(CropPoint(round(at, 3), x, y))
    return replace(panel, path=path)


@dataclass(frozen=True)
class _TrackedFrame:
    """A sampled frame's faces by identity, and the score of every identity seen so far in the Scene."""

    at: float
    faces: dict[int, Face]
    scores: dict[int, float]


def _track_faces(frames: list[FrameFaces], width: int, height: int, camera: CameraTuning) -> list[_TrackedFrame]:
    """Identify the faces of one Scene's sampled frames (in time order, `width` x `height` pixels): a
    face is the same as the one last seen nearest to it, if that is within camera.match_distance x
    `width`. Each identity's score is its area as a share of the frame, summed over the frames it is
    seen in with camera.score_decay at every frame, so a face that is large and often seen scores high."""
    limit = camera.match_distance * width
    centres: dict[int, tuple[float, float]] = {}
    scores: dict[int, float] = {}
    tracked = []
    for frame in frames:
        scores = {id: score * camera.score_decay for id, score in scores.items()}
        pairs = sorted(
            (distance, i, id)
            for i, face in enumerate(frame.faces)
            for id, (x, y) in centres.items()
            if (distance := math.hypot(face.centre_x - x, face.centre_y - y)) < limit
        )
        matched: dict[int, int] = {}
        for _, i, id in pairs:
            if i not in matched and id not in matched.values():
                matched[i] = id
        seen = {}
        for i, face in enumerate(frame.faces):
            id = matched.get(i, len(centres))
            centres[id] = (face.centre_x, face.centre_y)
            scores[id] = scores.get(id, 0.0) + face.width * face.height / (width * height)
            seen[id] = face
        tracked.append(_TrackedFrame(frame.at, seen, dict(scores)))
    return tracked


def _follow_speaker(tracked: list[_TrackedFrame], fps: float, camera: CameraTuning) -> list[tuple[float, Face | None]]:
    """The Speaker Tracker: the face to follow at each of one Scene's sampled frames, or None where it
    isn't seen. The first face seen is followed, the highest-scoring if there are several. Another face
    seen takes over once its score is over camera.stickiness x the target's, unless the target changed
    less than camera.cooldown_frames ago."""
    cooldown = camera.cooldown_frames / fps
    target: int | None = None
    since = 0.0
    follow = []
    for frame in tracked:
        rivals = [id for id in frame.faces if id != target]
        best = max(rivals, key=frame.scores.__getitem__, default=None)
        if best is not None and (
            target is None
            or frame.at - since >= cooldown and frame.scores[best] > camera.stickiness * frame.scores[target]
        ):
            target, since = best, frame.at
        follow.append((frame.at, frame.faces.get(target) if target is not None else None))
    return follow


def _camera_path(
    targets: list[tuple[float, float | None]],
    start: float,
    end: float,
    fps: float,
    lowest: float,
    highest: float,
    crop: float,
    camera: CameraTuning,
) -> list[tuple[float, float]]:
    """The Smooth Camera along one axis: where the crop's centre is at each frame of the Scene from
    `start` to `end` (seconds into the Clip, frames at multiples of 1/`fps`), kept between `lowest`
    and `highest`, for a crop `crop` pixels long on that axis. `targets` are the target face's centre
    at the sampled frames, in time order, or None where it wasn't seen.

    The camera starts on the target's first known position (in the middle without one) and heads
    for a goal, which moves to where the target is seen once the target leaves the dead-zone around
    it. A target seen farther from where it was last seen than the dead-zone's half-width has jumped:
    it counts once camera.confirmations detections in a row have jumped the same way, so that one
    wrong detection is ignored. Missing detections leave
    the goal where it is. Between the sampled frames, and towards a new goal, the camera moves as a
    critically damped spring, at most camera.max_speed crops a second."""
    zone = camera.dead_zone * crop / 2
    top_speed = camera.max_speed * crop
    step = 1 / fps

    def inside(value: float) -> float:
        return min(max(value, lowest), highest)

    known = [inside(at) for _, at in targets if at is not None]
    goal = known[0] if known else inside((lowest + highest) / 2)
    position, speed = goal, 0.0
    # Where the target was last seen, and the detections since that jumped away from it.
    trail = goal
    jumped: list[float] = []
    upcoming = iter(targets)
    pending = next(upcoming, None)
    path = []
    for frame in range(math.ceil(start * fps - 1e-6), math.ceil(end * fps - 1e-6)):
        at = frame * step
        while pending is not None and pending[0] <= at + 1e-6:
            if pending[1] is not None:
                seen = inside(pending[1])
                if abs(seen - trail) > zone:
                    if jumped and (jumped[-1] > trail) != (seen > trail):
                        jumped.clear()
                    jumped.append(seen)
                if abs(seen - trail) <= zone or len(jumped) >= camera.confirmations:
                    trail = seen
                    jumped.clear()
                    if abs(trail - goal) > zone:
                        goal = trail
            pending = next(upcoming, None)
        if path:
            position, speed = _spring(position, speed, goal, camera.spring_rate, step, top_speed)
        path.append((at, position))
    return path


def _spring(position: float, speed: float, goal: float, rate: float, step: float, top_speed: float) -> tuple[float, float]:
    """One step of a critically damped spring pulling `position` towards `goal`, solved exactly, then
    held to `top_speed` and stopped at the goal rather than past it."""
    offset = position - goal
    decay = math.exp(-rate * step)
    pull = speed + rate * offset
    moved = (offset + pull * step) * decay
    speed = (speed - rate * pull * step) * decay
    limit = top_speed * step
    moved = offset + min(max(moved - offset, -limit), limit)
    speed = min(max(speed, -top_speed), top_speed)
    if offset and moved * offset <= 0:
        return goal, 0.0
    return goal + moved, speed


def _filled(width: int, height: int, start: float, canvas: Canvas) -> Panel:
    """The largest crop of the Canvas's shape from the middle of a frame of any shape, filling `canvas`."""
    if width * canvas.height >= height * canvas.width:
        crop_height = _even_floor(height)
        crop_width = min(_even(crop_height * canvas.width / canvas.height), _even_floor(width))
    else:
        crop_width = _even_floor(width)
        crop_height = min(_even(crop_width * canvas.height / canvas.width), _even_floor(height))
    x, y = _centred(width, crop_width), _centred(height, crop_height)
    return Panel(Box(0, 0, *canvas.size), crop_width, crop_height, [CropPoint(start, x, y)])


def _fitted(width: int, height: int, start: float, canvas: Canvas) -> Panel:
    """The whole frame, as large as fits on `canvas` and centred on it: one of its shape fills it."""
    crop_width, crop_height = _even_floor(width), _even_floor(height)
    scale = min(canvas.width / crop_width, canvas.height / crop_height)
    area_width = min(_even(crop_width * scale), canvas.width)
    area_height = min(_even(crop_height * scale), canvas.height)
    area = Box(_centred(canvas.width, area_width), _centred(canvas.height, area_height), area_width, area_height)
    return Panel(area, crop_width, crop_height, [CropPoint(start, 0, 0)])


# Sizes and offsets are kept even: 4:2:0 video can't be cut at odd pixels.
def _even(value: float) -> int:
    return 2 * round(value / 2)


def _even_floor(value: float) -> int:
    return 2 * int(value // 2)


def _centred(outer: int, inner: int) -> int:
    """The even offset that centres `inner` pixels in `outer` most nearly, keeping it inside."""
    return min(_even((outer - inner) / 2), _even_floor(outer - inner))
