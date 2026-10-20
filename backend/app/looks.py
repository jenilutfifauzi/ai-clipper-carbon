"""Looks (GLOSSARY.md, Look; docs/adr/0013): named sets of Adjust values a Grade lays over its own
Adjust at an intensity (app/grading.py says how).

Built-in Looks are data files shipped with the app, one per Look in LOOKS_DIR: a stable id, a name,
a category (the Filters tab's shelf: Cinematic, Film, Retro, Portrait, Black & White, Vibe), an order
among them, and the Adjust values, any dial left out at neutral. Adding a Look is adding a file. A
shipped Look never changes, so that an app update can't recolour a saved Candidate: a revised one gets
a new id (and file).

Imported Looks (GLOSSARY.md, Imported Look) are the owner's `.cube` files, kept for every Job in
DATA_DIR/looks beside the Faces and Logos (`ImportedLooks`; the process's store is opened on the data
directory by the app and the CLI, `use`). Each has neutral Adjust values and a 3D table, which the
render draws with ffmpeg's `lut3d` (app/grading.py). A file is read as text (`parse_cube`): a 3D table
of 2 to LARGEST_TABLE a side, its domain (DOMAIN_MIN/DOMAIN_MAX, or Resolve's LUT_3D_INPUT_RANGE)
resampled to 0..1, and kept in that form; anything else is refused naming its line. Every import is a
new Look, named after its TITLE or its file name ("Name (2)" for a name taken). At import a table per
channel and a 3×3 matrix are fitted to the 3D table (`fit_table`), which the preview draws in its place:
near, not exact.
"""

import json
import math
import threading
from dataclasses import dataclass, fields
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Annotated
from uuid import uuid4

import numpy as np
from pydantic import Field, StringConstraints, TypeAdapter

from app.candidates import Adjust
from app.config import LOOKS_DIR
from app.library import Index
from app.storage import write_atomic

# In DATA_DIR, with its index.
IMPORTED_DIR = "looks"
INDEX_FILE = "looks.json"
# The Filters tab's shelf of the Imported Looks, after the built-in ones.
IMPORTED = "Imported"
IMPORTED_ORDER = 10_000
# Texels a side the largest table taken has (65 is the largest anyone ships), and the largest file.
LARGEST_TABLE = 65
MAX_UPLOAD_BYTES = 16 * 2**20
NAME_LENGTH = 40
# The entries of each fitted table, as the fold's (app/grading.py's TABLE_SIZE).
FIT_SIZE = 256

LookId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,60}$")]


class LookNotFound(LookupError):
    pass


class BadCube(ValueError):
    """The file isn't a `.cube` table that can be imported; the message names the line."""


class LookInUse(ValueError):
    """An Imported Look a Candidate's Grade still names."""


@dataclass(frozen=True)
class Fit:
    """What the preview draws for an Imported Look's 3D table: a table per channel (R, G, B; FIT_SIZE
    entries, the output for input i / (FIT_SIZE − 1), 0..1), then a colour matrix (rows R, G, B of
    weights on the tables' R, G, B), as the fold's tables and matrix are drawn."""

    tables: tuple[tuple[float, ...], tuple[float, ...], tuple[float, ...]]
    matrix: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]


@dataclass(frozen=True)
class Look:
    """A named Adjust a Grade's `look` names, built in or imported (with a 3D table: `has_table`, and
    the `fit` the preview draws in its place)."""

    id: LookId
    name: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    # Its shelf in the Filters tab, and its place: the shelves are in the order of their first Look.
    category: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    order: Annotated[int, Field(ge=0)]
    adjust: Adjust = Adjust()
    has_table: bool = False
    fit: Fit | None = None


_LOOK = TypeAdapter(Look)
# What a built-in Look's file may give.
_BUILTIN_FIELDS = {"id", "name", "category", "order", "adjust"}


def builtin_looks(folder: Path = LOOKS_DIR) -> list[Look]:
    """The built-in Looks of `folder`'s data files, by their order. ValueError for a file that isn't a
    valid Look (an unknown field, or a dial out of its range, included), or for two with one id."""
    looks = []
    for path in sorted(folder.glob("*.json")):
        try:
            given = json.loads(path.read_bytes())
            if unknown := sorted(given.keys() - _BUILTIN_FIELDS):
                raise ValueError(f"no field {', '.join(unknown)}")
            if unknown := sorted(given.get("adjust", {}).keys() - {f.name for f in fields(Adjust)}):
                raise ValueError(f"no dial {', '.join(unknown)}")
            looks.append(_LOOK.validate_python(given))
        except ValueError as exc:
            raise ValueError(f"Built-in Look {path.name}: {exc}") from None
    ids = [look.id for look in looks]
    if twice := sorted({look_id for look_id in ids if ids.count(look_id) > 1}):
        raise ValueError(f"Two built-in Looks have the id {', '.join(twice)}")
    return sorted(looks, key=lambda look: (look.order, look.id))


