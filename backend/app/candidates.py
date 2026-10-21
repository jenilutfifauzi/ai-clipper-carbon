"""Candidates: proposed clips awaiting review."""

import math
from dataclasses import asdict, dataclass, field, fields, replace
from enum import StrEnum
from collections.abc import Iterable, Iterator
from typing import Annotated, Any, NamedTuple

from pydantic import AfterValidator, BeforeValidator, Field, FiniteFloat, StringConstraints, WithJsonSchema

from app.audio_effects import AUDIO_EFFECTS_MAX, AudioEffect, checked_effects
from app.canvas import LONGEST, PORTRAIT, Aspect, Canvas, canvas_for
from app.fonts import DEFAULT_FONT
from app.segment_time import segment_time, track_length
from app.video_effects import VIDEO_EFFECTS_MAX, VideoEffect, checked_video_effects
# Defined apart, so that a Style Preset's Join Transition (app/styles.py) has them too.
from app.transition_kinds import TRANSITION_DEFAULT_SECS, TRANSITION_SECS, TransitionKind, TransitionSound
from app.styles import DEFAULT_PRESET, JoinTransition, Animation, Colour, DropShadow, FontId, HookShape, Padding, StyleOverrides, Tracking

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
# A distance from the Canvas's left or top edge in its pixels (docs/adr/0022), for what a Candidate
# owns: up to any Canvas's longest side here, and checked against its own Canvas by the Candidate
# (`on_canvas`, `check_cue_edits`).
CanvasPixels = Annotated[int, Field(ge=0, le=LONGEST)]
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
    """How the clip is framed. Auto lets the Render Planner choose per scene (never Manual); the
    others replace its choice for every scene. Manual frames the Source by hand with a Framing
    (docs/adr/0007), still for the whole Scene."""

    AUTO = "auto"
    TRACK = "track"
    SPLIT = "split"
    BLUR = "blur"
    MANUAL = "manual"


# A Media Library item's id (app/media.py).
MediaId = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]


@dataclass(frozen=True)
class WordEdit:
    """The owner's correction of one caption Word: the Word whose span holds `at` (seconds on the
    Source's timeline, or with `media` on that Media Library item's, of its Media Words), or failing
    that the nearest within WORD_EDIT_REACH_SECS (app/planner.py), on that timeline only. It applies
    in every Segment showing that time (docs/adr/0020). `text` replaces the Word's text (None keeps
    it; empty removes the Word), and `break_before` starts a caption line at it. Keyed by time, not
    by the Word's place, since a Clip's Words are transcribed again when its range changes; and by
    `(media, at)`, two edits at one time of different timelines being apart."""

    at: FiniteFloat
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=WORD_EDIT_MAX_CHARS)] | None = None
    break_before: bool = False
    media: MediaId | None = None


# A volume, as a factor of the sound's own: 0 mutes it, 2 doubles it.
Volume = Annotated[FiniteFloat, Field(ge=0, le=2)]
# How long a sound's linear fade in or out lasts, in seconds.
Fade = Annotated[FiniteFloat, Field(ge=0, le=10)]
# A Speed (docs/adr/0009): how many seconds of its range an item plays in one on the Timeline.
MIN_SPEED, MAX_SPEED = 0.0625, 16.0
Speed = Annotated[FiniteFloat, Field(ge=MIN_SPEED, le=MAX_SPEED)]
# How far a Music Clip is turned down while speech is heard (Ducking, docs/adr/0016), in dB; and how
# far a song's added from now on is, unless the edit says (app/review.py).
Duck = Annotated[FiniteFloat, Field(ge=-30, le=-1)]
DEFAULT_DUCK = -12.0

# The furthest a Cue Edit moves its Cue, or either of its edges, in seconds of its timeline.
CUE_SHIFT_MAX_SECS = 10.0
CueShift = Annotated[FiniteFloat, Field(ge=-CUE_SHIFT_MAX_SECS, le=CUE_SHIFT_MAX_SECS)]
# The least and the most a Cue Edit scales its Cue, over the Caption Style's size.
CUE_MIN_SCALE, CUE_MAX_SCALE = 0.25, 4.0
CueScale = Annotated[FiniteFloat, Field(ge=CUE_MIN_SCALE, le=CUE_MAX_SCALE)]


# docs/adr/0020-media-words-and-cue-edits.md; matched to its Word by app/planner.py's match_edits.
@dataclass(frozen=True)
class CueEdit:
    """A change to one Cue, keyed as a Word Edit: `at`, any time in its first Word on the Source's
    timeline (with `media`, that item's). That Word starts a Cue. `shift` moves the Cue and its
    highlight, `start_delta` and `end_delta` one edge (negative: earlier), in seconds of that
    timeline (so scaled by Speed); kept between its neighbours and in its Segment. `x` and `y`
    (the Canvas's pixels, docs/adr/0022; on it, `check_cue_edits`) place it, kept in the frame, and `scale`
    multiplies the Caption Style's size for it (before a line too wide is set smaller); None keeps
    the style's. While its Word isn't shown it does nothing, and is kept. With `join`, instead of
    starting a Cue, its Word's Cue is kept with the one before where only a pause, a sentence's end
    or the longest-Cue limit would part them (the line limits still do); it is refused with any
    other field set."""

    at: FiniteFloat
    media: MediaId | None = None
    shift: CueShift = 0.0
    start_delta: CueShift = 0.0
    end_delta: CueShift = 0.0
    x: CanvasPixels | None = None
    y: CanvasPixels | None = None
    scale: CueScale | None = None
    join: bool = False

    def __post_init__(self) -> None:
        if self.join:
            others = [f.name for f in fields(self) if f.name not in ("at", "media", "join") and getattr(self, f.name) != f.default]
            if others:
                raise ValueError(f"A Cue Edit with join sets nothing else: it has {', '.join(others)}")


# The least and the most a Transform scales a picture: a twentieth and eight times its fitted size.
MIN_SCALE = 0.05
MAX_SCALE = 8.0


def _cut(value: float, most: float) -> float:
    return min(max(value, 0.0), max(most, 0.0))


