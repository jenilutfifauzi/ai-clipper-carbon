"""The Render Planner: how a Clip is cut from its Source and framed in the 1080×1920 output, as a
Render Plan that the Renderer executes. Pure, so it is tested on synthetic input (Seam B): the Clip's
Scenes and face detections are found before planning (app/analysis.py) and passed in.

Each Scene of a landscape Source gets its own Layout, from its number of faces in LAYOUT_SAMPLES of
its sampled frames (scenes shorter than MIN_SCENE_SECS are first merged into a neighbour, so that the
layout doesn't flicker). The Candidate's layout override, unless Auto, replaces the choice in every Scene.
- One face: Track, a full-height 9:16 crop that follows the speaker's face.
- Two faces: Split, two 1080×960 panels stacked, the left face's on top, each with its own camera
  following its face. Forced with fewer than two faces, Split shows the frame's left and right halves.
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

A portrait Source is passed through whole.

Captions come from the Clip's own Words (transcribed for it, on the Clip's timeline). They are
short lines, broken by the Caption Style's limits (by default UPPERCASE, at most 16 characters or
1.4 s long), each Word highlighted while it is spoken. With the style's Auto position a line sits on
the seam between the panels in a Split Scene and in the lower third otherwise, and moves when the
Layout changes under it; the other positions put every line in one place.

The hook (the Candidate's hook text, as last edited) is shown for the Clip's first HOOK_SECS in a
box, at the top of SAFE_AREA unless its Hook Style places it elsewhere: on one line if it fits,
else on two, set smaller when even two lines at the style's size would be too wide (`fit_hook`,
which Review also asks, to warn). With the default positions it stays above the captions in every
Layout: they never go above the seam's band, y 860.

Like the hook, captions stay inside SAFE_AREA, clear of the platforms' buttons and text. Both are
measured with their bundled font's own widths (`font_metrics`), the font libass sets them in. The
styles (app/styles.py) are kept in the plan, for the Renderer to draw it in them.

The Watermark (text, or one of the Logos) shows for the whole Clip. At one of its nine positions it
sits WATERMARK_MARGIN inside SAFE_AREA's corners, edges or middle; at the Custom position it is
centred where the owner dragged it, kept inside the frame.

Text Layers (the Advanced Edit's free text) are centred where the owner put them, kept inside the
frame, each in its own look; one wider than the frame less TEXT_MARGIN either side is set smaller.
They are drawn over the captions and under the hook, in their order.

Music Clips are heard where the owner put them, cut where the Clip or the song ends, under the
Clip's own sound at its `source_volume`.

Overlays (videos and images laid over the Clip) are each drawn as a Picture, cut by its Crop (in its
item's pixels: what is kept is what is fitted) and placed by its Transform: its centre kept on the
frame and the picture free to go past the frame's edges; cut where the Clip or their video ends,
drawn over the Segments and under the Watermark. A video's sound, when turned up, is heard as a
Music Clip is.

A Clip cut into several Segments (docs/adr/0002-segments-and-timeline-time.md) is planned Segment
by Segment: each framed on its own, from its own Scenes and faces, its Scenes moved to where it
plays in the Clip. A Segment of a Media Library video is one Scene, with no captions: the video
drawn as a Picture placed by its Framing, over its Background (a blurred copy of what its Crop keeps,
covering the frame, or a colour) (`framed_scene`). A Transition overlaps
the Segments either side of a join by its length (at most half the shorter of them), so the Clip
is that much shorter; each side's captions end or start at its middle. Its ends are cuts: no Scene crosses one, and a caption line breaks at one.
Everything else is planned over the whole Clip, in seconds into it.
"""

import math
import unicodedata
from collections import Counter
from dataclasses import dataclass, field, replace
from enum import StrEnum
from functools import cache