@cache
def _builtins() -> tuple[Look, ...]:
    return tuple(builtin_looks())


def all_looks() -> list[Look]:
    """Every Look: the built-in ones by their order, then the Imported ones as they were imported."""
    return [*_builtins(), *_store.all()]


def get_look(look_id: str) -> Look:
    """The Look `look_id`, built in or imported; LookNotFound for none."""
    for look in _builtins():
        if look.id == look_id:
            return look
    return _store.get(look_id)


def imported_looks() -> "ImportedLooks":
    """The Imported Looks of this process."""
    return _store


def use(folder: Path | None) -> "ImportedLooks":
    """Make the process's Imported Looks those of `folder` (none without one), and return them."""
    global _store
    _store = ImportedLooks(folder)
    return _store


@dataclass(frozen=True)
class _Imported:
    """An Imported Look as its index keeps it: its table is <id>.cube in the store's folder."""

    id: str
    name: str
    # Texels a side of its table.
    size: int
    created: datetime
    fit: Fit


_IMPORTED = TypeAdapter(list[_Imported])


class ImportedLooks:
    """The owner's Imported Looks, in `folder`: <id>.cube each (the table as kept, on 0..1), the tables
    mixed at an intensity made from it (<id>@<intensity>.cube), and their index. Without a folder, none."""

    def __init__(self, folder: Path | None) -> None:
        self.folder = folder
        self._index = None if folder is None else Index(folder / INDEX_FILE, _IMPORTED)
        self._lock = threading.Lock()
        # The Looks as last read, and the index's state they were read at.
        self._read: tuple[tuple[int, int] | None, list[Look]] = (None, [])

    def all(self) -> list[Look]:
        """In the order they were imported."""
        if self._index is None:
            return []
        try:
            stat = self._index.path.stat()
            state: tuple[int, int] | None = (stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            state = None
        seen, looks = self._read
        if state != seen or state is None:
            looks = [
                Look(item.id, item.name, IMPORTED, IMPORTED_ORDER + number, Adjust(), True, item.fit)
                for number, item in enumerate(self._index.all())
            ]
            self._read = (state, looks)
        return looks

    def get(self, look_id: str) -> Look:
        """LookNotFound for none."""
        for look in self.all():
            if look.id == look_id:
                return look
        raise LookNotFound(look_id)

    def add(self, data: bytes, filename: str) -> Look:
        """Import the `.cube` file `data`, uploaded as `filename`, as a new Look. BadCube when it is
        too large or isn't a 3D table that can be imported (the message names its line)."""
        if self.folder is None or self._index is None:
            raise BadCube("Looks can't be imported here")
        if len(data) > MAX_UPLOAD_BYTES:
            raise BadCube(f"A .cube file can be {MAX_UPLOAD_BYTES // 2**20} MB at most")
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise BadCube("That isn't a .cube file: it isn't text") from None
        title, table = parse_cube(text)
        fitted = fit_table(table)
        with self._lock:
            taken = {look.name for look in (*_builtins(), *self.all())}
            name = _unique_name((title or Path(filename).stem).strip() or "Look", taken)
            look_id = uuid4().hex
            self.folder.mkdir(parents=True, exist_ok=True)
            file = self.folder / f"{look_id}.cube"
            write_atomic(file, cube_text(table, name))
            try:
                self._index.add(_Imported(look_id, name, table.shape[0], datetime.now(UTC), fitted))
            except BaseException:
                file.unlink(missing_ok=True)
                raise
        return self.get(look_id)

    def delete(self, look_id: str) -> None:
        """Remove an Imported Look and its tables. LookNotFound for none. (Whether a Candidate still
        names it is for the caller to check.)"""
        with self._lock:
            if self._index is None or self.folder is None or not self._index.remove(look_id):
                raise LookNotFound(look_id)
            for file in [self.folder / f"{look_id}.cube", *self.folder.glob(f"{look_id}@*.cube")]:
                file.unlink(missing_ok=True)

    def table(self, look_id: str, intensity: float = 100) -> Path:
        """The `.cube` file the render draws the Look with at `intensity` (0..100): its table mixed over
        the identity, entry by entry, which `lut3d`'s interpolation keeps (so the picture is mixed so
        too). LookNotFound for none, or one whose table is gone from disk."""
        self.get(look_id)
        assert self.folder is not None
        file = self.folder / f"{look_id}.cube"
        if not file.is_file():
            raise LookNotFound(look_id)
        intensity = min(100.0, max(0.0, round(float(intensity), 2)))
        if intensity >= 100:
            return file
        mixed = self.folder / f"{look_id}@{intensity:g}.cube"
        if not mixed.is_file():
            _, table = parse_cube(file.read_text())
            identity = _identity(table.shape[0])
            write_atomic(mixed, cube_text(identity + (table - identity) * intensity / 100))
        return mixed


_store = ImportedLooks(None)


def parse_cube(text: str) -> tuple[str | None, np.ndarray]:
    """The TITLE (None for none) and the 3D table of the `.cube` file `text`: an array [b][g][r][channel]
    of outputs on 0..1 for inputs on 0..1, its domain resampled to that. BadCube naming the line for a
    1D table, a size out of 2..LARGEST_TABLE, a line that isn't a keyword or three numbers, or rows
    that aren't the size's."""
    title = None
    size = None
    domain_min, domain_max = [0.0] * 3, [1.0] * 3
    rows: list[tuple[float, float, float]] = []
    last = 0
    for number, raw in enumerate(text.lstrip("\ufeff").splitlines(), start=1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        last = number
        head, _, rest = line.partition(" ")
        rest = rest.strip()
        if head == "TITLE":
            title = rest.strip('"').strip()[:200] or None
        elif head == "LUT_1D_SIZE":
            raise BadCube(f"Line {number}: a 1D table; only 3D tables can be imported")
        elif head == "LUT_3D_SIZE":
            if size is not None:
                raise BadCube(f"Line {number}: a second LUT_3D_SIZE")
            try:
                size = int(rest)
            except ValueError:
                raise BadCube(f"Line {number}: LUT_3D_SIZE needs a whole number") from None
            if not 2 <= size <= LARGEST_TABLE:
                raise BadCube(f"Line {number}: a table {size} a side; it can be 2 to {LARGEST_TABLE}")
        elif head in ("DOMAIN_MIN", "DOMAIN_MAX"):
            triple = _numbers(rest, 3, number, f"{head} needs three numbers")
            if head == "DOMAIN_MIN":
                domain_min = triple
            else:
                domain_max = triple
        elif head == "LUT_3D_INPUT_RANGE":
            low, high = _numbers(rest, 2, number, f"{head} needs two numbers")
            domain_min, domain_max = [low] * 3, [high] * 3
        elif head[0].isalpha() and not _is_number(head):
            # Another tool's keyword, such as Resolve's LUT_IN_VIDEO_RANGE: nothing the rows depend on.
            continue
        else:
            if size is None:
                raise BadCube(f"Line {number}: a row before LUT_3D_SIZE")
            if len(rows) == size**3:
                raise BadCube(f"Line {number}: more rows than a table {size} a side has ({size**3})")
            rows.append(tuple(_numbers(line, 3, number, "expected three numbers")))  # type: ignore[arg-type]
    if size is None:
        raise BadCube(f"Line {max(last, 1)}: no LUT_3D_SIZE: only 3D tables can be imported")
    if len(rows) != size**3:
        raise BadCube(f"Line {last}: the file ends after {len(rows)} rows; a table {size} a side has {size**3}")
    for channel in range(3):
        if not domain_max[channel] > domain_min[channel]:
            raise BadCube(f"The domain of {'RGB'[channel]} is empty: DOMAIN_MAX must be above DOMAIN_MIN")
    # The file's red changes fastest, then green, then blue.
    table = np.array(rows, dtype=np.float64).reshape(size, size, size, 3)
    if domain_min != [0.0] * 3 or domain_max != [1.0] * 3:
        table = _resampled(table, domain_min, domain_max)
    return title, np.clip(table, 0.0, 1.0)


def _numbers(text: str, count: int, line: int, problem: str) -> list[float]:
    words = text.split()
    try:
        values = [float(word) for word in words]
    except ValueError:
        values = []
    if len(values) != count or not all(math.isfinite(value) for value in values):
        raise BadCube(f"Line {line}: {problem}")
    return values


def _is_number(word: str) -> bool:
    try:
        float(word)
    except ValueError:
        return False
    return True


def _resampled(table: np.ndarray, low: list[float], high: list[float]) -> np.ndarray:
    """`table`, whose inputs span `low`..`high` per channel, sampled again (trilinearly, as lut3d
    reads it) at inputs on 0..1, those outside its domain held at its edge."""
    size = table.shape[0]
    grid = np.linspace(0.0, 1.0, size)
    # Axes 2, 1 and 0 are red, green and blue.
    for axis, channel in ((2, 0), (1, 1), (0, 2)):
        at = np.clip((grid - low[channel]) / (high[channel] - low[channel]), 0.0, 1.0) * (size - 1)
        below = np.minimum(np.floor(at).astype(int), size - 2)
        weight = (at - below).reshape([-1 if a == axis else 1 for a in range(3)] + [1])
        table = np.take(table, below, axis=axis) * (1 - weight) + np.take(table, below + 1, axis=axis) * weight
    return table


def _identity(size: int) -> np.ndarray:
    grid = np.linspace(0.0, 1.0, size)
    blue, green, red = np.meshgrid(grid, grid, grid, indexing="ij")
    return np.stack([red, green, blue], axis=-1)


def cube_text(table: np.ndarray, title: str | None = None) -> bytes:
    """The `.cube` file of `table` ([b][g][r][channel], on 0..1), as ffmpeg's lut3d reads it."""
    size = table.shape[0]
    head = ([f"TITLE {json.dumps(title)}"] if title else []) + [f"LUT_3D_SIZE {size}"]
    rows = (" ".join(f"{value:.6f}" for value in row) for row in np.clip(table, 0.0, 1.0).reshape(-1, 3))
    return ("\n".join([*head, *rows]) + "\n").encode()


def fit_table(table: np.ndarray, rounds: int = 12) -> Fit:
    """A table per channel then a 3×3 matrix that draw nearly what the 3D `table` does, by least
    squares over its texels: the matrix fitted to the tables' outputs, then each channel's table to
    what the matrix needs of it, by turns, the best kept. An identity table fits as the identity."""
    size = table.shape[0]
    inputs = _identity(size).reshape(-1, 3)
    outputs = table.reshape(-1, 3)
    # Which level of its own channel each texel is at.
    levels = np.rint(inputs * (size - 1)).astype(int)
    # First the tables as they are (the identity), the matrix fitted to them.
    curves = np.tile(np.linspace(0.0, 1.0, size), (3, 1))
    matrix = np.linalg.lstsq(inputs, outputs, rcond=None)[0].T
    best = (float(np.mean((inputs @ matrix.T - outputs) ** 2)), curves, matrix)
    for _ in range(rounds):
        wanted = outputs @ np.linalg.pinv(matrix).T
        curves = np.stack([np.bincount(levels[:, c], wanted[:, c], size) / np.bincount(levels[:, c], None, size) for c in range(3)])
        curves = np.clip(curves, 0.0, 1.0)
        toned = np.stack([curves[c][levels[:, c]] for c in range(3)], axis=1)
        matrix = np.linalg.lstsq(toned, outputs, rcond=None)[0].T
        error = float(np.mean((toned @ matrix.T - outputs) ** 2))
        if error < best[0] - 1e-12:
            best = (error, curves, matrix)
    _, curves, matrix = best
    grid = np.linspace(0.0, 1.0, size)
    entries = np.linspace(0.0, 1.0, FIT_SIZE)
    tables = tuple(tuple(round(float(v), 6) + 0.0 for v in np.interp(entries, grid, curve)) for curve in curves)
    rows = tuple(tuple(round(float(v), 6) + 0.0 for v in row) for row in matrix)
    return Fit(tables, rows)  # type: ignore[arg-type]


def _unique_name(name: str, taken: set[str]) -> str:
    """`name` (cut to NAME_LENGTH), or with " (2)", " (3)"… when it is taken."""
    first = name[:NAME_LENGTH].strip()
    if first not in taken:
        return first
    for number in range(2, 10_000):
        suffix = f" ({number})"
        candidate = f"{name[: NAME_LENGTH - len(suffix)].strip()}{suffix}"
        if candidate not in taken:
            return candidate
    return first
