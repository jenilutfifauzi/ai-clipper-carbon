"""Styles: how captions, the hook and the Watermark look, as Style Presets shared by every Job and
Style Overrides on a Candidate.

A Candidate uses one Preset (`Candidate.preset_id`) and may replace any of its fields
(`Candidate.style_overrides`); its style is the Preset with those fields replaced, validated as a
whole. A Candidate whose Preset has been deleted uses Default, whose styles are the defaults below:
the look of v1, which renders exactly as it did.

Built-in Presets are defined here and can't be changed or deleted. The owner's are kept in
DATA_DIR/presets.json.
"""

import math
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, fields, is_dataclass, replace
from enum import StrEnum
from pathlib import Path
from typing import Annotated, NamedTuple
from uuid import uuid4

from pydantic import (
    AfterValidator,
    BeforeValidator,
    Field,
    FiniteFloat,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    WithJsonSchema,
)
from pydantic_core import core_schema

from app.fonts import DEFAULT_FONT, registry
from app.storage import write_atomic

# In DATA_DIR.
PRESETS_FILE = "presets.json"
DEFAULT_PRESET = "default"


def _known_font(font_id: str) -> str:
    ids = registry().ids()
    if font_id not in ids:
        raise ValueError(f"No font {font_id!r}; the fonts are {', '.join(ids)}")
    return font_id


# A Face's id (app/fonts.py): a bundled Face's or an imported one's.
FontId = Annotated[str, AfterValidator(_known_font)]
# An opaque #RRGGBB colour, kept in capitals.
Colour = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$", to_upper=True)]
# A Logo's id (app/logos.py), which names its file.
LogoId = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{8,32}$")]
# A height in output pixels, which the planner keeps inside the safe area.
Height = Annotated[int, Field(ge=0, le=1920)]
# A distance from the frame's left edge in output pixels.
Width = Annotated[int, Field(ge=0, le=1080)]
# Space between letters in output pixels, as libass's \fsp sets it.
Tracking = Annotated[float, Field(ge=-20, le=60)]
# A box's padding or corners' radius, in output pixels.
Padding = Annotated[FiniteFloat, Field(ge=0, le=200)]


class Highlight(StrEnum):
    """How the Word being spoken stands out: in the active colour, on a box of it, or not at all."""

    COLOUR = "colour"
    BOX = "box"
    NONE = "none"


class CaptionPosition(StrEnum):
    """Where caption lines go. Auto: on the seam between Split's panels, in the lower third otherwise."""

    AUTO = "auto"
    TOP = "top"
    MIDDLE = "middle"
    BOTTOM = "bottom"
    # Centred on CaptionStyle.y.
    CUSTOM = "custom"


class Animation(StrEnum):
    """How the hook comes on or goes off screen: at once, fading, popping (growing from 70% while
    fading in, or the reverse), or sliding (60 px up from below while fading in, or the reverse)."""

    NONE = "none"
    FADE = "fade"
    POP = "pop"
    SLIDE = "slide"


class HookShape(StrEnum):
    """How the hook's box is drawn: one block behind all its lines, a strip behind each line, or none."""

    BLOCK = "block"
    STRIPS = "strips"
    NONE = "none"


@dataclass(frozen=True)
class DropShadow:
    """A drop shadow under text, off when its opacity is 0 or its distance and blur both are."""

    # Its letters and their stroke again in `colour` at `opacity`, moved `distance` output pixels
    # towards `angle` degrees clockwise from the right (0 right, 45 down and to the right, 90 down),
    # and blurred `blur` output pixels (as a CSS shadow's blur radius: a Gaussian whose sigma is half
    # of it). A blur at no distance is a halo.
    colour: Colour = "#000000"
    opacity: Annotated[FiniteFloat, Field(ge=0, le=1)] = 0.6
    blur: Annotated[FiniteFloat, Field(ge=0, le=100)] = 0.0
    distance: Annotated[FiniteFloat, Field(ge=0, le=100)] = 0.0
    angle: Annotated[FiniteFloat, Field(ge=-360, le=360)] = 45.0

    @property
    def on(self) -> bool:
        return self.opacity > 0 and (self.distance > 0 or self.blur > 0)

    @property
    def offset(self) -> tuple[float, float]:
        """How far it is moved right and down, in output pixels."""
        angle = math.radians(self.angle)
        return round(self.distance * math.cos(angle), 4), round(self.distance * math.sin(angle), 4)

    @property
    def reach(self) -> int:
        """How far past its text it can fall, in output pixels (none when it is off): its blur's
        reach (three sigmas) and its distance."""
        return math.ceil(1.5 * self.blur + self.distance) if self.on else 0