from app.candidates import (
    BackgroundKind,
    Crop,
    Framing,
    Layout,
    LayoutOverride,
    MusicClip,
    Overlay,
    TextAlign,
    TextLayer,
    Transform,
    TransitionKind,
    WordEdit,
    transition_overlap,
)
from app.config import CameraTuning
from app.fonts import DEFAULT_FONT, font
from app.pictures import drawn_size, kept, turned_size
from app.styles import (
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
from app.video_source import SourceMetadata

OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
FRAME = (OUTPUT_WIDTH, OUTPUT_HEIGHT)
# Split's panels are as wide as the output and half as tall.
SPLIT_HEIGHT = OUTPUT_HEIGHT // 2
# A Scene's Layout follows its number of faces in this many of its sampled frames, spread through it.
LAYOUT_SAMPLES = 5
# A Scene shorter than this is merged into a neighbour before Layouts are chosen.
MIN_SCENE_SECS = 1.0
# In a Split panel, the face's centre is put this far down the panel (as a share of its height),
# where the frame allows: a little above the middle, leaving the seam between the panels clear.
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
# Its lines' baselines are this many sizes apart.
HOOK_LEADING = 0.82
# The box's padding, in pixels: either side of the longest line, above the capitals of the first
# and below the descenders of the last.
HOOK_PAD_X = 36
HOOK_PAD_Y = 26
# A strip's padding, in sizes: either side of its line, and above the capitals and below the
# descenders; and the gap between one strip and the next.
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
# A Text Layer is at most as wide as the frame less this many pixels either side. Its lines'
# baselines are TEXT_LEADING sizes apart; its box is padded by TEXT_PAD_X and TEXT_PAD_Y sizes
# either side and above its capitals and below its descenders, its corners TEXT_RADIUS sizes round.
TEXT_MARGIN = 48
TEXT_LEADING = 1.1
TEXT_PAD_X = 0.35
TEXT_PAD_Y = 0.22
TEXT_RADIUS = 0.25


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
    """A Transition into a Segment from the one before: its kind, and how long the two overlap."""

    kind: TransitionKind
    secs: float


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
    framing: Framing = Framing()
    volume: float = 1.0
    silent: bool = False
    # Its Words and the Word Edits that fall in it, in seconds into it (None: no captions), and the
    # Transition into it from the Segment before, if any.
    words: list[Word] | None = None
    word_edits: list[WordEdit] = field(default_factory=list)
    join: Join | None = None


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


@dataclass(frozen=True)
class Box:
    """A rectangle in pixels, from its top-left corner."""

    x: int
    y: int
    width: int
    height: int


# The platforms' buttons and text cover the top 12%, the bottom 20% and the right 12% of the frame:
# captions and the hook stay inside the rest, y 232–1536 and x 0–950.
SAFE_AREA = Box(0, 232, 950, 1304)
# Where a caption line is centred: as far from the left edge as the safe area's right edge is from
# the right, so that lines are centred in the frame. On the seam between Split's panels (y 860–1060,
# clear of the faces, which sit at 40% of each panel), or in the lower third (y 1296–1496: below
# Blur's shot, which ends at 1264, and above the bottom safe zone).
_CAPTION_X = OUTPUT_WIDTH - (SAFE_AREA.x + SAFE_AREA.width)
SEAM_CAPTIONS = Box(_CAPTION_X, SPLIT_HEIGHT - 100, OUTPUT_WIDTH - 2 * _CAPTION_X, 200)
LOWER_CAPTIONS = Box(_CAPTION_X, 1296, OUTPUT_WIDTH - 2 * _CAPTION_X, 200)
# The Top position's: just below where a two-line hook at the top ends (y 410 at most).
TOP_CAPTIONS = Box(_CAPTION_X, 430, OUTPUT_WIDTH - 2 * _CAPTION_X, 200)
# The widest a hook line can be: its box, padding included, is as wide as the captions' area.
HOOK_WIDTH = OUTPUT_WIDTH - 2 * _CAPTION_X - 2 * HOOK_PAD_X
# The widest a Kicker's pill can be: as wide as the captions' area.
KICKER_WIDEST = OUTPUT_WIDTH - 2 * _CAPTION_X
# How far inside SAFE_AREA's edges the Watermark sits, at its nine positions.
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
    # A media Segment's Scene: its one picture, drawn over its panels, or over `colour` without any.
    picture: "Picture | None" = None
    colour: str | None = None


@dataclass(frozen=True)
class CaptionWord:
    """A Word of a caption line, highlighted from `start` (when it is spoken) to `end` (when the next
    one is, or the line goes), in seconds into the Clip."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class CaptionEvent:
    """A caption line, on screen from `start` to `end` (seconds into the Clip), centred in `area` at
    font `size`: the Caption Style's, or smaller for a line too wide for the area. Its `words` are
    highlighted one after another, from its start to its end."""

    text: str
    start: float
    end: float
    words: list[CaptionWord]
    area: Box
    size: float


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
class TextEvent:
    """A Text Layer as drawn: its `lines` set at font `size` (its own, or smaller for one too wide),
    on screen from `start` to `end` (seconds into the Clip). `area` holds it, padded when it has a
    `box` (then the box is the area). Each line is placed by its anchor: the middle of its text and
    its baseline."""

    layer: TextLayer
    lines: list[str]
    start: float
    end: float
    area: Box
    size: float
    anchors: list[tuple[float, float]]
    box: Box | None = None


@dataclass(frozen=True)
class AudioEvent:
    """A Music Clip as heard: the Media Library item `media` from `offset` seconds into it, from
    `start` to `end` seconds into the Clip, at `volume`, faded in over `fade_in` and out over `fade_out`."""

    media: str
    start: float
    end: float
    offset: float
    volume: float
    fade_in: float
    fade_out: float


@dataclass(frozen=True)
class SegmentPlan:
    """A Segment as played: the Source (or the Media Library video `media`) from `source_start` to
    `source_end`, from `start` to `end` seconds into the Clip; a video's own sound at `volume`, or
    none when it is `silent`."""

    start: float
    end: float
    source_start: float
    source_end: float
    media: str | None = None
    volume: float = 1.0
    silent: bool = False
    # How many of the plan's Scenes, in order, are its.
    scenes: int = 1


@dataclass(frozen=True)
class TransitionEvent:
    """A Transition as drawn: from `start` to `end` seconds into the Clip, the Segment before gives way
    to the next one as `kind` says."""

    kind: TransitionKind
    start: float
    end: float


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
    go past the frame's edges: what the Smart Guides and the agent's dry run go by."""

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


@dataclass(frozen=True)
class OverlayEvent:
    """An Overlay as drawn: the Media Library item `media` (an image, or a video from `offset` seconds
    into it) drawn as `picture` says, from `start` to `end` seconds into the Clip. `id` is the Overlay's."""

    media: str
    picture: Picture
    start: float
    end: float
    offset: float
    image: bool
    id: str = ""


@dataclass(frozen=True)
class RenderPlan:
    # The Clip's range on the Source's timeline; with several Segments, the hull of what they show.
    start: float
    end: float
    source_width: int
    source_height: int
    fps: float
    # Back to back, covering the Clip from 0 to its duration.
    scenes: list[ScenePlan]
    captions: list[CaptionEvent] = field(default_factory=list)
    hook: HookEvent | None = None
    # What the captions and the hook look like.
    caption_style: CaptionStyle = CaptionStyle()
    hook_style: HookStyle = HookStyle()
    width: int = OUTPUT_WIDTH
    height: int = OUTPUT_HEIGHT
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

    @property
    def duration(self) -> float:
        return self.segments[-1].end if self.segments else self.end - self.start


def reframes(source: SourceMetadata) -> bool:
    """Whether Clips of `source` are reframed, and so need their Scenes and faces: all but a portrait
    Source, which is passed through."""
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
) -> RenderPlan:
    """The Render Plan for the Clip from `start` to `end` seconds of `source`, whose shots are `scenes`
    and whose sampled frames have `faces` (both in seconds into the Clip), framed in `layout` (Auto:
    each Scene by its faces), captioned with `words` (in seconds into the Clip; those beyond its
    ends are left out) in `caption_style` and corrected by `word_edits` (their times in seconds into
    the Clip), with the `hook` text and its `hook_kicker` in `hook_style` from `hook_start` for
    `hook_secs`. A Scene that holds one of `layout_overrides` (their times in seconds into the
    Clip) takes its Layout instead of `layout`, the last one if it holds several. Without `scenes`
    the Clip is one Scene; without `faces` (not analysed) an Auto Scene is tracked with its crop in
    the middle; without `words`, nothing is captioned; with a blank `hook`, no hook is shown. The
    Watermark is in `watermark_style`, its Logo `logo_size` pixels (None: no Logo, which shows none).
    `text_layers` (their times in seconds into the Clip) are drawn as `text_event` places them, and
    `music` is heard as `audio_events` places it, given what `media_info` says of its songs.

    `overlays` are laid over it as `overlay_events` places them, given what `media_info` says of
    their items (whose videos' sound, when turned up, joins the music).

    With `main_track` (each Segment's SegmentInput), the Clip is cut into those Segments, back to back (`start` and `end` being the hull
    of what they show) but for their Transitions, each framed and captioned from its own (ignoring
    `scenes`, `faces`, `layout_overrides`, `words` and `word_edits`); the other times are all in
    seconds into the Clip."""
    if not 0 <= start < end:
        raise ValueError(f"A Clip runs forwards from 0 s or later, not {start:g}–{end:g} s")
    segments: list[SegmentPlan] = []
    transitions: list[TransitionEvent] = []
    cuts: list[float] = []
    if main_track:
        plans, at = [], 0.0
        for i, given in enumerate(main_track):
            length = round(given.end - given.start, 3)
            if i and given.join is not None:
                # Overlapping the one before by the Transition's length, half the shorter at most.
                before = segments[-1].end - segments[-1].start
                overlap = transition_overlap(given.join.secs, before, length)
                at = round(at - overlap, 3)
                transitions.append(TransitionEvent(given.join.kind, at, round(at + overlap, 3)))
                cuts.append(round(at + overlap / 2, 3))
            elif i:
                cuts.append(at)
            if given.media is not None:
                framed = [framed_scene(0.0, length, SceneLayout.MEDIA, given.width, given.height, given.framing)]
            else:
                framed = _framed(length, source, given.scenes, given.faces, layout, camera, given.layout_overrides)
            plans.extend(_moved(scene, at) for scene in framed)
            segments.append(
                SegmentPlan(at, round(at + length, 3), given.start, given.end, given.media, given.volume, given.silent, len(framed))
            )
            at = round(at + length, 3)
        duration = at
        words, word_edits = _segment_words(main_track, segments, cuts, duration)
    else:
        duration = round(end - start, 3)
        plans = _framed(duration, source, scenes, faces, layout, camera, layout_overrides)
    return RenderPlan(
        start=start,
        end=end,
        source_width=source.width,
        source_height=source.height,
        fps=source.fps,
        scenes=plans,
        captions=_captions(words or [], plans, duration, caption_style, word_edits or [], cuts),
        hook=_hook(hook, duration, hook_style, hook_start, hook_secs, hook_kicker),
        caption_style=caption_style,
        hook_style=hook_style,
        watermark=watermark(watermark_style, logo_size),
        watermark_style=watermark_style,
        texts=[event for layer in text_layers or [] if (event := text_event(layer, duration)) is not None],
        audio=audio_events(music or [], duration, media_info or {}) + overlay_sound(overlays or [], duration, media_info or {}),
        source_volume=source_volume,
        segments=segments,
        overlays=overlay_events(overlays or [], duration, media_info or {}),
        transitions=transitions,
    )


