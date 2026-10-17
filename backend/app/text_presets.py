"""Text Presets: named Text Styles that a new Text Layer starts from. A Text Layer copies its
Preset's style; nothing links them, so changing or deleting a Preset leaves every Text Layer as it is.

Built-in Presets are data files shipped with the app, one per Preset in TEXT_PRESETS_DIR: a stable
id, a name, a category (the Text tab's shelf), an order among the built-ins, a sample text, and a
Text Style given as any of its fields, laid over the defaults. Adding a built-in is adding a file.
They can't be changed, renamed or deleted.

The owner's Presets are kept in DATA_DIR/text-presets.json, with the id of the one used for new
titles: built-in Text at first, and again when the one chosen is deleted.
"""

import json
import threading
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import asdict, dataclass, field, fields, replace
from functools import cache
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from pydantic import Field, StringConstraints, TypeAdapter

from app.candidates import TextStyle
from app.config import TEXT_PRESETS_DIR
from app.listeners import Listeners
from app.storage import write_atomic
from app.styles import Name, laid_over

# In DATA_DIR.
TEXT_PRESETS_FILE = "text-presets.json"
# The built-in Preset used for new titles until the owner picks another, and after theirs is deleted.
DEFAULT_TEXT_PRESET = "text"
# The shelf the owner's Presets are on, ahead of the built-ins'.
MINE = "Mine"

TextPresetId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,40}$")]


class TextPresetNotFound(LookupError):
    pass


class BuiltinTextPreset(ValueError):
    """A built-in Text Preset can't be changed, renamed or deleted."""


@dataclass(frozen=True)
class TextPreset:
    """A named Text Style a new Text Layer copies: built in, or the owner's."""

    id: TextPresetId
    name: Name
    style: TextStyle = TextStyle()
    # The words it is shown in on its shelf, which a Text Layer made from it starts with. An owner's
    # Preset's is its name.
    sample: Annotated[str, StringConstraints(min_length=1, max_length=60)] = "Text"
    # Its shelf in the Text tab, and a built-in one's place: the shelves are in the order of their
    # first Preset.
    category: Annotated[str, StringConstraints(min_length=1, max_length=40)] = MINE
    order: Annotated[int, Field(ge=0)] = 0
    builtin: bool = False


@dataclass(frozen=True)
class _Saved:
    """What DATA_DIR/text-presets.json holds."""

    # The Preset used for new titles.
    default: str = DEFAULT_TEXT_PRESET
    presets: list[TextPreset] = field(default_factory=list)


_PRESET = TypeAdapter(TextPreset)
_SAVED = TypeAdapter(_Saved)
_DEFAULT_STYLE = asdict(TextStyle())


def builtin_text_presets(folder: Path = TEXT_PRESETS_DIR) -> list[TextPreset]:
    """The built-in Presets of `folder`'s data files, by their order. ValueError for a file that isn't
    a valid Preset (an unknown field included), or for two with one id."""
    presets = []
    for path in sorted(folder.glob("*.json")):
        try:
            given = json.loads(path.read_bytes())
            if unknown := sorted(given.keys() - {f.name for f in fields(TextPreset)} - {"builtin"}):
                raise ValueError(f"no field {', '.join(unknown)}")
            style = laid_over(_DEFAULT_STYLE, given.get("style", {}), "style.")
            presets.append(_PRESET.validate_python({**given, "style": style, "builtin": True}))
        except ValueError as exc:
            raise ValueError(f"Built-in Text Preset {path.name}: {exc}") from None
    ids = [preset.id for preset in presets]
    if twice := sorted({preset_id for preset_id in ids if ids.count(preset_id) > 1}):
        raise ValueError(f"Two built-in Text Presets have the id {', '.join(twice)}")
    return sorted(presets, key=lambda preset: (preset.order, preset.id))


@cache
def _builtins() -> tuple[TextPreset, ...]:
    presets = builtin_text_presets()
    if DEFAULT_TEXT_PRESET not in {preset.id for preset in presets}:
        raise ValueError(f"No built-in Text Preset {DEFAULT_TEXT_PRESET!r} in {TEXT_PRESETS_DIR}")
    return tuple(presets)


class TextPresetStore:
    """The built-in Text Presets and the owner's, in `path`, and the one used for new titles."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._listeners = Listeners()

    def all(self) -> list[TextPreset]:
        """The built-in Presets by their order, then the owner's in the order they were made."""
        return [*_builtins(), *self._saved().presets]

    def get(self, preset_id: str) -> TextPreset:
        for preset in self.all():
            if preset.id == preset_id:
                return preset
        raise TextPresetNotFound(preset_id)

    def default(self) -> TextPreset:
        """The Preset used for new titles: the one chosen, or built-in Text once it is deleted."""
        try:
            return self.get(self._saved().default)
        except TextPresetNotFound:
            return self.get(DEFAULT_TEXT_PRESET)

    def create(self, name: str, style: TextStyle) -> TextPreset:
        builtin = {preset.id for preset in _builtins()}
        with self._lock:
            saved = self._saved()
            preset_id = next(new for new in iter(lambda: uuid4().hex[:8], None) if new not in builtin)
            preset = TextPreset(preset_id, name, style, sample=name)
            self._save(replace(saved, presets=[*saved.presets, preset]))
        self._listeners.notify()
        return preset

    def change(self, preset_id: str, name: str | None = None, style: TextStyle | None = None) -> TextPreset:
        """One of the owner's Presets renamed, given another style, or both."""
        with self._lock:
            saved = self._saved()
            i = self._index(saved, preset_id)
            preset = saved.presets[i]
            if name is not None:
                preset = replace(preset, name=name, sample=name)
            if style is not None:
                preset = replace(preset, style=style)
            self._save(replace(saved, presets=[*saved.presets[:i], preset, *saved.presets[i + 1 :]]))
        self._listeners.notify()
        return preset

    def delete(self, preset_id: str) -> None:
        """Delete one of the owner's Presets; used for new titles, built-in Text is used again."""
        with self._lock:
            saved = self._saved()
            i = self._index(saved, preset_id)
            default = DEFAULT_TEXT_PRESET if saved.default == preset_id else saved.default
            self._save(_Saved(default, [*saved.presets[:i], *saved.presets[i + 1 :]]))
        self._listeners.notify()

    def use_for_new_titles(self, preset_id: str) -> TextPreset:
        """Make the Preset, built-in or the owner's, the one used for new titles."""
        with self._lock:
            preset = self.get(preset_id)
            self._save(replace(self._saved(), default=preset.id))
        self._listeners.notify()
        return preset

    def watch(self, listener: Callable[[], None]) -> AbstractContextManager[None]:
        """Call `listener` each time the Presets or the one used for new titles change, until the block
        ends. It is called on the thread making the change, and must return quickly."""
        return self._listeners.watching(listener)

    def _index(self, saved: _Saved, preset_id: str) -> int:
        if any(preset.id == preset_id for preset in _builtins()):
            raise BuiltinTextPreset(preset_id)
        for i, preset in enumerate(saved.presets):
            if preset.id == preset_id:
                return i
        raise TextPresetNotFound(preset_id)

    def _saved(self) -> _Saved:
        return _SAVED.validate_json(self.path.read_bytes()) if self.path.is_file() else _Saved()

    def _save(self, saved: _Saved) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(self.path, _SAVED.dump_json(saved, indent=2))