def hard_shadow(offset: float, colour: str = "#000000") -> DropShadow:
    """The shadow the Caption and Hook Styles had before drop shadows: opaque and unblurred, `offset`
    output pixels right and down (none for 0)."""
    return DropShadow(colour=colour, opacity=1.0, distance=offset * math.sqrt(2))


def migrated_shadow_fields(fields: dict) -> dict:
    """A Caption or Hook Style's fields (all or some, as in a Style Override) saved before drop
    shadows, in today's shape: their `shadow` (an offset right and down) and `shadow_colour` become
    the fields of a `hard_shadow`, an offset of 0 being none. Fields in today's shape are kept."""
    old = isinstance(fields, dict) and ("shadow_colour" in fields or isinstance(fields.get("shadow"), int | float))
    if not old:
        return fields
    fields = dict(fields)
    shadow: dict = {}
    if isinstance(fields.get("shadow"), int | float):
        if offset := fields.pop("shadow"):
            # Its colour is shadow_colour, or the Preset's.
            shadow = {name: value for name, value in asdict(hard_shadow(offset)).items() if name != "colour"}
        else:
            shadow = {"distance": 0.0, "blur": 0.0}
    elif isinstance(fields.get("shadow"), dict):
        shadow = fields.pop("shadow")
    if "shadow_colour" in fields:
        shadow = {**shadow, "colour": fields.pop("shadow_colour")}
    return {**fields, "shadow": shadow}


class _ReadsOldShadow:
    """A style whose stored or sent fields may be in the shape of before drop shadows: read in
    today's (migrated_shadow_fields)."""

    @classmethod
    def __get_pydantic_core_schema__(cls, source: type, handler: Callable[[type], core_schema.CoreSchema]) -> core_schema.CoreSchema:
        return core_schema.no_info_before_validator_function(migrated_shadow_fields, handler(source))


class HookAlign(StrEnum):
    """How the hook's lines line up with each other. The hook itself is centred in the frame."""

    CENTER = "center"
    LEFT = "left"


class HookPosition(StrEnum):
    TOP = "top"
    MIDDLE = "middle"
    BOTTOM = "bottom"
    # With its box's top at HookStyle.y.
    CUSTOM = "custom"


class WatermarkKind(StrEnum):
    """What the Watermark is: nothing, a line of text, or one of the Logos (app/logos.py)."""

    NONE = "none"
    TEXT = "text"
    LOGO = "logo"


class WatermarkPosition(StrEnum):
    """Where the Watermark goes: a corner, an edge's middle or the middle of the safe area, or anywhere."""

    TOP_LEFT = "top_left"
    TOP = "top"
    TOP_RIGHT = "top_right"
    LEFT = "left"
    MIDDLE = "middle"
    RIGHT = "right"
    BOTTOM_LEFT = "bottom_left"
    BOTTOM = "bottom"
    BOTTOM_RIGHT = "bottom_right"
    # Centred on (WatermarkStyle.x, WatermarkStyle.y).
    CUSTOM = "custom"


@dataclass(frozen=True)
class CaptionStyle(_ReadsOldShadow):
    font: FontId = DEFAULT_FONT
    # In libass's units (see app/planner.py's FontMetrics): a line too wide for its area is set smaller.
    size: Annotated[int, Field(ge=40, le=200)] = 110
    colour: Colour = "#FFFFFF"
    active_colour: Colour = "#FF9F0A"
    # In output pixels.
    outline: Annotated[int, Field(ge=0, le=20)] = 7
    outline_colour: Colour = "#000000"
    # Under the text and its outline, as a Text Layer's.
    shadow: DropShadow = DropShadow()
    # Added after every character of a line but its last, in output pixels (pulled in when negative).
    tracking: Tracking = 0.0
    # In capitals, or in the Words' own case.
    uppercase: bool = True
    highlight: Highlight = Highlight.COLOUR
    # The highlight box's padding either side of its Word and above the capitals and below the
    # baseline, and its corners' radius (at most half its height), in output pixels at the style's
    # size (smaller on a line set smaller). None: HIGHLIGHT_PAD_X, HIGHLIGHT_PAD_Y and
    # HIGHLIGHT_RADIUS of the line's size (app/renderer.py).
    padding_x: Padding | None = None
    padding_y: Padding | None = None
    radius: Padding | None = None
    position: CaptionPosition = CaptionPosition.AUTO
    y: Height = 1396
    # Each line's centre, in output pixels, at any position (the planner keeps the line in the
    # frame); None centres it in the frame.
    x: Width | None = None
    # A line ends before a Word that would make it longer than max_chars characters, counted as wide
    # as its tracking makes them (a single longer Word stands alone), hold more than max_words Words,
    # or last more than max_secs, and after a pause of pause_secs.
    max_chars: Annotated[int, Field(ge=4, le=60)] = 16
    max_words: Annotated[int, Field(ge=1, le=12)] | None = None
    max_secs: Annotated[float, Field(ge=0.3, le=10)] = 1.4
    pause_secs: Annotated[float, Field(ge=0.1, le=5)] = 0.5