def _segment_words(
    main_track: list[SegmentInput], segments: list[SegmentPlan], cuts: list[float], duration: float
) -> tuple[list[Word] | None, list[WordEdit]]:
    """The Segments' Words and Word Edits in seconds into the Clip: each Segment's Words whose middle
    is between the cuts either side of it (where the Segment before ends, or a Transition's middle),
    kept between them. None when no Segment is captioned."""
    if all(given.words is None for given in main_track):
        return None, []
    edges = [0.0, *cuts, duration]
    words, edits = [], []
    for i, (given, segment) in enumerate(zip(main_track, segments)):
        low, high = edges[i], edges[i + 1]
        for word in given.words or []:
            on, off = word.start + segment.start, word.end + segment.start
            if low <= (on + off) / 2 < high:
                words.append(Word(word.text, round(max(on, low), 3), round(min(off, high), 3)))
        edits += [replace(edit, at=round(edit.at + segment.start, 3)) for edit in given.word_edits]
    return words, sorted(edits, key=lambda edit: edit.at)


def _framed(
    duration: float,
    source: SourceMetadata,
    scenes: list[Scene] | None,
    faces: list[FrameFaces] | None,
    layout: Layout,
    camera: CameraTuning,
    layout_overrides: list[LayoutOverride] | None,
) -> list[ScenePlan]:
    """The Scenes of a range of `source` lasting `duration`, whose shots are `scenes` and whose
    sampled frames have `faces`, framed as plan_render says; in seconds into the range."""
    if not reframes(source):
        plans = [ScenePlan(0.0, duration, SceneLayout.PASSTHROUGH, [_fitted(source.width, source.height, 0.0)])]
    else:
        cuts = sorted({round(scene.start, 3) for scene in scenes or []} - {0.0})
        edges = [0.0, *(cut for cut in cuts if cut < duration), duration]
        plans = []
        for a, b in _merge_short(edges):
            seen = None if faces is None else [frame for frame in faces if a <= frame.at < b]
            count = None if seen is None else _face_count(seen)
            held = [o.layout for o in layout_overrides or [] if a <= o.at < b or (b == duration and o.at == b)]
            chosen = _choose(held[-1] if held else layout, count)
            if chosen is SceneLayout.TRACK:
                panels = [_track(a, b, seen, source, camera)]
            elif chosen is SceneLayout.SPLIT:
                panels = _split(a, b, seen if count and count >= 2 else None, source, camera)
            else:
                panels = _blur(a, source)
            plans.append(ScenePlan(a, b, chosen, panels))
    return plans


def framed_scene(start: float, end: float, layout: SceneLayout, width: int, height: int, framing: Framing) -> ScenePlan:
    """A Scene from `start` to `end` of a `width` x `height` picture placed by its `framing`: the
    picture (`picture_of`) over its Background, which is the largest 9:16 crop from the middle of what
    its Crop keeps, blurred, filling the frame (as Blur's background is), or its colour."""
    picture = picture_of(width, height, framing.transform, framing.crop)
    if framing.background.kind is BackgroundKind.COLOUR:
        return ScenePlan(start, end, layout, [], picture, framing.background.colour)
    kept, cover = picture.crop, _filled(picture.crop.width, picture.crop.height, start)
    point = replace(cover.path[0], x=cover.path[0].x + kept.x, y=cover.path[0].y + kept.y)
    return ScenePlan(start, end, layout, [replace(cover, path=[point], blur=True)], picture)