@dataclass(frozen=True)
class Transform:
    """Where and how a picture sits on the Canvas (docs/adr/0007, 0022): centred on (x, y) in
    output pixels, which stays on the frame though the picture may go past its edges; `scale` times its fitted size (the largest that fits the frame keeping its aspect: 1
    fits), stretched `stretch_x` across and `stretch_y` down on top of that (1 keeps its aspect);
    turned `rotation` degrees clockwise about its centre, mirrored left to right (`flip_h`) or top to
    bottom (`flip_v`), at `opacity`. The same for its item's whole length, but for the fields its
    item's Keyframes move (docs/adr/0008). A centre given off the
    frame is brought onto it: here onto the largest Canvas, and onto its Candidate's by `on_canvas`.
    Left out, the centre is the 9:16 Canvas's."""

    x: FiniteFloat = PORTRAIT.width // 2
    y: FiniteFloat = PORTRAIT.height // 2
    scale: Annotated[FiniteFloat, Field(ge=MIN_SCALE, le=MAX_SCALE)] = 1.0
    stretch_x: Annotated[FiniteFloat, Field(ge=0.1, le=10)] = 1.0
    stretch_y: Annotated[FiniteFloat, Field(ge=0.1, le=10)] = 1.0
    rotation: Annotated[FiniteFloat, Field(ge=-360, le=360)] = 0.0
    flip_h: bool = False
    flip_v: bool = False
    opacity: Annotated[FiniteFloat, Field(ge=0, le=1)] = 1.0

    def __post_init__(self) -> None:
        object.__setattr__(self, "x", _cut(self.x, LONGEST))
        object.__setattr__(self, "y", _cut(self.y, LONGEST))


# A new Overlay's: half its fitted size at the frame's centre, 540 px wide for any item wider than
# 9:16 (the editor works out the scale that makes any item 540 px wide).
OVERLAY_TRANSFORM = Transform(scale=0.5)


class TextAlign(StrEnum):
    """How a Text Layer's lines line up with each other."""

    CENTER = "center"
    LEFT = "left"
    RIGHT = "right"


@dataclass(frozen=True)
class Plate:
    """What is drawn behind a Text Style's words: nothing, a Block behind all its lines, or Strips,
    one behind each line, in `colour` at `opacity`."""

    shape: HookShape = HookShape.NONE
    colour: Colour = "#000000"
    opacity: Annotated[FiniteFloat, Field(ge=0, le=1)] = 0.7
    # In output pixels: its corners' radius (at most half its height), and how far it reaches either
    # side of the widest line (of each line, for Strips) and above the capitals of the first line and
    # below the descenders of the last (of each line).
    radius: Padding = 20.0
    padding_x: Padding = 28.0
    padding_y: Padding = 17.6


# The smallest font size of a Text Style.
MIN_TEXT_SIZE = 16


@dataclass(frozen=True)
class TextStyle:
    """How a Text Layer's words look. Lengths in output pixels."""

    # Its Face, at libass's size (a fraction where a Text Layer saved before Text Styles was set
    # smaller to fit the frame).
    font: FontId = DEFAULT_FONT
    size: Annotated[FiniteFloat, Field(ge=MIN_TEXT_SIZE, le=320)] = 80
    colour: Colour = "#FFFFFF"
    # None at 0.
    stroke_width: Annotated[int, Field(ge=0, le=20)] = 0
    stroke_colour: Colour = "#000000"
    # Under the words, over the plate; off by default.
    shadow: DropShadow = DropShadow()
    plate: Plate = Plate()
    # Its lines' baselines this many sizes apart.
    line_height: Annotated[FiniteFloat, Field(ge=0.5, le=3)] = 1.1
    # Added after each character but a line's last (pulled in when negative).
    tracking: Tracking = 0.0
    align: TextAlign = TextAlign.CENTER
    # Its box's least size, plate and padding and all: its words break into lines no wider than the
    # wrap width less the padding (0: the frame less TEXT_MARGIN either side, the box as wide as its
    # words), and are centred down a box at least the fixed height tall (0: the words' own height).
    wrap_width: Annotated[FiniteFloat, Field(ge=0, le=4096)] = 0.0
    fixed_height: Annotated[FiniteFloat, Field(ge=0, le=4096)] = 0.0


@dataclass(frozen=True)
class TextLayer:
    """A free text overlay of the Advanced Edit: `text` (lines split at newlines) from `start` for
    `secs` in Timeline time, centred by its `transform` (never stretched nor flipped) in its `style`,
    coming on and going off as the hook does. Its `keys` move its centre, scale, rotation and opacity
    over its length as an Overlay's do (docs/adr/0008); its animations are stacked on them."""

    # Names it in the editor.
    id: ItemId
    text: Annotated[str, StringConstraints(max_length=TEXT_LAYER_MAX_CHARS)]
    # In Timeline time, so that trimming the Clip leaves it where it was in it.
    start: TimelineStart
    secs: TimelineSecs
    # It is drawn as a picture (docs/adr/0010), scaled, turned and faded by its Transform as an
    # Overlay is, its centre on the frame and the picture maybe past its edges.
    transform: Transform = Transform()
    style: TextStyle = TextStyle()
    animation_in: Animation = Animation.NONE
    animation_out: Animation = Animation.NONE
    animation_ms: Annotated[int, Field(ge=100, le=2000)] = 300
    # Keys is defined with Keyframes, below.
    keys: "Keys" = field(default_factory=dict)

    def __post_init__(self) -> None:
        _check_unstretched(f"Text Layer {self.id}", self.transform, "set its style's size")
        object.__setattr__(self, "keys", checked_keys(self.keys, f"Text Layer {self.id}", PICTURE_KEYS, self.secs))


def _check_unstretched(item: str, transform: Transform, sized: str) -> None:
    """ValueError for the Transform of a picture layer's `item` (a Text Layer, a Shape) that
    stretches or flips it; `sized` says how else it is made larger."""
    if transform.stretch_x != 1 or transform.stretch_y != 1:
        raise ValueError(f"{item} can't be stretched: its transform's stretch_x and stretch_y stay 1 (scale it, or {sized})")
    if transform.flip_h or transform.flip_v:
        raise ValueError(f"{item} can't be flipped: its transform's flip_h and flip_v stay false")


class ShapeKind(StrEnum):
    """The figure a Shape draws (docs/adr/0011): a filled figure (its fill, its stroke inside it and
    its shadow), or a line or an arrow, all stroke."""

    RECTANGLE = "rectangle"
    ELLIPSE = "ellipse"
    # Point up.
    TRIANGLE = "triangle"
    # Leaning right.
    PARALLELOGRAM = "parallelogram"
    # Narrower at the top.
    TRAPEZOID = "trapezoid"
    LINE = "line"
    # Its head at the right end.
    ARROW = "arrow"

    @property
    def all_stroke(self) -> bool:
        """Whether it is all stroke (a line, an arrow): its width its length, its stroke width its
        thickness, its colour the stroke's, and its height and fill not used."""
        return self in _THICKNESSES_TALL

    @property
    def thicknesses_tall(self) -> int | None:
        """How tall a figure that is all stroke is, in its thicknesses: a line one, an arrow its
        head's ARROW_HEAD. None for a filled figure, whose height is its own."""
        return _THICKNESSES_TALL.get(self)