@dataclass(frozen=True)
class HookStyle(_ReadsOldShadow):
    shape: HookShape = HookShape.BLOCK
    font: FontId = DEFAULT_FONT
    # The size its lines are set at when they fit; smaller when even max_lines lines are too wide.
    size: Annotated[int, Field(ge=40, le=160)] = 88
    max_lines: Annotated[int, Field(ge=1, le=4)] = 2
    # In capitals, or as written.
    uppercase: bool = False
    align: HookAlign = HookAlign.CENTER
    # Added after every character of a line but its last, in output pixels (pulled in when
    # negative); the Kicker's isn't.
    tracking: Tracking = 0.0
    # How far apart its lines' baselines are, in sizes.
    line_height: Annotated[float, Field(ge=0.5, le=2.5)] = 0.82
    colour: Colour = "#FFFFFF"
    # Of the words marked *like this* in the hook text.
    emphasis_colour: Colour = "#FFE600"
    # In output pixels, around and behind the text (not the box).
    outline: Annotated[int, Field(ge=0, le=20)] = 0
    outline_colour: Colour = "#000000"
    # Under the text and its outline (not the box), as a Text Layer's.
    shadow: DropShadow = DropShadow()
    box_colour: Colour = "#000000"
    # 0 draws no box, whatever the shape.
    box_opacity: Annotated[float, Field(ge=0, le=1)] = 0.6
    # The corners of the block or of each strip, in output pixels (at most half its height).
    radius: Annotated[int, Field(ge=0, le=80)] = 24
    # The box's padding either side of the lines (of each line, for Strips) and above the capitals of
    # the first and below the descenders of the last (of each), in output pixels at the style's size
    # (smaller with a hook set smaller). None: the Shape's own (app/planner.py's HOOK_PAD_X and
    # HOOK_PAD_Y round a block, STRIP_PAD_X and STRIP_PAD_Y of the size round a strip). Lines with no
    # box are placed as in a block of the Shape's own.
    padding_x: Padding | None = None
    padding_y: Padding | None = None
    # A badge with quote marks on the corner of the first line's box.
    quote: bool = False
    quote_colour: Colour = "#22C55E"
    # The Kicker's text, and its pill.
    kicker_colour: Colour = "#000000"
    kicker_box_colour: Colour = "#FFE600"
    position: HookPosition = HookPosition.TOP
    y: Height = 232
    # Where its middle is, in output pixels, at any position (the planner keeps it in the frame);
    # None centres its lines in the frame.
    x: Width | None = None
    # Off at its end by a short fade, on from the first frame (which platforms show first).
    animation_in: Animation = Animation.NONE
    animation_out: Animation = Animation.FADE
    animation_ms: Annotated[int, Field(ge=50, le=1000)] = 200


@dataclass(frozen=True)
class WatermarkStyle:
    """A Watermark shown over the whole Clip, under the captions and the hook. Off by default."""

    kind: WatermarkKind = WatermarkKind.NONE
    text: Annotated[str, StringConstraints(max_length=60)] = ""
    font: FontId = DEFAULT_FONT
    colour: Colour = "#FFFFFF"
    # A thin black outline around the text, so that it reads on any shot.
    outline: bool = True
    # The Logo's id; None for none.
    logo: LogoId | None = None
    position: WatermarkPosition = WatermarkPosition.TOP_RIGHT
    # Its centre in output pixels, for the Custom position; the planner keeps it in the frame.
    x: Width = 540
    y: Height = 960
    # How tall it is in output pixels: the Logo's height, or the text's font size (in libass's units).
    size: Annotated[int, Field(ge=24, le=480)] = 64
    opacity: Annotated[float, Field(ge=0.05, le=1)] = 0.8


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
# A Style Override's value: what a style field holds, or, for a field that is itself a value of
# several fields (a shadow), some of those by name, which replace the Preset's. Its schema is short,
# for the MCP tools' list.
StyleValue = Annotated[
    bool | int | float | str | None | dict[str, float | str],
    WithJsonSchema({"type": ["boolean", "number", "string", "object", "null"]}),
]