def _moved(scene: ScenePlan, by: float) -> ScenePlan:
    """The Scene `by` seconds later, its crops' change points with it."""
    if not by:
        return scene
    panels = [replace(panel, path=[replace(point, at=round(point.at + by, 3)) for point in panel.path]) for panel in scene.panels]
    return replace(scene, start=round(scene.start + by, 3), end=round(scene.end + by, 3), panels=panels)


def watermark(style: WatermarkStyle, logo_size: tuple[int, int] | None = None) -> WatermarkEvent | None:
    """The Watermark in `style`, its Logo `logo_size` pixels; None when it shows nothing: off, blank
    text (without emoji, which the bundled fonts haven't got), or a Logo that is missing."""
    if style.kind is WatermarkKind.TEXT:
        text = without_emoji(style.text).strip()
        if not text:
            return None
        width = math.ceil(font_metrics(style.font).width(text, style.size))
        # As wide as the frame at most: set smaller when it is wider.
        size = float(style.size) if width <= OUTPUT_WIDTH else math.floor(style.size * OUTPUT_WIDTH / width * 10) / 10
        area = _watermark_area(style, min(width, OUTPUT_WIDTH), math.ceil(size))
        return WatermarkEvent(WatermarkKind.TEXT, area, style.opacity, text=text, size=size)
    if style.kind is WatermarkKind.LOGO and style.logo is not None and logo_size is not None:
        logo_width, logo_height = logo_size
        height = min(style.size, OUTPUT_HEIGHT)
        width = max(1, round(height * logo_width / logo_height))
        if width > OUTPUT_WIDTH:
            width, height = OUTPUT_WIDTH, max(1, round(OUTPUT_WIDTH * logo_height / logo_width))
        return WatermarkEvent(WatermarkKind.LOGO, _watermark_area(style, width, height), style.opacity, logo=style.logo)
    return None