# How tall an arrow's head is, in its thicknesses.
ARROW_HEAD = 4
# The Shape Kinds that are all stroke, and how tall each is in its thicknesses.
_THICKNESSES_TALL = {ShapeKind.LINE: 1, ShapeKind.ARROW: ARROW_HEAD}
# How thick a figure with no stroke is made when it is switched to a line or an arrow, in output
# pixels: the thickness of a new one (the editor's NEW_THICKNESS).
SWITCHED_THICKNESS = 12
# The least and the most a Shape Style's width and height are, in output pixels.
SHAPE_SIZE = (2, 4096)
ShapeSize = Annotated[int, Field(ge=SHAPE_SIZE[0], le=SHAPE_SIZE[1])]
# The thickest a Shape's stroke is, in output pixels.
SHAPE_STROKE_MAX = 200


@dataclass(frozen=True)
class ShapeStyle:
    """How a Shape looks (docs/adr/0011): its figure `kind`, `width` x `height` output pixels before
    its Transform's scale, filled with `fill` (None: none), with a stroke `stroke_width` pixels thick
    (none at 0) drawn inside its width and height, its corners rounded `radius` times its shorter
    side (a rectangle's; 0.5 makes a pill) and a drop shadow as a Text Layer's. Never stretched: a
    wider Shape is a new width, drawn again, so that its stroke and corners keep their size. A line
    and an arrow are all stroke: their width is their length, `stroke_width` their thickness (never
    0) and `stroke_colour` their colour; their height and fill are kept but not used, so that
    switching the kind back finds them as they were."""

    kind: ShapeKind = ShapeKind.RECTANGLE
    width: ShapeSize = 400
    height: ShapeSize = 400
    fill: Colour | None = "#FFFFFF"
    stroke_colour: Colour = "#000000"
    stroke_width: Annotated[int, Field(ge=0, le=SHAPE_STROKE_MAX)] = 0
    radius: Annotated[FiniteFloat, Field(ge=0, le=0.5)] = 0.0
    # Under the figure, off by default.
    shadow: DropShadow = DropShadow()

    @property
    def size(self) -> tuple[int, int]:
        """The box its figure fills, in output pixels before its Transform's scale: its width and
        height; a line's length and thickness, an arrow's length and the height of its head."""
        tall = self.kind.thicknesses_tall
        return (self.width, self.height) if tall is None else (self.width, tall * self.stroke_width)


@dataclass(frozen=True)
class Shape:
    """A figure of the Advanced Edit (docs/adr/0011): drawn in its `style` from `start` for `secs` in
    Timeline time, centred by its `transform` (never stretched nor flipped), coming on and going off
    as a Text Layer does. Its `keys` move its centre, scale, rotation and opacity over its length;
    its animations are stacked on them."""

    # Names it in the editor.
    id: ItemId
    # In Timeline time, so that trimming the Clip leaves it where it was in it.
    start: TimelineStart
    secs: TimelineSecs
    # It is drawn as a picture, as a Text Layer is: scaled, turned and faded by its Transform, its
    # centre on the frame and the picture maybe past its edges.
    transform: Transform = Transform()
    style: ShapeStyle = ShapeStyle()
    animation_in: Animation = Animation.NONE
    animation_out: Animation = Animation.NONE
    animation_ms: Annotated[int, Field(ge=100, le=2000)] = 300
    # Keys is defined with Keyframes, below.
    keys: "Keys" = field(default_factory=dict)

    def __post_init__(self) -> None:
        _check_unstretched(f"Shape {self.id}", self.transform, "set its style's width and height")
        kind = self.style.kind
        if kind.all_stroke and not self.style.stroke_width:
            named = "an arrow" if kind is ShapeKind.ARROW else "a line"
            raise ValueError(f"Shape {self.id} has nothing to draw: {named} is all stroke, its stroke_width its thickness: give it one")
        if self.style.fill is None and not self.style.stroke_width:
            raise ValueError(f"Shape {self.id} has nothing to draw: give its style a fill or a stroke (stroke_width)")
        object.__setattr__(self, "keys", checked_keys(self.keys, f"Shape {self.id}", PICTURE_KEYS, self.secs))


class Ease(NamedTuple):
    """How a Keyframe is approached from the one before it (docs/adr/0008): a CSS cubic-bezier from
    (0, 0) to (1, 1) through (x1, y1) and (x2, y2). `x1` and `x2` are kept within 0..1, where the
    curve moves forwards in time; `y1` and `y2` may overshoot, within EASE_Y. Stored as its four
    numbers."""

    x1: float
    y1: float
    x2: float
    y2: float


LINEAR = Ease(0.0, 0.0, 1.0, 1.0)
EASE_IN = Ease(0.42, 0.0, 1.0, 1.0)
EASE_OUT = Ease(0.0, 0.0, 0.58, 1.0)
EASE_IN_OUT = Ease(0.42, 0.0, 0.58, 1.0)
# The presets by the names the API and the agent give them; any other Ease is Custom.
EASES = {"linear": LINEAR, "ease_in": EASE_IN, "ease_out": EASE_OUT, "ease_in_out": EASE_IN_OUT}
# A preset is recognised within this of each of its numbers.
PRESET_REACH = 0.005
# How far an Ease's y may overshoot.
EASE_Y = (-2.0, 3.0)


def tidy_ease(ease: Ease) -> Ease:
    """`ease` with its x held to 0..1 and its y to EASE_Y; Linear when any of it isn't finite."""
    if not all(math.isfinite(number) for number in ease):
        return LINEAR
    x1, y1, x2, y2 = ease
    low, high = EASE_Y
    return Ease(min(max(x1, 0.0), 1.0), min(max(y1, low), high), min(max(x2, 0.0), 1.0), min(max(y2, low), high))


def ease_name(ease: Ease) -> str | None:
    """The preset `ease` is (within PRESET_REACH of each number), or None for a Custom one."""
    return next((name for name, preset in EASES.items() if all(abs(a - b) <= PRESET_REACH for a, b in zip(ease, preset))), None)


def _named_ease(value: Any) -> Any:
    if isinstance(value, str):
        if value not in EASES:
            raise ValueError(f"An Ease is {', '.join(EASES)} or four numbers [x1, y1, x2, y2], not {value!r}")
        return EASES[value]
    return value