@dataclass(frozen=True)
class StylePreset:
    id: str
    name: Name
    caption: CaptionStyle = CaptionStyle()
    hook: HookStyle = HookStyle()
    builtin: bool = False
    watermark: WatermarkStyle = WatermarkStyle()


@dataclass(frozen=True)
class StyleOverrides:
    """The fields of the Preset's styles a Candidate replaces, by name."""

    caption: Annotated[dict[str, StyleValue], BeforeValidator(migrated_shadow_fields)] = field(default_factory=dict)
    hook: Annotated[dict[str, StyleValue], BeforeValidator(migrated_shadow_fields)] = field(default_factory=dict)
    watermark: dict[str, StyleValue] = field(default_factory=dict)


class Styles(NamedTuple):
    """A Candidate's styles: its Preset's with its overrides."""

    caption: CaptionStyle
    hook: HookStyle
    watermark: WatermarkStyle = WatermarkStyle()


BUILTIN_PRESETS = [
    StylePreset(DEFAULT_PRESET, "Default", builtin=True),
    StylePreset(
        "yellow-pop",
        "Yellow pop",
        CaptionStyle(font="anton", size=130, active_colour="#FFE600", outline=8, max_chars=18),
        HookStyle(font="anton", colour="#000000", box_colour="#FFE600", box_opacity=1.0),
        builtin=True,
    ),
    StylePreset(
        "box-highlight",
        "Box highlight",
        CaptionStyle(active_colour="#7C3AED", highlight=Highlight.BOX, outline=5),
        HookStyle(box_colour="#7C3AED", box_opacity=0.9),
        builtin=True,
    ),
    StylePreset(
        "minimal",
        "Minimal",
        CaptionStyle(
            font="poppins-black", size=90, uppercase=False, outline=0, shadow=hard_shadow(4), highlight=Highlight.NONE,
            max_chars=24, max_secs=2.0,
        ),
        HookStyle(font="poppins-black", size=72, box_opacity=0.4, radius=16),
        builtin=True,
    ),
    # The reference looks of hook-styles (.scratch/hook-styles/spec.md). Captions go where the hook
    # isn't.
    StylePreset(
        "quote-strip",
        "Quote strips",
        CaptionStyle(),
        HookStyle(
            shape=HookShape.STRIPS, align=HookAlign.LEFT, size=92, max_lines=4, uppercase=True, colour="#000000",
            box_colour="#FFFFFF", box_opacity=1.0, radius=10, quote=True,
        ),
        builtin=True,
    ),
    StylePreset(
        "headline-red",
        "Red headline",
        CaptionStyle(font="anton", size=120, active_colour="#FF3B30", position=CaptionPosition.TOP),
        HookStyle(
            font="anton", size=100, max_lines=4, uppercase=True, align=HookAlign.LEFT, colour="#000000",
            emphasis_colour="#E11D2E", box_colour="#FFFFFF", box_opacity=1.0, radius=0,
            position=HookPosition.CUSTOM, y=1050,
        ),
        builtin=True,
    ),
    StylePreset(
        "quote-card",
        "Quote card",
        CaptionStyle(font="poppins-black", size=90, uppercase=False, outline=0, shadow=hard_shadow(4), max_chars=24, max_secs=2.0,
                     position=CaptionPosition.TOP),
        HookStyle(
            font="poppins-black", size=84, max_lines=3, colour="#000000", emphasis_colour="#16A34A",
            box_colour="#FFFFFF", box_opacity=1.0, radius=0, quote=True, position=HookPosition.BOTTOM,
        ),
        builtin=True,
    ),
    StylePreset(
        "kicker-bare",
        "Kicker over bare text",
        CaptionStyle(position=CaptionPosition.BOTTOM),
        HookStyle(
            shape=HookShape.NONE, size=80, max_lines=4, uppercase=True, align=HookAlign.LEFT, shadow=hard_shadow(4),
            emphasis_colour="#FFE600", kicker_colour="#000000", kicker_box_colour="#FFE600", position=HookPosition.MIDDLE,
        ),
        builtin=True,
    ),
]
DEFAULT = BUILTIN_PRESETS[0]