def _watermark_area(style: WatermarkStyle, width: int, height: int) -> Box:
    """Where a `width` x `height` Watermark goes at the style's position."""
    if style.position is WatermarkPosition.CUSTOM:
        x = min(max(round(style.x - width / 2), 0), OUTPUT_WIDTH - width)
        y = min(max(round(style.y - height / 2), 0), OUTPUT_HEIGHT - height)
        return Box(x, y, width, height)
    vertical, _, horizontal = style.position.value.rpartition("_")
    vertical = vertical or (horizontal if horizontal in ("top", "bottom") else "")
    left, top = SAFE_AREA.x + WATERMARK_MARGIN, SAFE_AREA.y + WATERMARK_MARGIN
    right = SAFE_AREA.x + SAFE_AREA.width - WATERMARK_MARGIN - width
    bottom = SAFE_AREA.y + SAFE_AREA.height - WATERMARK_MARGIN - height
    # Its middle column is centred in the frame, as the captions and the hook are.
    x = {"left": left, "right": right}.get(horizontal, (OUTPUT_WIDTH - width) // 2)
    y = {"top": top, "bottom": bottom}.get(vertical, (SAFE_AREA.y * 2 + SAFE_AREA.height - height) // 2)
    return Box(min(max(x, 0), OUTPUT_WIDTH - width), min(max(y, 0), OUTPUT_HEIGHT - height), width, height)


def audio_events(music: list[MusicClip], duration: float, items: dict[str, "MediaInfo"]) -> list[AudioEvent]:
    """The Music Clips as heard in a Clip lasting `duration`, each cut where the Clip or its song
    (whose length is in `items`) ends, its fades, when together they are longer than what is left,
    both shortened by the same share to fit. This is the rule; the Timeline draws the fades by a copy
    of it (fadesWithin in frontend/src/pages/job/advanced/edits.ts), tested on the same worked
    examples. One whose song is gone, or that would start at or after either end, isn't heard."""
    events = []
    for clip in music:
        item = items.get(clip.media)
        length = item.duration if item is not None else None
        start = round(clip.start, 3)
        if length is None or start >= duration or clip.offset >= length:
            continue
        end = round(min(start + clip.secs, duration, start + length - clip.offset), 3)
        share = min(1.0, (end - start) / ((clip.fade_in + clip.fade_out) or 1.0))
        events.append(
            AudioEvent(clip.media, start, end, round(clip.offset, 3), clip.volume, round(clip.fade_in * share, 3), round(clip.fade_out * share, 3))
        )
    return events


def overlay_events(overlays: list[Overlay], duration: float, items: dict[str, MediaInfo]) -> list[OverlayEvent]:
    """The Overlays as drawn in a Clip lasting `duration` (`_overlay_event`)."""
    return [event for overlay in overlays if (event := _overlay_event(overlay, duration, items)) is not None]


def overlay_sound(overlays: list[Overlay], duration: float, items: dict[str, MediaInfo]) -> list[AudioEvent]:
    """The sound of the Overlays' videos that are turned up, heard as Music Clips are, while they show."""
    sounds = []
    for overlay in overlays:
        event = _overlay_event(overlay, duration, items)
        if event is None or event.image or overlay.volume <= 0 or not items[overlay.media].has_audio:
            continue
        sounds.append(AudioEvent(overlay.media, event.start, event.end, event.offset, overlay.volume, 0.0, 0.0))
    return sounds


def _overlay_event(overlay: Overlay, duration: float, items: dict[str, MediaInfo]) -> OverlayEvent | None:
    """The Overlay as drawn: its item placed by its Transform (`picture_of`), cut where the Clip or
    its video ends. None when its item is gone or it would start at or after either end."""
    item = items.get(overlay.media)
    start = round(overlay.start, 3)
    if item is None or not item.width or not item.height or start >= duration:
        return None
    end = start + overlay.secs
    if item.duration is not None:
        if overlay.offset >= item.duration:
            return None
        end = min(end, start + item.duration - overlay.offset)
    end = round(min(end, duration), 3)
    offset = round(overlay.offset, 3) if item.duration is not None else 0.0
    picture = picture_of(item.width, item.height, overlay.transform, overlay.crop)
    return OverlayEvent(overlay.media, picture, start, end, offset, item.duration is None, overlay.id)


def picture_of(width: int, height: int, transform: Transform, crop: Crop = Crop()) -> Picture:
    """A `width` x `height` item cut by `crop` and drawn as `transform` places it: what it keeps at
    its drawn size (app/pictures.py), its centre kept on the frame, the picture not."""
    cut = Box(*kept(width, height, crop))
    drawn_width, drawn_height = drawn_size(cut.width, cut.height, transform, FRAME)
    x = round(min(max(transform.x, 0.0), OUTPUT_WIDTH), 2)
    y = round(min(max(transform.y, 0.0), OUTPUT_HEIGHT), 2)
    across, down = turned_size(drawn_width, drawn_height, transform.rotation)
    bounds = Box(round(x - across / 2), round(y - down / 2), round(across), round(down))
    return Picture(
        cut, (width, height), drawn_width, drawn_height, (x, y), transform.rotation,
        transform.flip_h, transform.flip_v, transform.opacity, bounds,
    )


def on_frame(picture: Picture) -> Picture:
    """The part of an unturned `picture` that is on the frame, as a Picture of its own: what it
    draws there, without scaling what is off it (a picture zoomed in or covering the frame is
    larger than the frame). A turned picture is given back whole."""
    if picture.rotation % 360:
        return picture
    x, y = picture.centre
    left, top = x - picture.width / 2, y - picture.height / 2
    shown = (max(left, 0.0), max(top, 0.0), min(left + picture.width, OUTPUT_WIDTH), min(top + picture.height, OUTPUT_HEIGHT))
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


def text_event(layer: TextLayer, duration: float) -> TextEvent | None:
    """The Text Layer in a Clip lasting `duration`, until its end if that comes sooner: its lines
    (split at newlines, without emoji, blank ones at either end left out) centred on its place and
    kept inside the frame, set smaller when the widest, padded, is wider than the frame less
    TEXT_MARGIN either side. None when it is blank or would start at or after the Clip's end."""
    lines = [without_emoji(line) for line in layer.text.split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    start = round(layer.start, 3)
    if not lines or start >= duration:
        return None
    metrics = font_metrics(layer.font)
    # Its width and padding grow with the size, so a size that fits scales them alike.
    pad = (TEXT_PAD_X, TEXT_PAD_Y) if layer.box else (0.0, 0.0)
    widest = max(metrics.width(line, 1) for line in lines) + 2 * pad[0]
    size = float(layer.size)
    room = OUTPUT_WIDTH - 2 * TEXT_MARGIN
    if widest * size > room:
        size = math.floor(room / widest * 10) / 10
    pad_x, pad_y = pad[0] * size, pad[1] * size
    widths = [metrics.width(line, size) for line in lines]
    width = math.ceil(max(widths) + 2 * pad_x)
    letters = (metrics.cap_height + metrics.descent) / metrics.units * size + (len(lines) - 1) * TEXT_LEADING * size
    height = math.ceil(letters + 2 * pad_y)
    x = min(max(round(layer.x - width / 2), 0), OUTPUT_WIDTH - width)
    y = min(max(round(layer.y - height / 2), 0), OUTPUT_HEIGHT - height)
    area = Box(x, y, width, height)

    def middle(line: float) -> float:
        if layer.align is TextAlign.LEFT:
            return x + pad_x + line / 2
        if layer.align is TextAlign.RIGHT:
            return x + width - pad_x - line / 2
        return x + width / 2

    anchors = [
        (middle(line), y + pad_y + (metrics.cap_height / metrics.units + i * TEXT_LEADING) * size)
        for i, line in enumerate(widths)
    ]
    end = round(min(start + layer.secs, duration), 3)
    return TextEvent(layer, lines, start, end, area, size, anchors, area if layer.box else None)


def fit_hook(text: str, style: HookStyle = HookStyle()) -> tuple[list[str], float]:
    """How the hook `text` is set in `style`: its lines (none when it is blank) and their font size.
    The fewest lines, up to the style's max_lines, that fit in HOOK_WIDTH at its size, broken between
    words where the longest is shortest. Lines still too wide are set smaller, so that the longest
    just fits: the text fits when the size is the style's."""
    words = [word for word, _ in _hook_words(text, style.uppercase)]
    if not words:
        return [], style.size
    metrics = font_metrics(style.font)

    def widest(lines: list[str]) -> float:
        return max(metrics.width(line, style.size) for line in lines)

    for count in range(1, min(style.max_lines, len(words)) + 1):
        lines = _balanced(words, count, metrics)
        if widest(lines) <= HOOK_WIDTH:
            return lines, style.size
    return lines, math.floor(style.size * HOOK_WIDTH / widest(lines) * 10) / 10


# Emoji (Unicode's Extended_Pictographic, but for ©, ® and ™, which fonts draw as text) and the
# characters that join and vary them: no bundled font has them, and libass draws none.
_EMOJI = (
    (0x203C, 0x203C), (0x2049, 0x2049), (0x2139, 0x2139), (0x2194, 0x2199), (0x21A9, 0x21AA), (0x231A, 0x231B),
    (0x2328, 0x2328), (0x2388, 0x2388), (0x23CF, 0x23CF), (0x23E9, 0x23F3), (0x23F8, 0x23FA), (0x24C2, 0x24C2),
    (0x25AA, 0x25AB), (0x25B6, 0x25B6), (0x25C0, 0x25C0), (0x25FB, 0x25FE), (0x2600, 0x27BF), (0x2934, 0x2935),
    (0x2B00, 0x2BFF), (0x3030, 0x3030), (0x303D, 0x303D), (0x3297, 0x3297), (0x3299, 0x3299), (0x1F000, 0x1FAFF),
    (0x1FC00, 0x1FFFD), (0xFE00, 0xFE0F), (0x200D, 0x200D), (0x20E3, 0x20E3), (0xE0020, 0xE007F),
)


def _is_emoji(char: str) -> bool:
    return any(low <= ord(char) <= high for low, high in _EMOJI)


def without_emoji(text: str) -> str:
    """`text` with its emoji left out and its whitespace collapsed."""
    return " ".join("".join(char for char in text if not _is_emoji(char)).split())


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
        elif not _is_emoji(char):
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


def _balanced(words: list[str], count: int, metrics: "FontMetrics") -> list[str]:
    """`words` on `count` lines, broken where the widest line is narrowest (of equals, with the
    earliest breaks)."""
    space = metrics.advances.get(" ", metrics.units)
    ends = [0]
    for word in words:
        ends.append(ends[-1] + sum(metrics.advances.get(char, metrics.units) for char in word))

    def units(i: int, j: int) -> int:
        return ends[j] - ends[i] + (j - i - 1) * space

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
    text: str, duration: float, style: HookStyle, start: float = 0.0, secs: float = HOOK_SECS, kicker: str = ""
) -> HookEvent | None:
    """The hook `text` from `start` for `secs` seconds of the Clip, which lasts `duration` (until its
    end, if that comes sooner), as large as its lines and padding, its lines centred in the frame
    or its middle at the style's x (kept in the frame), placed by `style`: just below the top of
    SAFE_AREA, in the middle of the frame, just above the bottom of SAFE_AREA, or with its top at
    the style's height (kept inside SAFE_AREA).
    None when the text is blank or it would start at or after the Clip's end.

    A block (or no box) is HOOK_PAD_X wider than the longest line either side, its first line's
    capitals HOOK_PAD_Y below its top and the baselines HOOK_LEADING sizes apart. Strips are each
    their line's width, padded by STRIP_PAD_X and STRIP_PAD_Y, STRIP_GAP apart. Left-aligned lines
    (and strips) start at the left of the longest.

    The `kicker`, if any, goes above them in a pill (`_kicker_pill`), centred over them or starting where
    they do, KICKER_GAP of the hook's size away. A Quote Mark (QUOTE_SCALE) is on the first line's
    corner: the lines move down by what of it sticks out above them, but not sideways, so they stay
    centred."""
    lines, size = fit_hook(text, style)
    start = round(max(start, 0.0), 3)
    if not lines or start >= duration:
        return None
    words, emphasis = _hook_words(text, style.uppercase), []
    for line in lines:
        count = len(line.split())
        emphasis.append(_emphasis(words[:count]))
        words = words[count:]
    metrics = font_metrics(style.font)
    widths = [metrics.width(line, size) for line in lines]
    left = style.align == HookAlign.LEFT
    # Boxes from the hook's top-left corner, and anchors from where it is.
    if style.shape == HookShape.STRIPS:
        pad_x, pad_y = STRIP_PAD_X * size, STRIP_PAD_Y * size
        strip_height = math.ceil((metrics.cap_height + metrics.descent) / metrics.units * size + 2 * pad_y)
        pitch = strip_height + round(STRIP_GAP * size)
        strips = [math.ceil(line + 2 * pad_x) for line in widths]
        width, height = max(strips), (len(lines) - 1) * pitch + strip_height
        offsets = [0 if left else (width - strip) // 2 for strip in strips]
        boxes = [Box(x, i * pitch, strip, strip_height) for i, (x, strip) in enumerate(zip(offsets, strips))]

        def anchors(x: int, y: int) -> list[tuple[float, float]]:
            return [
                (x + box.x + box.width / 2, y + box.y + pad_y + metrics.cap_height / metrics.units * size) for box in boxes
            ]
    else:
        width = math.ceil(max(widths)) + 2 * HOOK_PAD_X
        letters = (metrics.cap_height + metrics.descent) / metrics.units * size + (len(lines) - 1) * HOOK_LEADING * size
        height = math.ceil(letters) + 2 * HOOK_PAD_Y
        boxes = [Box(0, 0, width, height)] if style.shape == HookShape.BLOCK else []

        def anchors(x: int, y: int) -> list[tuple[float, float]]:
            return [
                (x + HOOK_PAD_X + line / 2 if left else x + width / 2,
                 y + HOOK_PAD_Y + (metrics.cap_height / metrics.units + i * HOOK_LEADING) * size)
                for i, line in enumerate(widths)
            ]
    # The lines' place in the whole hook, and the pill's.
    lines_x = lines_y = 0
    lines_height = height
    pill = _kicker_pill(kicker, size, style)
    if pill is not None:
        lines_y = pill.height + round(KICKER_GAP * size)
        if left:
            # From where the text starts, or nearer the left when that would take it past the
            # captions' width (and the safe area).
            pill_x = min(HOOK_PAD_X if style.shape == HookShape.NONE else 0, max(0, KICKER_WIDEST - pill.width))
            full_width = max(width, pill_x + pill.width)
        else:
            full_width = max(width, pill.width)
            pill_x, lines_x = (full_width - pill.width) // 2, (full_width - width) // 2
        width = full_width
    badge = round(QUOTE_SCALE * size) if style.quote else 0
    # How far it reaches into the first line's box: into its padding.
    box_pad_x, box_pad_y = {
        HookShape.BLOCK: (HOOK_PAD_X, HOOK_PAD_Y),
        HookShape.STRIPS: (STRIP_PAD_X * size, STRIP_PAD_Y * size),
        HookShape.NONE: (0, 0),
    }[style.shape]
    inset_x, inset_y = math.floor(QUOTE_INSET * box_pad_x), math.floor(QUOTE_INSET * box_pad_y)
    if badge:
        lines_y += badge - inset_y
    height = lines_y + lines_height
    bottom = SAFE_AREA.y + SAFE_AREA.height - height
    top = {
        HookPosition.TOP: SAFE_AREA.y,
        HookPosition.MIDDLE: (OUTPUT_HEIGHT - height) // 2,
        HookPosition.BOTTOM: bottom,
        HookPosition.CUSTOM: min(max(style.y, SAFE_AREA.y), bottom),
    }[style.position]
    area = Box((OUTPUT_WIDTH - width) // 2, top, width, height)
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
    dx = 0 if style.x is None else min(max((2 * style.x - area.width) // 2, 0), OUTPUT_WIDTH - area.width) - area.x
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


def _kicker_pill(text: str, size: float, style: HookStyle) -> _KickerPill | None:
    """The Kicker `text` over a hook set at `size` (without emoji, in capitals if the style is), set
    smaller when its pill would be wider than KICKER_WIDEST. None when it is blank."""
    text = without_emoji(text)
    if style.uppercase:
        text = text.upper()
    if not text:
        return None
    metrics = font_metrics(style.font)
    pill_size = KICKER_SCALE * size
    padded = metrics.width(text, pill_size) + 2 * KICKER_PAD_X * pill_size
    if padded > KICKER_WIDEST:
        pill_size = math.floor(pill_size * KICKER_WIDEST / padded * 10) / 10
    pad_y = KICKER_PAD_Y * pill_size
    width = math.ceil(metrics.width(text, pill_size) + 2 * KICKER_PAD_X * pill_size)
    height = math.ceil((metrics.cap_height + metrics.descent) / metrics.units * pill_size + 2 * pad_y)
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

    def width(self, text: str, size: float) -> float:
        """How wide `text` is at font `size`, in pixels; a character the font hasn't got counts a size wide."""
        return sum(self.advances.get(char, self.units) for char in text) / self.units * size


@cache
def font_metrics(font_id: str = DEFAULT_FONT) -> FontMetrics:
    """A bundled font's measures (app/fonts.py), read with fontTools."""
    from fontTools.ttLib import TTFont

    file = TTFont(font(font_id).file, lazy=True)
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


@dataclass(frozen=True)
class _Spoken:
    """A Word as captions show it, on the Clip's timeline."""

    text: str
    start: float
    end: float
    ends_sentence: bool
    # Edited to start a line.
    breaks_before: bool = False


def match_edits(words: list[Word], edits: list[WordEdit]) -> list[WordEdit | None]:
    """Each Word's Word Edit, or None: the Words and the edits' times on the same timeline. An edit
    applies to the Word whose span holds its time, else to the nearest Word within
    WORD_EDIT_REACH_SECS; of two edits of one Word, the later in `edits`."""
    matched: list[WordEdit | None] = [None] * len(words)
    for edit in edits:
        best, distance = None, WORD_EDIT_REACH_SECS
        for i, word in enumerate(words):
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
) -> list[CaptionEvent]:
    """The caption lines of `words` over the Clip, which lasts `duration` and is laid out in `scenes`,
    in `style`, with the Word Edits `edits` applied (match_edits): an edited Word shows the edit's
    text (none, when it is empty) and a Word edited to break starts a line.

    The Words whose middle is in the Clip are taken in order into a line, in UPPERCASE (unless the
    style keeps their case) and without the punctuation at their ends, until the next would make it
    longer than the style's max_chars, max_words or max_secs, comes after a pause of its pause_secs,
    follows the end of a sentence, or starts in a Scene whose captions go elsewhere. A line starts
    with its first Word and ends CAPTION_LINGER_SECS after its last, when the next line starts if
    that is sooner, and after max_secs at most. A Word is highlighted from when it is spoken until
    the next one is.
    A line still being spoken at a Layout change that moves the captions moves there with it (unless
    that would show it for less than CAPTION_MIN_SECS in one place); one whose Words are all spoken
    goes at the change. At each of `cuts` (where a Segment ends and the next starts), a line ends and
    the next starts."""
    cuts = cuts or []
    spoken = []
    ordered = sorted(words, key=lambda word: word.start)
    for word, edit in zip(ordered, match_edits(ordered, edits)):
        given = edit.text if edit is not None and edit.text is not None else word.text
        text, ends_sentence = _caption_text(given, style.uppercase)
        if text and 0 <= (word.start + word.end) / 2 < duration:
            breaks = edit is not None and edit.break_before
            spoken.append(_Spoken(text, max(word.start, 0.0), min(max(word.end, word.start), duration), ends_sentence, breaks))

    areas = [_caption_area(style, scene.layout) for scene in scenes]
    # The Layout changes that move the captions.
    moves = [scene.start for scene, area, before in zip(scenes[1:], areas[1:], areas) if area != before]

    def area_at(at: float) -> Box:
        return next(area for scene, area in zip(reversed(scenes), reversed(areas)) if scene.start <= at or scene is scenes[0])

    lines: list[list[_Spoken]] = []
    for word in spoken:
        line = lines[-1] if lines else None
        if (
            line is None
            or word.breaks_before
            or len(" ".join([*(w.text for w in line), word.text])) > style.max_chars
            or (style.max_words is not None and len(line) >= style.max_words)
            or word.end - line[0].start > style.max_secs
            or word.start - line[-1].end >= style.pause_secs
            or line[-1].ends_sentence
            or area_at(word.start) != area_at(line[0].start)
            or any(line[0].start < cut <= word.start for cut in cuts)
        ):
            lines.append([word])
        else:
            line.append(word)

    events = []
    for i, line in enumerate(lines):
        start = line[0].start
        end = min(line[-1].end + CAPTION_LINGER_SECS, start + style.max_secs, duration)
        if i + 1 < len(lines):
            end = min(end, lines[i + 1][0].start)
        end = min([end, *(at for at in [*moves, *cuts] if line[-1].end <= at < end)])
        if end <= start:
            continue
        text = " ".join(word.text for word in line)
        starts = [max(word.start, start) for word in line]
        highlights = list(zip(line, starts, [*starts[1:], end]))
        edges = [start, *(at for at in moves if start < at < end), end]
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
        for a, b, area in parts:
            size = _caption_size(text, area, style)
            events.append(CaptionEvent(
                text=text,
                start=round(a, 3),
                end=round(b, 3),
                words=[CaptionWord(word.text, round(min(max(on, a), b), 3), round(min(max(off, a), b), 3))
                       for word, on, off in highlights],
                area=_caption_placed(text, area, size, style),
                size=size,
            ))
    return events


def _caption_placed(text: str, area: Box, size: float, style: CaptionStyle) -> Box:
    """`area` moved to have its middle at the style's x, or as near as keeps the line set in it at
    `size` (with its outline) in the frame. Without an x, it stays centred."""
    if style.x is None:
        return area
    half = (font_metrics(style.font).width(text, size) + 2 * style.outline) / 2
    centre = min(max(style.x, half), OUTPUT_WIDTH - half)
    return _shifted(area, round(centre - area.width / 2) - area.x)


def _caption_area(style: CaptionStyle, layout: SceneLayout) -> Box:
    """Where a caption line is centred in a Scene in `layout`."""
    match style.position:
        case CaptionPosition.AUTO:
            return SEAM_CAPTIONS if layout is SceneLayout.SPLIT else LOWER_CAPTIONS
        case CaptionPosition.TOP:
            return TOP_CAPTIONS
        case CaptionPosition.MIDDLE:
            return SEAM_CAPTIONS
        case CaptionPosition.BOTTOM:
            return LOWER_CAPTIONS
        case CaptionPosition.CUSTOM:
            half = LOWER_CAPTIONS.height // 2
            centre = min(max(style.y, SAFE_AREA.y + half), SAFE_AREA.y + SAFE_AREA.height - half)
            return replace(LOWER_CAPTIONS, y=centre - half)


def _caption_size(text: str, area: Box, style: CaptionStyle) -> float:
    """The font size for a caption line: the style's, or smaller if the line (with its outline) would
    be wider than its area at that size."""
    outline = style.outline
    width = font_metrics(style.font).width(text, style.size) + 2 * outline
    if width <= area.width:
        return style.size
    return math.floor(style.size * (area.width - 2 * outline) / (width - 2 * outline) * 10) / 10


def _caption_text(text: str, uppercase: bool = True) -> tuple[str, bool]:
    """A Word as captions show it, in UPPERCASE (or its own case) without the punctuation at its ends
    (empty when it is all punctuation), and whether it ends a sentence."""

    def punctuation(char: str) -> bool:
        return unicodedata.category(char)[0] == "P" and char not in _SIGNS

    shown = text.strip()
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


def _track(start: float, end: float, faces: list[FrameFaces] | None, source: SourceMetadata, camera: CameraTuning) -> Panel:
    """A full-height 9:16 crop that follows the speaker's face through the Scene from `start` to `end`;
    in the middle of the frame while no face is known."""
    panel = _centre_crop(source.width, source.height)
    if not faces:
        return replace(panel, path=[replace(panel.path[0], at=start)])
    tracked = _track_faces(faces, source.width, source.height, camera)
    return _follow(panel, _follow_speaker(tracked, source.fps, camera), start, end, source, camera)


def _split(start: float, end: float, faces: list[FrameFaces] | None, source: SourceMetadata, camera: CameraTuning) -> list[Panel]:
    """Two 9:8 crops, each half as wide as the frame, for the panels stacked top and bottom: the
    two faces seen most in the Scene's sampled frames `faces`, each followed by its own camera, the
    left one's on top. Without `faces`, the frame's left half on top and its right half below."""
    width, height = source.width, source.height
    crop_width = _even_floor(width / 2)
    crop_height = _even(crop_width * SPLIT_HEIGHT / OUTPUT_WIDTH)
    if crop_height > _even_floor(height):
        crop_height = _even_floor(height)
        crop_width = _even(crop_height * OUTPUT_WIDTH / SPLIT_HEIGHT)
    y = _centred(height, crop_height)
    halves = [
        Panel(Box(0, i * SPLIT_HEIGHT, OUTPUT_WIDTH, SPLIT_HEIGHT), crop_width, crop_height,
              [CropPoint(start, min(max(_even(centre - crop_width / 2), 0), _even_floor(width - crop_width)), y)])
        for i, centre in enumerate((width / 4, width * 3 / 4))
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
    rise = (0.5 - SPLIT_FACE_AT) * crop_height
    return [
        _follow(panel, [(frame.at, frame.faces.get(id)) for frame in tracked], start, end, source, camera, rise)
        for panel, id in zip(halves, pair)
    ]


def _blur(start: float, source: SourceMetadata) -> list[Panel]:
    """The whole frame as large as fits in the output, centred over the full-height 9:16 crop from its
    middle, blurred, which fills the output."""
    background = _centre_crop(source.width, source.height)
    background = replace(background, path=[replace(background.path[0], at=start)], blur=True)
    return [background, _fitted(source.width, source.height, start)]


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


def _centre_crop(width: int, height: int) -> Panel:
    """The full-height 9:16 crop from the middle of a landscape (or square) frame."""
    crop_height = _even_floor(height)
    crop_width = min(_even(crop_height * OUTPUT_WIDTH / OUTPUT_HEIGHT), _even_floor(width))
    x = _centred(width, crop_width)
    y = _centred(height, crop_height)
    return Panel(Box(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT), crop_width, crop_height, [CropPoint(0.0, x, y)])


def _filled(width: int, height: int, start: float) -> Panel:
    """The largest 9:16 crop from the middle of a frame of any shape, filling the output."""
    if width * OUTPUT_HEIGHT >= height * OUTPUT_WIDTH:
        crop_height = _even_floor(height)
        crop_width = min(_even(crop_height * OUTPUT_WIDTH / OUTPUT_HEIGHT), _even_floor(width))
    else:
        crop_width = _even_floor(width)
        crop_height = min(_even(crop_width * OUTPUT_HEIGHT / OUTPUT_WIDTH), _even_floor(height))
    x, y = _centred(width, crop_width), _centred(height, crop_height)
    return Panel(Box(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT), crop_width, crop_height, [CropPoint(start, x, y)])


def _fitted(width: int, height: int, start: float) -> Panel:
    """The whole frame, as large as fits in the output and centred in it: a 9:16 one fills it."""
    crop_width, crop_height = _even_floor(width), _even_floor(height)
    scale = min(OUTPUT_WIDTH / crop_width, OUTPUT_HEIGHT / crop_height)
    area_width = min(_even(crop_width * scale), OUTPUT_WIDTH)
    area_height = min(_even(crop_height * scale), OUTPUT_HEIGHT)
    area = Box(_centred(OUTPUT_WIDTH, area_width), _centred(OUTPUT_HEIGHT, area_height), area_width, area_height)
    return Panel(area, crop_width, crop_height, [CropPoint(start, 0, 0)])


# Sizes and offsets are kept even: 4:2:0 video can't be cut at odd pixels.
def _even(value: float) -> int:
    return 2 * round(value / 2)


def _even_floor(value: float) -> int:
    return 2 * int(value // 2)


def _centred(outer: int, inner: int) -> int:
    """The even offset that centres `inner` pixels in `outer` most nearly, keeping it inside."""
    return min(_even((outer - inner) / 2), _even_floor(outer - inner))