# Given as a preset's name or as four numbers; always kept as four numbers, tidied.
EaseField = Annotated[
    Ease,
    BeforeValidator(_named_ease),
    AfterValidator(tidy_ease),
    WithJsonSchema({
        "anyOf": [
            {"enum": list(EASES)},
            {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
        ],
        "description": "A preset's name, or a cubic-bezier [x1, y1, x2, y2]",
    }),
]


@dataclass(frozen=True)
class Keyframe:
    """The value of one property of an item at one time (docs/adr/0008): `at` seconds from the item's
    start, `value` in the property's own units, approached from the Keyframe before by `ease` (the
    first one's is unused)."""

    at: Annotated[FiniteFloat, Field(ge=0, le=3600)]
    value: FiniteFloat
    ease: EaseField = LINEAR


class KeyProperty(StrEnum):
    """What a Keyframe sets: a picture's centre, scale, rotation and opacity (its Transform's fields),
    or a sound's volume."""

    X = "x"
    Y = "y"
    SCALE = "scale"
    ROTATION = "rotation"
    OPACITY = "opacity"
    VOLUME = "volume"


# The properties of a picture that Keyframes can move, and of a sound.
PICTURE_KEYS = (KeyProperty.X, KeyProperty.Y, KeyProperty.SCALE, KeyProperty.ROTATION, KeyProperty.OPACITY)
SOUND_KEYS = (KeyProperty.VOLUME,)
# Each property's range, in its own units. A centre beyond the frame is brought onto it, as a
# Transform's is (here onto the largest Canvas: `key_range` gives a Canvas's); any other value
# outside its range is refused. A picture may turn several times.
KEY_RANGES = {
    KeyProperty.X: (0.0, float(LONGEST)),
    KeyProperty.Y: (0.0, float(LONGEST)),
    KeyProperty.SCALE: (MIN_SCALE, MAX_SCALE),
    KeyProperty.ROTATION: (-3600.0, 3600.0),
    KeyProperty.OPACITY: (0.0, 1.0),
    KeyProperty.VOLUME: (0.0, 2.0),
}
_CLAMPED = {KeyProperty.X, KeyProperty.Y}


def key_range(prop: KeyProperty, frame: tuple[int, int]) -> tuple[float, float]:
    """`prop`'s range on a frame `frame` (width, height) large: a centre's on it."""
    if prop is KeyProperty.X:
        return 0.0, float(frame[0])
    if prop is KeyProperty.Y:
        return 0.0, float(frame[1])
    return KEY_RANGES[prop]


# At most this many Keyframes on one property of an item, and at least a frame (at 30 fps) between
# two of them (less half a millisecond, for times sent rounded).
MAX_KEYS = 100
KEY_GAP_SECS = 1 / 30
_GAP_REACH = 0.0005
# An `at` this little past its item's length is at its end.
_END_REACH = 0.001

# A map from property to its Keyframes; the properties without any are left out. An alias of its
# own, so that the tools' schemas define it once and name it where an item has it.
type Keys = dict[KeyProperty, list[Keyframe]]


def checked_keys(keys: Keys, item: str, allowed: tuple[KeyProperty, ...], length: float) -> Keys:
    """`keys` of `item` (such as "Overlay o1"), lasting `length` seconds, each list sorted by `at`, a
    centre's values brought onto the frame, and the properties without Keyframes left out; ValueError
    for a property the item can't have, more than MAX_KEYS on one, two closer than a frame, an `at`
    past its length or a value outside its range."""
    checked: Keys = {}
    for name, given in keys.items():
        prop = KeyProperty(name)
        if prop not in allowed:
            raise ValueError(f"{item} has no {prop} Keyframes: its {_listed(allowed)} can be keyed")
        if len(given) > MAX_KEYS:
            raise ValueError(f"{item} has {len(given)} {prop} Keyframes; a property has {MAX_KEYS} at most")
        low, high = KEY_RANGES[prop]
        ordered = sorted(given, key=lambda key: key.at)
        for before, key in zip(ordered, ordered[1:]):
            if key.at - before.at < KEY_GAP_SECS - _GAP_REACH:
                raise ValueError(
                    f"{item}'s {prop} Keyframes at {before.at:g} s and {key.at:g} s are closer than a frame (1/30 s)"
                )
        for key in ordered:
            if key.at > length + _END_REACH:
                raise ValueError(f"{item}'s {prop} Keyframe at {key.at:g} s is past its length of {length:g} s; send its keys too")
            if prop not in _CLAMPED and not low <= key.value <= high:
                raise ValueError(f"{item}'s {prop} Keyframe at {key.at:g} s is {key.value:g}; {prop} is {low:g} to {high:g}")
        if ordered:
            checked[prop] = [
                replace(key, value=min(max(key.value, low), high)) if prop in _CLAMPED else key for key in ordered
            ]
    return checked


def _listed(names: tuple[str, ...]) -> str:
    return ", ".join(names[:-1]) + f" and {names[-1]}" if len(names) > 1 else names[0]

# The most a Crop cuts off one edge, and off a pair of opposite edges: a tenth is always kept.
MAX_CUT = 0.9
CropEdge = Annotated[FiniteFloat, Field(ge=0, le=MAX_CUT)]


@dataclass(frozen=True)
class Crop:
    """What is cut off each edge of a picture before it is fitted (docs/adr/0007), as fractions of
    its width (`left`, `right`) and height (`top`, `bottom`). Tidied as Concat's is: each edge held
    to 0..0.9, and a pair that would leave less than a tenth pulled back by its second edge."""

    left: CropEdge = 0.0
    top: CropEdge = 0.0
    right: CropEdge = 0.0
    bottom: CropEdge = 0.0

    def __post_init__(self) -> None:
        left, top = _cut(self.left, MAX_CUT), _cut(self.top, MAX_CUT)
        object.__setattr__(self, "left", left)
        object.__setattr__(self, "top", top)
        object.__setattr__(self, "right", _cut(self.right, MAX_CUT - left))
        object.__setattr__(self, "bottom", _cut(self.bottom, MAX_CUT - top))


@dataclass(frozen=True)
class Border:
    """A line `width` output pixels wide, of `colour`, along the inside of a picture's edge (its
    rounded corners too). The same width however large the picture is drawn."""

    width: Annotated[int, Field(ge=1, le=40)] = 8
    colour: Colour = "#FFFFFF"


@dataclass(frozen=True)
class Shadow:
    """A drop shadow under a picture: its shape in `colour` at `opacity`, blurred `blur` output
    pixels (as a CSS shadow's blur radius) and moved `x` right and `y` down on the frame, whichever
    way the picture is turned. The same size however large the picture is drawn."""

    blur: Annotated[FiniteFloat, Field(ge=0, le=100)] = 24.0
    x: Annotated[FiniteFloat, Field(ge=-100, le=100)] = 0.0
    y: Annotated[FiniteFloat, Field(ge=-100, le=100)] = 12.0
    colour: Colour = "#000000"
    opacity: Annotated[FiniteFloat, Field(ge=0, le=1)] = 0.5


@dataclass(frozen=True)
class MusicClip:
    """A song (or a video's sound) from the Media Library under the Clip, or without `media` the
    Source's sound, heard from `start` for `secs` in Timeline time: secs * speed of it from `offset`
    seconds in, at `volume` (its volume `keys` in place of it), faded in and out, ducked under speech
    by `duck` dB (docs/adr/0008, 0016), or itself speech when marked `speech` (docs/adr/0018), heard
    through its stack of `audio_effects` (docs/adr/0017)."""
    # Its read is kept within its file with the Media Library at hand (app/api.py), or within the
    # Source (app/review.py), and its fades multiply its keys. The Source's is also at the Clip's
    # own volume (`source_volume`), as a Segment of it is; `offset` is then a time on its timeline.

    id: ItemId
    media: MediaId | None = field(default=None, kw_only=True)
    start: TimelineStart
    secs: TimelineSecs
    offset: FileOffset = 0.0
    volume: Volume = 1.0
    # Its pitch kept unless `pitch`; backwards, from a Retimed copy, with `reverse`, `offset` then
    # being where it ends in the file.
    speed: Speed = 1.0
    pitch: bool = False
    reverse: bool = False
    fade_in: Fade = 0.0
    fade_out: Fade = 0.0
    keys: Keys = field(default_factory=dict)
    # Switched silent (docs/adr/0016), keeping its volume, Keyframes and fades.
    muted: bool = False
    # Turned down by this many dB while speech is heard (docs/adr/0016); None: not ducked. The
    # Source's sound is speech itself, and is never ducked.
    duck: Duck | None = None
    # Marked Speech (docs/adr/0018): a song's of a voice, a Take's or an uploaded voice memo's, which
    # is speech for Ducking over its whole span, pauses included, and so is never ducked itself. The
    # Source's sound has its Words for speech, and is never marked.
    speech: bool = False
    # The Segment whose sound was Detached onto it (docs/adr/0016), which Reattach finds it by: it
    # names one of the Candidate's when it is added or changed (app/review.py).
    detached_from: ItemId | None = None
    # Its sound's Audio Effects (docs/adr/0017), in order, after its Speed and Reverse and before its
    # volume (× its duck), fades and delay; each setting filled in once checked. Empty in one saved
    # before them.
    audio_effects: Annotated[list[AudioEffect], Field(max_length=AUDIO_EFFECTS_MAX)] = field(default_factory=list)

    def __post_init__(self) -> None:
        if isinstance(self.start, str):
            # `media` is given by name (it may be left out): MusicClip(id, start, secs, media=...).
            raise TypeError(f"Music Clip {self.id} was given its media in place of its start")
        if self.media is None and self.duck is not None:
            raise ValueError(f"Music Clip {self.id} plays the episode's sound, which is never ducked: it has no duck")
        if self.media is None and self.speech:
            raise ValueError(f"Music Clip {self.id} plays the episode's sound, whose Words are its speech: it isn't marked Speech")
        if self.speech and self.duck is not None:
            raise ValueError(f"Music Clip {self.id} is Speech, which is never ducked: it has no duck")
        object.__setattr__(self, "keys", checked_keys(self.keys, f"Music Clip {self.id}", SOUND_KEYS, self.secs))
        object.__setattr__(self, "audio_effects", checked_effects(self.audio_effects, f"Music Clip {self.id}"))


# An Adjust's dials (docs/adr/0013), in Concat's ranges: temperature in kelvin (6500 the picture as
# shot), exposure in stops of light, the rest signed percents, or from 0 for sharpen, fade and vignette.
TEMPERATURE_K = (2000, 11000)
NEUTRAL_TEMPERATURE_K = 6500
EXPOSURE_EV = (-3, 3)
Dial = Annotated[FiniteFloat, Field(ge=-100, le=100)]
EffectDial = Annotated[FiniteFloat, Field(ge=0, le=100)]


@dataclass(frozen=True)
class Adjust:
    """The dials of a Grade (GLOSSARY.md, Adjust), each neutral by default: Color (temperature, tint
    green to magenta, saturation from grey), Lightness (exposure, brightness, contrast, then
    highlights and shadows, the broad halves of the curve, and whites and blacks, its narrow ends)
    and Effects (sharpen, fade into a matte, vignette)."""

    temperature: Annotated[FiniteFloat, Field(ge=TEMPERATURE_K[0], le=TEMPERATURE_K[1])] = NEUTRAL_TEMPERATURE_K
    tint: Dial = 0.0
    saturation: Dial = 0.0
    exposure: Annotated[FiniteFloat, Field(ge=EXPOSURE_EV[0], le=EXPOSURE_EV[1])] = 0.0
    brightness: Dial = 0.0
    contrast: Dial = 0.0
    highlights: Dial = 0.0
    shadows: Dial = 0.0
    whites: Dial = 0.0
    blacks: Dial = 0.0
    sharpen: EffectDial = 0.0
    fade: EffectDial = 0.0
    vignette: EffectDial = 0.0


@dataclass(frozen=True)
class Grade:
    """The colour of a picture (GLOSSARY.md, Grade; docs/adr/0013): its `adjust`, then its `look` (a
    Look's id, none by default) mixed over it at `intensity` percent. Constant over its item."""

    adjust: Adjust = Adjust()
    look: str | None = None
    intensity: Annotated[FiniteFloat, Field(ge=0, le=100)] = 100.0

    @property
    def neutral(self) -> bool:
        """Whether it leaves the picture as it is: every dial neutral, and no Look."""
        return self.adjust == Adjust() and self.look is None


class BlendMode(StrEnum):
    """How an Overlay is laid over what is under it (docs/adr/0014): covering it by its alpha
    (Normal), or its colour mixed with what is under it by its mode, then laid by its alpha."""

    NORMAL = "normal"
    MULTIPLY = "multiply"
    SCREEN = "screen"
    ADD = "add"
    LIGHTEN = "lighten"
    DARKEN = "darken"


@dataclass(frozen=True)
class Overlay:
    """A video or image from the Media Library laid over the Clip (picture in picture): from `start`
    for `secs`, in Timeline time, a video from `offset` seconds into it; cut by its `crop` and placed
    by its `transform`, a video's sound at `volume` (none by default). Its corners are rounded
    `radius` times the drawn picture's shorter side (0.5 makes a pill or a circle), and it may have a
    `border` and a `shadow`. Its `keys` move its centre, scale, rotation and opacity over its length,
    and shape a video's volume (docs/adr/0008): a property with Keyframes takes its value from them,
    not from its Transform or `volume`. It comes on and goes off as a Text Layer does, its
    animations stacked on its keyed values; they move its picture only, never its sound. A video's
    sound is heard through its `audio_effects` (docs/adr/0017). An image's volume Keyframes, Speed,
    pitch, Reverse and Audio Effects are refused with the Media Library at hand (app/api.py)."""

    id: ItemId
    media: MediaId
    start: TimelineStart
    secs: TimelineSecs
    offset: FileOffset = 0.0
    transform: Transform = OVERLAY_TRANSFORM
    crop: Crop = Crop()
    volume: Volume = 0.0
    # A video's: over its `secs` it shows `secs` × speed of it from `offset` (docs/adr/0009), its
    # sound keeping its pitch unless `pitch`; backwards, from a Retimed copy, with `reverse`, so that
    # `offset` is then the frame it ends on (its left edge shows `offset + secs × speed`).
    speed: Speed = 1.0
    pitch: bool = False
    reverse: bool = False
    radius: Annotated[FiniteFloat, Field(ge=0, le=0.5)] = 0.0
    border: Border | None = None
    shadow: Shadow | None = None
    keys: Keys = field(default_factory=dict)
    animation_in: Animation = Animation.NONE
    animation_out: Animation = Animation.NONE
    animation_ms: Annotated[int, Field(ge=100, le=2000)] = 300
    # A video's sound switched silent (docs/adr/0016), keeping its volume and Keyframes.
    muted: bool = False
    # Its colour (docs/adr/0013): its picture graded after it is scaled and flipped, before its
    # corners, border, shadow and opacity. Neutral in one saved before Grades.
    grade: Grade = Grade()
    # A video's sound's Audio Effects (docs/adr/0017), as a Music Clip's; an image has none (refused
    # with the Media Library at hand, app/api.py). Empty in one saved before them.
    audio_effects: Annotated[list[AudioEffect], Field(max_length=AUDIO_EFFECTS_MAX)] = field(default_factory=list)
    # Its picture's Video Effects (docs/adr/0014), in order: after its Grade, before its corners,
    # border, rotation, shadow and opacity; sizes at its fitted size. Empty in one saved before them.
    video_effects: Annotated[list[VideoEffect], Field(max_length=VIDEO_EFFECTS_MAX)] = field(default_factory=list)
    # How it is laid over what is under it, after its opacity (docs/adr/0014). Normal in one saved
    # before Blend Modes.
    blend: BlendMode = BlendMode.NORMAL

    def __post_init__(self) -> None:
        object.__setattr__(self, "keys", checked_keys(self.keys, f"Overlay {self.id}", PICTURE_KEYS + SOUND_KEYS, self.secs))
        object.__setattr__(self, "audio_effects", checked_effects(self.audio_effects, f"Overlay {self.id}"))
        object.__setattr__(self, "video_effects", checked_video_effects(self.video_effects, f"Overlay {self.id}", keyed=True))


@dataclass(frozen=True)
class AdjustmentLayer:
    """A span of the Adjust Track (GLOSSARY.md, Adjustment Layer; docs/adr/0013): its `grade` laid
    over the Main Track and the Overlays from `start` for `secs` in Timeline time, mixed over the
    picture as it was by `strength` percent times its fade ramp, which comes up over `fade_in`
    seconds from its start and goes down over `fade_out` to its end, each at most half its length.
    Its `video_effects` (docs/adr/0014) are drawn after its Grade and mixed with it. It never touches
    the Watermark, captions, Shapes, Text Layers or hook."""

    id: ItemId
    start: TimelineStart
    secs: TimelineSecs
    grade: Grade = Grade()
    strength: Annotated[FiniteFloat, Field(ge=0, le=100)] = 100.0
    fade_in: Fade = 0.0
    fade_out: Fade = 0.0
    # Its Video Effects (docs/adr/0014), in order, after its Grade over the Canvas (scale 1),
    # mixed back with it by its strength and fades. Empty in one saved before them.
    video_effects: Annotated[list[VideoEffect], Field(max_length=VIDEO_EFFECTS_MAX)] = field(default_factory=list)

    def __post_init__(self) -> None:
        object.__setattr__(self, "video_effects", checked_video_effects(self.video_effects, f"Adjustment Layer {self.id}"))
        half = self.secs / 2
        for name in ("fade_in", "fade_out"):
            if getattr(self, name) > half + 1e-9:
                raise ValueError(f"Adjustment Layer {self.id}'s {name} is at most half its length ({half:g} s), not {getattr(self, name):g} s")


class BackgroundKind(StrEnum):
    """What shows behind a Framing's picture: the picture itself, covering the frame, blurred and
    darkened (as the Blur Layout's background is), or a colour."""

    BLUR = "blur"
    COLOUR = "colour"


@dataclass(frozen=True)
class Background:
    """What shows wherever a Framing's picture doesn't cover the frame, and behind it below its full
    opacity: its `kind`, and its `colour` when that is a colour."""

    kind: BackgroundKind = BackgroundKind.BLUR
    colour: Colour = "#000000"


@dataclass(frozen=True)
class Framing:
    """How a picture fills the frame on its own (docs/adr/0007): a media Segment's video, or the
    Source in a Manual Scene, cut by its `crop`, placed by its `transform`, over its `background`."""

    transform: Transform = Transform()
    crop: Crop = Crop()
    background: Background = Background()


@dataclass(frozen=True)
class LayoutOverride:
    """The Layout of the one Scene (as planned, short ones merged) that holds `at`, seconds on the
    Source's timeline, in place of the Candidate's Layout there. Auto chooses that Scene's by its
    faces even where the Candidate's Layout is forced. A Manual one frames it by its `framing`,
    which only a Manual one has (app/review.py), and its `keys` move (docs/adr/0008)."""

    at: FiniteFloat
    layout: Layout
    framing: Framing | None = None
    # Its Framing's centre, scale, rotation and opacity, each `at` in seconds from its Scene's start
    # on the Source's timeline, so that a piece of the Source shown twice moves alike both times.
    # Its Scene's length comes from the analysis, so an `at` need only be ≥ 0: the planner ignores
    # those past its Scene's end.
    keys: Keys = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.layout is not Layout.MANUAL and any(self.keys.values()):
            raise ValueError(
                f"The {self.layout} Layout Override at {self.at:g} s has no Keyframes: only a Manual one's framing can be keyed"
            )
        item = f"The Layout Override at {self.at:g} s"
        object.__setattr__(self, "keys", checked_keys(self.keys, item, PICTURE_KEYS, math.inf))


@dataclass(frozen=True)
class Segment:
    """A piece of the Main Track (docs/adr/0002-segments-and-timeline-time.md): the Source from `start`
    to `end` on its timeline, snapped to Words as a Clip's edges are; or, with `media`, a video from
    the Media Library from `start` to `end` seconds into it, placed by its `framing` (which only it
    has: the Source is framed by its Layouts), its own sound at `volume`. A Clip's Segments play in
    order, back to back. `id` names it in the editor. It may have `keys` (docs/adr/0008): a video's
    Segment for its Framing and sound, a Segment of the Source for its sound only.
    With `hold`, it is a Freeze frame (docs/adr/0009): the frame at `start` held that long, silent.
    Its sound is heard through its stack of `audio_effects` (docs/adr/0017), and its frame drawn
    through its `video_effects` (docs/adr/0014)."""

    id: ItemId
    start: Annotated[FiniteFloat, Field(ge=0)]
    end: Annotated[FiniteFloat, Field(ge=0)]
    media: MediaId | None = None
    framing: Framing | None = None
    volume: Volume = 1.0
    # It plays its range in (end − start) ÷ speed on the Timeline; its sound keeps its pitch unless `pitch`.
    speed: Speed = 1.0
    pitch: bool = False
    # It plays its range backwards, from a Retimed copy (docs/adr/0009): its left edge on the Timeline is its `end`.
    reverse: bool = False
    # They move its Framing's centre, scale, rotation and opacity, and shape its sound's volume,
    # over its length, each `at` in seconds from its start (where it starts on the Timeline, which
    # is `start` seconds into its video). A Segment of the Source has only volume ones: its Layouts frame it.
    keys: Keys = field(default_factory=dict)
    # A Freeze frame's (docs/adr/0009): how long it holds the frame at `start`, silent; `end` is `start`.
    hold: TimelineSecs | None = None
    # A video's Captions switch (docs/adr/0020): False leaves it uncaptioned and its item untranscribed;
    # empty means on. A Segment of the Source has none: it is captioned whenever its Job is.
    captions: bool | None = None
    # Its sound faded in from its start on the Timeline and out to its end (a Transition's overlap
    # included), linearly, as a Music Clip's; the planner fits them to its length. A Freeze frame has none.
    fade_in: Fade = 0.0
    fade_out: Fade = 0.0
    # Its sound switched silent (docs/adr/0016), keeping its volume, Keyframes and fades.
    muted: bool = False
    # Its colour (docs/adr/0013): its whole frame (panels, picture and Background) graded before the
    # joins, so that a Transition blends graded pictures. Neutral in one saved before Grades.
    grade: Grade = Grade()
    # Its sound's Audio Effects (docs/adr/0017), in order, after its Speed and Reverse and before its
    # volume, Keyframes and fades; each setting filled in once checked. Empty in one saved before them.
    audio_effects: Annotated[list[AudioEffect], Field(max_length=AUDIO_EFFECTS_MAX)] = field(default_factory=list)
    # Its whole frame's Video Effects (docs/adr/0014), in order, after its Grade and before the joins,
    # so that a Transition blends pictures that carry them; sizes at the Canvas's. Empty in
    # one saved before them. A Freeze frame takes them too.
    video_effects: Annotated[list[VideoEffect], Field(max_length=VIDEO_EFFECTS_MAX)] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.media is None and (framed := next((name for name, keys in self.keys.items() if keys and name not in SOUND_KEYS), None)):
            raise ValueError(f"Segment {self.id} shows the episode, whose Layouts frame it: it has no {framed} Keyframes, only volume ones")
        if self.media is None and self.captions is not None:
            raise ValueError(f"Segment {self.id} shows the episode, which has no Captions switch: only a video's Segment has one")
        if self.hold is not None:
            _check_held(self)
        length = segment_time(self).length
        object.__setattr__(self, "keys", checked_keys(self.keys, f"Segment {self.id}", PICTURE_KEYS + SOUND_KEYS, length))
        object.__setattr__(self, "audio_effects", checked_effects(self.audio_effects, f"Segment {self.id}"))
        object.__setattr__(self, "video_effects", checked_video_effects(self.video_effects, f"Segment {self.id}"))


def _check_held(segment: Segment) -> None:
    """ValueError unless a Freeze frame's other fields are a held frame's: its `end` at its `start`,
    at 1x, forwards, and no volume Keyframes, fades nor Audio Effects (it is silent)."""
    if segment.end != segment.start:
        raise ValueError(f"Segment {segment.id} holds the frame at its start for {segment.hold:g} s: its end must equal its start")
    if segment.speed != 1 or segment.pitch or segment.reverse:
        raise ValueError(f"Segment {segment.id} is a Freeze frame (hold): it has no Speed, pitch or Reverse")
    if KeyProperty.VOLUME in segment.keys:
        raise ValueError(f"Segment {segment.id} is a Freeze frame (hold), which is silent: it has no volume Keyframes")
    if segment.fade_in or segment.fade_out:
        raise ValueError(f"Segment {segment.id} is a Freeze frame (hold), which is silent: it has no fades")
    if segment.audio_effects:
        raise ValueError(f"Segment {segment.id} is a Freeze frame (hold), which is silent: it has no audio effects")


@dataclass(frozen=True)
class Transition:
    """A Transition from the Segment `after` into the one after it, lasting `secs`: the two overlap
    by that long, so the Clip is that much shorter. Kept to half the shorter of the two by the planner.
    Its knobs are read by the kinds that have them (app/transitions.py): `strength` (0..1, unset for
    the kind's own) and `colour` (Dip to colour's, black when unset). Either is kept on a kind that
    doesn't read it, so changing back restores it."""

    after: ItemId
    kind: TransitionKind = TransitionKind.FADE
    secs: Annotated[FiniteFloat, Field(ge=TRANSITION_SECS[0], le=TRANSITION_SECS[1])] = TRANSITION_DEFAULT_SECS
    sound: TransitionSound = TransitionSound.LINEAR
    strength: Annotated[FiniteFloat, Field(ge=0, le=1)] | None = None
    colour: Colour | None = None


def timeline_length(segments: list["Segment"], transitions: list[Transition]) -> float:
    """How long a Main Track of `segments` plays: their Timeline lengths, less their Transitions' overlaps."""
    by_join = {transition.after: transition.secs for transition in transitions}
    return track_length([segment_time(segment) for segment in segments], [by_join.get(segment.id) for segment in segments])


def with_join_transition(
    before: list[ItemId], after: list[ItemId], transitions: list[Transition], join: JoinTransition | None
) -> list[Transition]:
    """The Join Transition rule (GLOSSARY): `transitions`, as a change of the Main Track from Segment
    ids `before` to `after` left them, then a copy of the Style Preset's Join Transition `join` on
    each join (a pair of adjacent Segments) there after and not before that has no Transition, in Main
    Track order. The editor's twin is editor/joinTransition.ts; both read tests/fixtures/join_transitions.json."""
    if join is None:
        return transitions
    old = set(zip(before, before[1:]))
    has = {transition.after for transition in transitions}
    new = [first for first, second in zip(after, after[1:]) if (first, second) not in old and first not in has]
    return [*transitions, *(Transition(first, **asdict(join)) for first in new)]


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
    # Its Canvas Aspect (docs/adr/0022), whose Canvas everything it owns is placed on in pixels; 9:16
    # in one saved before them.
    aspect: Aspect = Aspect.PORTRAIT
    # Chosen for rendering.
    selected: bool = False
    # The owner has changed its bounds, hook text, layout or style.
    edited: bool = False
    # Its Style Preset (Default, if that has been deleted) and the fields of it replaced (app/styles.py).
    preset_id: str = DEFAULT_PRESET
    style_overrides: StyleOverrides = field(default_factory=StyleOverrides)
    # Corrections of its caption Words.
    word_edits: list[WordEdit] = field(default_factory=list)
    # Changes to single Cues, by the time of their first Word; none in a Candidate saved before them.
    cue_edits: list[CueEdit] = field(default_factory=list)
    # When the hook comes on, in seconds into the Clip, and how long it stays (both kept in the Clip).
    hook_start: float = 0.0
    hook_secs: float = 3.0
    # Layouts of single Scenes.
    layout_overrides: list[LayoutOverride] = field(default_factory=list)
    # A short label in a pill above the hook ("" for none).
    hook_kicker: str = ""
    # The Advanced Edit's Text Layers, drawn in this order (the last on top).
    text_layers: list[TextLayer] = field(default_factory=list)
    # The Advanced Edit's Shapes, drawn in this order (the last on top) over the captions and under
    # the Text Layers; none in a Candidate saved before Shapes.
    shapes: list[Shape] = field(default_factory=list)
    # Its Music Clips, mixed under its own sound, which is at `source_volume`.
    music: list[MusicClip] = field(default_factory=list)
    source_volume: Volume = 1.0
    # Its Main Track, in order; none (the default) for one Segment from `start` to `end`.
    segments: list[Segment] = field(default_factory=list)
    # Laid over its Segments, in this order (the last on top).
    overlays: list[Overlay] = field(default_factory=list)
    # Between its Segments, each by the Segment it follows.
    transitions: list[Transition] = field(default_factory=list)
    # How its Manual Layout frames every Scene without an override; only a Manual Candidate has one.
    framing: Framing | None = None
    # Its colour (docs/adr/0013): laid over its whole Main Track, after the Segments' own Grades and the
    # Transitions, before the Overlays (which it never touches). Neutral in one saved before it.
    grade: Grade = Grade()
    # Its Adjustment Layers (docs/adr/0013), over the Main Track and the Overlays, applied in this order;
    # none in a Candidate saved before them.
    adjustment_layers: list[AdjustmentLayer] = field(default_factory=list)
    # Its saved state's number (ADR 0003): each save that changes it makes the next; choosing it for
    # rendering doesn't. One saved before Revisions is at 1.
    revision: int = 1

    @property
    def canvas(self) -> Canvas:
        return canvas_for(self.aspect)

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
            {clip.media for clip in self.music if clip.media}
            | {segment.media for segment in self.segments if segment.media}
            | {overlay.media for overlay in self.overlays}
        )

    def grades(self) -> Iterator[tuple[str, Grade]]:
        """Each of its Grades, with the part it is."""
        return grades_of(self.grade, self.segments, self.overlays, self.adjustment_layers)

    def looks(self) -> dict[str, list[str]]:
        """The Looks its Grades name (app/looks.py), each with the parts that name it."""
        named: dict[str, list[str]] = {}
        for part, grade in self.grades():
            if grade.look is not None:
                named.setdefault(grade.look, []).append(part)
        return named

    def faces(self) -> dict[str, list[str]]:
        """The Faces it names (app/fonts.py), each with the parts that name it: its Text Layers, and
        its Style Overrides by section."""
        named: dict[str, list[str]] = {}
        for layer in self.text_layers:
            named.setdefault(layer.style.font, []).append(f"Text Layer {layer.id}")
        for section in ("caption", "hook", "watermark"):
            face = getattr(self.style_overrides, section).get("font")
            if isinstance(face, str):
                named.setdefault(face, []).append(f"{section} style")
        return named

    @property
    def reviewed(self) -> bool:
        """Whether it holds the owner's review work, which a new run of Selection must keep."""
        return self.origin is Origin.MANUAL or self.edited or self.selected