class InvalidStyle(ValueError):
    pass


class PresetNotFound(LookupError):
    pass


class BuiltinPreset(ValueError):
    """A built-in Preset can't be changed or deleted."""


_CAPTION = TypeAdapter(CaptionStyle)
_HOOK = TypeAdapter(HookStyle)
_WATERMARK = TypeAdapter(WatermarkStyle)
_PRESETS = TypeAdapter(list[StylePreset])


def resolve(preset: StylePreset, overrides: StyleOverrides) -> Styles:
    """The Preset's styles with `overrides` applied; InvalidStyle for an unknown field or a bad value."""
    return Styles(
        _apply(preset.caption, overrides.caption, _CAPTION),
        _apply(preset.hook, overrides.hook, _HOOK),
        _apply(preset.watermark, overrides.watermark, _WATERMARK),
    )


def _apply[T](style: T, changes: dict[str, StyleValue], adapter: TypeAdapter[T]) -> T:
    changes = migrated_shadow_fields(changes)
    _check_names(style, changes)
    values = asdict(style)  # type: ignore[call-overload]
    for name, value in changes.items():
        if isinstance(value, dict):
            part = getattr(style, name)
            if not is_dataclass(part):
                raise InvalidStyle(f"{name}: is one value, not several")
            _check_names(part, value, f"{name}.")
            values[name] = {**values[name], **value}
        else:
            values[name] = value
    try:
        return adapter.validate_python(values)  # type: ignore[call-overload]
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, error['loc']))}: {error['msg']}" for error in exc.errors())
        raise InvalidStyle(problems) from None


def _check_names(style: object, changes: dict[str, StyleValue], prefix: str = "") -> None:
    names = {f.name for f in fields(style)}  # type: ignore[arg-type]
    if unknown := sorted(set(changes) - names):
        raise InvalidStyle(
            f"No style field {', '.join(repr(prefix + name) for name in unknown)}; the fields are {', '.join(sorted(names))}"
        )


class PresetStore:
    """The built-in Presets and the owner's, in `path`."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def all(self) -> list[StylePreset]:
        """The built-in Presets, then the owner's in the order they were made."""
        return [*BUILTIN_PRESETS, *self._saved()]

    def get(self, preset_id: str) -> StylePreset:
        for preset in self.all():
            if preset.id == preset_id:
                return preset
        raise PresetNotFound(preset_id)

    def styles(self, preset_id: str, overrides: StyleOverrides) -> Styles:
        """A Candidate's styles: its Preset's (Default's, if it has been deleted) with its overrides."""
        try:
            preset = self.get(preset_id)
        except PresetNotFound:
            preset = DEFAULT
        return resolve(preset, overrides)

    def create(
        self, name: str, caption: CaptionStyle, hook: HookStyle, watermark: WatermarkStyle = WatermarkStyle()
    ) -> StylePreset:
        with self._lock:
            preset = StylePreset(uuid4().hex[:8], name, caption, hook, watermark=watermark)
            self._save([*self._saved(), preset])
            return preset

    def update(
        self, preset_id: str, name: str, caption: CaptionStyle, hook: HookStyle, watermark: WatermarkStyle = WatermarkStyle()
    ) -> StylePreset:
        with self._lock:
            saved = self._saved()
            i = self._index(saved, preset_id)
            preset = replace(saved[i], name=name, caption=caption, hook=hook, watermark=watermark)
            self._save([*saved[:i], preset, *saved[i + 1 :]])
            return preset

    def delete(self, preset_id: str) -> None:
        with self._lock:
            saved = self._saved()
            i = self._index(saved, preset_id)
            self._save([*saved[:i], *saved[i + 1 :]])

    def _index(self, saved: list[StylePreset], preset_id: str) -> int:
        if any(preset.id == preset_id for preset in BUILTIN_PRESETS):
            raise BuiltinPreset(preset_id)
        for i, preset in enumerate(saved):
            if preset.id == preset_id:
                return i
        raise PresetNotFound(preset_id)

    def _saved(self) -> list[StylePreset]:
        return _PRESETS.validate_json(self.path.read_bytes()) if self.path.is_file() else []

    def _save(self, presets: list[StylePreset]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(self.path, _PRESETS.dump_json(presets, indent=2))
