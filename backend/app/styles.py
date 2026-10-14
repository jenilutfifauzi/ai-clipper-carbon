"""Styles: how captions and the hook look, as Style Presets shared by every Job and Style Overrides
on a Candidate.

A Candidate uses one Preset (`Candidate.preset_id`) and may replace any of its fields
(`Candidate.style_overrides`); its style is the Preset with those fields replaced, validated as a
whole. A Candidate whose Preset has been deleted uses Default, whose styles are the defaults below:
the look of v1, which renders exactly as it did.

Built-in Presets are defined here and can't be changed or deleted. The owner's are kept in
DATA_DIR/presets.json.
"""

import threading
from dataclasses import asdict, dataclass, field, fields, replace
from enum import StrEnum
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from pydantic import AfterValidator, Field, StringConstraints, TypeAdapter, ValidationError

from app.fonts import DEFAULT_FONT, FONTS
from app.storage import write_atomic

# In DATA_DIR.
PRESETS_FILE = "presets.json"
DEFAULT_PRESET = "default"


def _known_font(font_id: str) -> str:
    if font_id not in FONTS:
        raise ValueError(f"No font {font_id!r}; the fonts are {', '.join(FONTS)}")
    return font_id


FontId = Annotated[str, AfterValidator(_known_font)]
# An opaque #RRGGBB colour, kept in capitals.
Colour = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$", to_upper=True)]
# A height in output pixels, which the planner keeps inside the safe area.
Height = Annotated[int, Field(ge=0, le=1920)]


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


class HookPosition(StrEnum):
    TOP = "top"
    MIDDLE = "middle"
    BOTTOM = "bottom"
    # With its box's top at HookStyle.y.
    CUSTOM = "custom"


@dataclass(frozen=True)
class CaptionStyle:
    font: FontId = DEFAULT_FONT
    # In libass's units (see app/planner.py's FontMetrics): a line too wide for its area is set smaller.
    size: Annotated[int, Field(ge=40, le=200)] = 110
    colour: Colour = "#FFFFFF"
    active_colour: Colour = "#FF9F0A"
    # In output pixels.
    outline: Annotated[int, Field(ge=0, le=20)] = 7
    outline_colour: Colour = "#000000"
    shadow: Annotated[int, Field(ge=0, le=20)] = 0
    shadow_colour: Colour = "#000000"
    # In capitals, or in the Words' own case.
    uppercase: bool = True
    highlight: Highlight = Highlight.COLOUR
    position: CaptionPosition = CaptionPosition.AUTO
    y: Height = 1396
    # A line ends before a Word that would make it longer than max_chars characters (a single longer
    # Word stands alone), hold more than max_words Words, or last more than max_secs, and after a
    # pause of pause_secs.
    max_chars: Annotated[int, Field(ge=4, le=60)] = 16
    max_words: Annotated[int, Field(ge=1, le=12)] | None = None
    max_secs: Annotated[float, Field(ge=0.3, le=10)] = 1.4
    pause_secs: Annotated[float, Field(ge=0.1, le=5)] = 0.5


@dataclass(frozen=True)
class HookStyle:
    font: FontId = DEFAULT_FONT
    # The size its lines are set at when they fit; smaller when even two lines are too wide.
    size: Annotated[int, Field(ge=40, le=160)] = 88
    colour: Colour = "#FFFFFF"
    box_colour: Colour = "#000000"
    # 0 draws no box.
    box_opacity: Annotated[float, Field(ge=0, le=1)] = 0.6
    radius: Annotated[int, Field(ge=0, le=80)] = 24
    position: HookPosition = HookPosition.TOP
    y: Height = 232


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
# A Style Override's value: what a style field holds.
StyleValue = bool | int | float | str | None


@dataclass(frozen=True)
class StylePreset:
    id: str
    name: Name
    caption: CaptionStyle = CaptionStyle()
    hook: HookStyle = HookStyle()
    builtin: bool = False


@dataclass(frozen=True)
class StyleOverrides:
    """The fields of the Preset's styles a Candidate replaces, by name."""

    caption: dict[str, StyleValue] = field(default_factory=dict)
    hook: dict[str, StyleValue] = field(default_factory=dict)


BUILTIN_PRESETS = [
    StylePreset(DEFAULT_PRESET, "Default", builtin=True),
    StylePreset(
        "yellow-pop",
        "Yellow pop",
        CaptionStyle(size=120, active_colour="#FFE600", outline=8),
        HookStyle(colour="#000000", box_colour="#FFE600", box_opacity=1.0),
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
        CaptionStyle(size=90, uppercase=False, outline=0, shadow=4, highlight=Highlight.NONE, max_chars=24, max_secs=2.0),
        HookStyle(size=72, box_opacity=0.4, radius=16),
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
_PRESETS = TypeAdapter(list[StylePreset])


def resolve(preset: StylePreset, overrides: StyleOverrides) -> tuple[CaptionStyle, HookStyle]:
    """The Preset's styles with `overrides` applied; InvalidStyle for an unknown field or a bad value."""
    return _apply(preset.caption, overrides.caption, _CAPTION), _apply(preset.hook, overrides.hook, _HOOK)


def _apply[T](style: T, changes: dict[str, StyleValue], adapter: TypeAdapter[T]) -> T:
    names = {f.name for f in fields(style)}  # type: ignore[arg-type]
    if unknown := sorted(set(changes) - names):
        raise InvalidStyle(f"No style field {', '.join(map(repr, unknown))}; the fields are {', '.join(sorted(names))}")
    try:
        return adapter.validate_python({**asdict(style), **changes})  # type: ignore[call-overload]
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, error['loc']))}: {error['msg']}" for error in exc.errors())
        raise InvalidStyle(problems) from None


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

    def styles(self, preset_id: str, overrides: StyleOverrides) -> tuple[CaptionStyle, HookStyle]:
        """A Candidate's styles: its Preset's (Default's, if it has been deleted) with its overrides."""
        try:
            preset = self.get(preset_id)
        except PresetNotFound:
            preset = DEFAULT
        return resolve(preset, overrides)

    def create(self, name: str, caption: CaptionStyle, hook: HookStyle) -> StylePreset:
        with self._lock:
            preset = StylePreset(uuid4().hex[:8], name, caption, hook)
            self._save([*self._saved(), preset])
            return preset

    def update(self, preset_id: str, name: str, caption: CaptionStyle, hook: HookStyle) -> StylePreset:
        with self._lock:
            saved = self._saved()
            i = self._index(saved, preset_id)
            preset = replace(saved[i], name=name, caption=caption, hook=hook)
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