def grades_of(
    grade: Grade | None, segments: Iterable[Segment], overlays: Iterable[Overlay], adjustment_layers: Iterable[AdjustmentLayer]
) -> Iterator[tuple[str, Grade]]:
    """Each Grade of these parts of a Candidate (its own `grade` when given), with the part it is."""
    if grade is not None:
        yield "its grade", grade
    for segment in segments:
        yield f"Segment {segment.id}", segment.grade
    for overlay in overlays:
        yield f"Overlay {overlay.id}", overlay.grade
    for layer in adjustment_layers:
        yield f"Adjustment Layer {layer.id}", layer.grade


def on_canvas(candidate: Candidate) -> Candidate:
    """`candidate` with every centre it owns brought onto its Canvas, as a Transform's is onto the
    frame: its Transforms' (of its Framing, Segments, Overlays, Text Layers, Shapes and Layout
    Overrides), their position Keyframes' and its Cue Edits'. (Changing its aspect leaves them where
    they were, in pixels.)"""
    width, height = candidate.canvas.size

    def placed(transform: Transform) -> Transform:
        x, y = _cut(transform.x, width), _cut(transform.y, height)
        return transform if (x, y) == (transform.x, transform.y) else replace(transform, x=x, y=y)

    def framed(framing: Framing | None) -> Framing | None:
        if framing is None:
            return None
        transform = placed(framing.transform)
        return framing if transform is framing.transform else replace(framing, transform=transform)

    def keyed(keys: Keys) -> Keys:
        def on(prop: KeyProperty, given: list[Keyframe]) -> list[Keyframe]:
            if prop not in _CLAMPED:
                return given
            low, high = key_range(prop, (width, height))
            return [key if low <= key.value <= high else replace(key, value=min(max(key.value, low), high)) for key in given]

        moved = {prop: on(prop, given) for prop, given in keys.items()}
        return keys if moved == keys else moved

    def item[T](item: T) -> T:
        changes: dict[str, Any] = {}
        if isinstance(transform := getattr(item, "transform", None), Transform) and (now := placed(transform)) is not transform:
            changes["transform"] = now
        if (framing := getattr(item, "framing", None)) is not None and (now := framed(framing)) is not framing:
            changes["framing"] = now
        if (keys := getattr(item, "keys", None)) and (now := keyed(keys)) is not keys:
            changes["keys"] = now
        return replace(item, **changes) if changes else item  # type: ignore[type-var]

    def cue(edit: CueEdit) -> CueEdit:
        x = None if edit.x is None else min(edit.x, width)
        y = None if edit.y is None else min(edit.y, height)
        return edit if (x, y) == (edit.x, edit.y) else replace(edit, x=x, y=y)

    return replace(
        candidate,
        framing=framed(candidate.framing),
        segments=[item(segment) for segment in candidate.segments],
        overlays=[item(overlay) for overlay in candidate.overlays],
        text_layers=[item(layer) for layer in candidate.text_layers],
        shapes=[item(shape) for shape in candidate.shapes],
        layout_overrides=[item(override) for override in candidate.layout_overrides],
        cue_edits=[cue(edit) for edit in candidate.cue_edits],
    )


def check_cue_edits(edits: list[CueEdit], canvas: Canvas) -> None:
    """ValueError for a Cue Edit placed off `canvas`."""
    for edit in edits:
        for axis, value, most in (("x", edit.x, canvas.width), ("y", edit.y, canvas.height)):
            if value is not None and value > most:
                raise ValueError(
                    f"The Cue Edit at {edit.at:g} s has {axis} {value}: the {canvas.aspect} Canvas is "
                    f"{canvas.width} wide and {canvas.height} tall"
                )


def manual_candidate(id: str, start: float, end: float, aspect: Aspect = Aspect.PORTRAIT) -> Candidate:
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
        aspect=aspect,
    )
