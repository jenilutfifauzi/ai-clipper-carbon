"""Export Presets: named, global Export Settings that a render uses for its whole batch
(docs/adr/0021-export-presets-and-a-plan-drawn-at-any-size.md). A Clip records the Preset it was
asked for and a copy of the settings it was made with; rendering it again uses the Preset as it is
then, or the default once it is deleted. Export Settings never make a Clip stale.

Built-in Presets are data files shipped with the app, one per Preset in EXPORT_PRESETS_DIR: a stable
id, a name, an order among the built-ins, and the Export Settings in full. Adding a built-in is adding
a file. They can't be changed, renamed or deleted.

The owner's Presets are kept in DATA_DIR/export-presets.json, with the id of the default: built-in
"Shorts / TikTok / Reels" at first, and again when the one chosen is deleted.
"""

import json
import threading
from dataclasses import dataclass, field, fields, replace
from functools import cache
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from pydantic import Field, StringConstraints, TypeAdapter

from app.config import EXPORT_PRESETS_DIR
from app.encoding import ExportSettings
from app.storage import write_atomic
from app.styles import Name

# In DATA_DIR.
EXPORT_PRESETS_FILE = "export-presets.json"
# The built-in Preset rendered with until the owner picks another, and after theirs is deleted.
DEFAULT_EXPORT_PRESET = "shorts"

ExportPresetId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,40}$")]


class ExportPresetNotFound(LookupError):
    pass


class BuiltinExportPreset(ValueError):
    """A built-in Export Preset can't be changed, renamed or deleted."""


@dataclass(frozen=True)
class ExportPreset:
    """Named Export Settings a render uses: built in, or the owner's."""

    id: ExportPresetId
    name: Name
    settings: ExportSettings = ExportSettings()
    # A built-in one's place among them.
    order: Annotated[int, Field(ge=0)] = 0
    builtin: bool = False


@dataclass(frozen=True)
class _Saved:
    """What DATA_DIR/export-presets.json holds."""

    default: str = DEFAULT_EXPORT_PRESET
    presets: list[ExportPreset] = field(default_factory=list)


_PRESET = TypeAdapter(ExportPreset)
_SAVED = TypeAdapter(_Saved)


def builtin_export_presets(folder: Path = EXPORT_PRESETS_DIR) -> list[ExportPreset]:
    """The built-in Presets of `folder`'s data files, by their order. ValueError for a file that isn't
    a valid Preset (an unknown field or a setting left out included), or for two with one id."""
    presets = []
    for path in sorted(folder.glob("*.json")):
        try:
            given = json.loads(path.read_bytes())
            if unknown := sorted(given.keys() - {f.name for f in fields(ExportPreset)} - {"builtin"}):
                raise ValueError(f"no field {', '.join(unknown)}")
            if (wrong := given.get("settings", {}).keys() ^ {f.name for f in fields(ExportSettings)}):
                raise ValueError(f"its settings must give each of their fields, and only those: {', '.join(sorted(wrong))}")
            presets.append(_PRESET.validate_python({**given, "builtin": True}))
        except ValueError as exc:
            raise ValueError(f"Built-in Export Preset {path.name}: {exc}") from None
    ids = [preset.id for preset in presets]
    if twice := sorted({preset_id for preset_id in ids if ids.count(preset_id) > 1}):
        raise ValueError(f"Two built-in Export Presets have the id {', '.join(twice)}")
    return sorted(presets, key=lambda preset: (preset.order, preset.id))


@cache
def _builtins() -> tuple[ExportPreset, ...]:
    presets = builtin_export_presets()
    if DEFAULT_EXPORT_PRESET not in {preset.id for preset in presets}:
        raise ValueError(f"No built-in Export Preset {DEFAULT_EXPORT_PRESET!r} in {EXPORT_PRESETS_DIR}")
    return tuple(presets)


class ExportPresetStore:
    """The built-in Export Presets and the owner's, in `path`, and the default."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def all(self) -> list[ExportPreset]:
        """The built-in Presets by their order, then the owner's in the order they were made."""
        return [*_builtins(), *self._saved().presets]

    def get(self, preset_id: str) -> ExportPreset:
        for preset in self.all():
            if preset.id == preset_id:
                return preset
        raise ExportPresetNotFound(preset_id)

    def default(self) -> ExportPreset:
        """The Preset a render uses when none is asked for: the one chosen, or built-in "Shorts /
        TikTok / Reels" once it is deleted."""
        try:
            return self.get(self._saved().default)
        except ExportPresetNotFound:
            return self.get(DEFAULT_EXPORT_PRESET)

    def get_or_default(self, preset_id: str | None) -> ExportPreset:
        """The Preset `preset_id`, or the default when it is None or deleted: what a Clip asked for
        is rendered with."""
        try:
            return self.default() if preset_id is None else self.get(preset_id)
        except ExportPresetNotFound:
            return self.default()

    def create(self, name: str, settings: ExportSettings) -> ExportPreset:
        builtin = {preset.id for preset in _builtins()}
        with self._lock:
            saved = self._saved()
            preset_id = next(new for new in iter(lambda: uuid4().hex[:8], None) if new not in builtin)
            preset = ExportPreset(preset_id, name, settings)
            self._save(replace(saved, presets=[*saved.presets, preset]))
        return preset

    def change(self, preset_id: str, name: str, settings: ExportSettings) -> ExportPreset:
        """One of the owner's Presets given another name and settings. A Clip made with it keeps the
        copy of the settings it records."""
        with self._lock:
            saved = self._saved()
            i = self._index(saved, preset_id)
            preset = replace(saved.presets[i], name=name, settings=settings)
            self._save(replace(saved, presets=[*saved.presets[:i], preset, *saved.presets[i + 1 :]]))
        return preset

    def delete(self, preset_id: str) -> None:
        """Delete one of the owner's Presets; the default, "Shorts / TikTok / Reels" is the default again."""
        with self._lock:
            saved = self._saved()
            i = self._index(saved, preset_id)
            default = DEFAULT_EXPORT_PRESET if saved.default == preset_id else saved.default
            self._save(_Saved(default, [*saved.presets[:i], *saved.presets[i + 1 :]]))

    def use_as_default(self, preset_id: str) -> ExportPreset:
        """Make the Preset, built-in or the owner's, the one a render uses when none is asked for."""
        with self._lock:
            preset = self.get(preset_id)
            self._save(replace(self._saved(), default=preset.id))
        return preset

    def _index(self, saved: _Saved, preset_id: str) -> int:
        if any(preset.id == preset_id for preset in _builtins()):
            raise BuiltinExportPreset(preset_id)
        for i, preset in enumerate(saved.presets):
            if preset.id == preset_id:
                return i
        raise ExportPresetNotFound(preset_id)

    def _saved(self) -> _Saved:
        return _SAVED.validate_json(self.path.read_bytes()) if self.path.is_file() else _Saved()

    def _save(self, saved: _Saved) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(self.path, _SAVED.dump_json(saved, indent=2))
