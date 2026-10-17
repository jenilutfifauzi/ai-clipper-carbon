"""Faces: the font files text can be set in (GLOSSARY: Face). The bundled ones come with the app, under
the SIL Open Font License or the Apache License (THIRD_PARTY_NOTICES.md), downloaded by `make setup`;
the owner imports others, kept for every Job in DATA_DIR/fonts. Each render gives libass the Faces it
needs through one `fontsdir` (`gather`), and the browser's preview loads each Face's file from
GET /api/fonts/{id}, so that both set the same glyphs.

One more bundled Face, FALLBACK_FACE (CJK), is never offered for a style to name: a Text Layer's
characters its own Face hasn't got are set in it (docs/adr/0010), so that libass's own fallback to
the system's fonts is never used.

Each Face is a static font of one weight and slant: libass sets only a variable font's default
instance. So an imported variable font is split into a Face per named instance (fontTools' instancer),
as a collection (TTC) is split into its members, each written out as its own file.

One registry serves the process (`registry`), opened on the data directory by the app and the CLI
(`use`): a style's Face id is checked against it wherever a style names one (app/styles.py's FontId).
It reads its index again when another process has changed it. Listeners given to `on_change` (the
planner's cache of measures) are called whenever its Faces change.
"""

import hashlib
import re
import threading
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, replace
from functools import cache
from io import BytesIO
from pathlib import Path

from pydantic import TypeAdapter

from app.config import FONTS_DIR
from app.library import Index
from app.listeners import Listeners
from app.storage import write_atomic

# In DATA_DIR, with its index.
IMPORTED_DIR = "fonts"
INDEX_FILE = "fonts.json"
# The largest file taken: a CJK collection is tens of megabytes.
MAX_UPLOAD_BYTES = 64 * 2**20
DEFAULT_FONT = "montserrat-extrabold"
# OS/2 fsType: the low four bits say how a font may be embedded; Restricted License embedding when
# only bit 1 of them is set.
_EMBEDDING_BITS, _RESTRICTED = 0x000F, 0x0002
# The styles a family's four linked Faces have (name ID 2); any other is a family of its own in name ID 1.
_RIBBI = ("Regular", "Italic", "Bold", "Bold Italic")


@dataclass(frozen=True)
class Face:
    id: str
    # What the UI calls it.
    label: str
    # The name libass matches a style's Fontname against: a bundled Face's family (name ID 1). An
    # imported one's full name (name ID 4), or its PostScript name (6) when its outlines are CFF, which
    # libass matches as Windows does: so it picks this Face, never another of its family.
    family: str
    # The family it belongs to, as the picker groups Faces (name ID 16, else 1).
    typographic_family: str
    # OS/2 usWeightClass: 400 regular, 700 bold.
    weight: int
    italic: bool
    bundled: bool
    file: Path
    # Name IDs 0, 13 and 14; "" when the font has none.
    copyright: str
    licence: str
    licence_url: str
    # Whether OS/2 fsType says it may not be embedded (Restricted License): imported all the same.
    restricted: bool
    # Of its file as fontTools writes it (for a bundled one, would write it): a Face is imported once,
    # and its URL changes with it.
    sha256: str
    # Of the file an imported Face came from (for a collection's or a variable font's, the whole file);
    # None for a bundled one.
    source: str | None = None


@dataclass(frozen=True)
class FontImport:
    """What an import added, the Faces it holds that were there already, and its warnings."""

    faces: list[Face]
    existing: list[Face]
    warnings: list[str]


class BadFont(ValueError):
    """The upload isn't a font that can be imported."""


class FaceNotFound(LookupError):
    pass


class BundledFace(ValueError):
    """A bundled Face can't be deleted."""


class MissingFace(RuntimeError):
    """A Face's file is gone from disk."""


# The bundled Faces, by family: their ids, which styles store forever, and their files in FONTS_DIR
# (scripts/download_assets.py). A family's only Face has the family's id.
_BUNDLED = [
    ("montserrat-regular", "Montserrat-Regular.ttf"),
    ("montserrat-italic", "Montserrat-Italic.ttf"),
    ("montserrat-semibold", "Montserrat-SemiBold.ttf"),
    ("montserrat-bold", "Montserrat-Bold.ttf"),
    ("montserrat-bold-italic", "Montserrat-BoldItalic.ttf"),
    ("montserrat-extrabold", "Montserrat-ExtraBold.ttf"),
    ("montserrat-extrabold-italic", "Montserrat-ExtraBoldItalic.ttf"),
    ("montserrat-black", "Montserrat-Black.ttf"),
    ("montserrat-black-italic", "Montserrat-BlackItalic.ttf"),
    ("anton", "Anton-Regular.ttf"),
    ("bebas-neue", "BebasNeue-Regular.ttf"),
    ("poppins-regular", "Poppins-Regular.ttf"),
    ("poppins-italic", "Poppins-Italic.ttf"),
    ("poppins-medium", "Poppins-Medium.ttf"),
    ("poppins-semibold", "Poppins-SemiBold.ttf"),
    ("poppins-bold", "Poppins-Bold.ttf"),
    ("poppins-bold-italic", "Poppins-BoldItalic.ttf"),
    ("poppins-extrabold", "Poppins-ExtraBold.ttf"),
    ("poppins-black", "Poppins-Black.ttf"),
    ("poppins-black-italic", "Poppins-BlackItalic.ttf"),
    ("archivo-black", "ArchivoBlack-Regular.ttf"),
    ("bangers", "Bangers-Regular.ttf"),
    ("barlow-condensed-regular", "BarlowCondensed-Regular.ttf"),
    ("barlow-condensed-semibold", "BarlowCondensed-SemiBold.ttf"),
    ("barlow-condensed-bold", "BarlowCondensed-Bold.ttf"),
    ("barlow-condensed-bold-italic", "BarlowCondensed-BoldItalic.ttf"),
    ("barlow-condensed-extrabold", "BarlowCondensed-ExtraBold.ttf"),
    ("barlow-condensed-black", "BarlowCondensed-Black.ttf"),
    ("barlow-condensed-black-italic", "BarlowCondensed-BlackItalic.ttf"),
    ("kanit-regular", "Kanit-Regular.ttf"),
    ("kanit-medium", "Kanit-Medium.ttf"),
    ("kanit-bold", "Kanit-Bold.ttf"),
    ("kanit-extrabold", "Kanit-ExtraBold.ttf"),
    ("kanit-black", "Kanit-Black.ttf"),
    ("kanit-black-italic", "Kanit-BlackItalic.ttf"),
    ("oswald-regular", "Oswald-Regular.ttf"),
    ("oswald-medium", "Oswald-Medium.ttf"),
    ("oswald-semibold", "Oswald-SemiBold.ttf"),
    ("oswald-bold", "Oswald-Bold.ttf"),
    ("passion-one-regular", "PassionOne-Regular.ttf"),
    ("passion-one-bold", "PassionOne-Bold.ttf"),
    ("passion-one-black", "PassionOne-Black.ttf"),
    ("dm-serif-display-regular", "DMSerifDisplay-Regular.ttf"),
    ("dm-serif-display-italic", "DMSerifDisplay-Italic.ttf"),
    ("abril-fatface", "AbrilFatface-Regular.ttf"),
    ("lobster", "Lobster-Regular.ttf"),
    ("pacifico", "Pacifico-Regular.ttf"),
    ("titan-one", "TitanOne-Regular.ttf"),
    ("caveat-brush", "CaveatBrush-Regular.ttf"),
    ("staatliches", "Staatliches-Regular.ttf"),
    ("permanent-marker", "PermanentMarker-Regular.ttf"),
    ("luckiest-guy", "LuckiestGuy-Regular.ttf"),
]
BUNDLED_IDS = [face_id for face_id, _ in _BUNDLED]
# The bundled Face a Text Layer's characters its Face hasn't got are set in: Chinese, and Japanese
# kana and kanji. Not one a style names, nor listed.
FALLBACK_FACE = "noto-sans-sc-bold"
_FALLBACK = (FALLBACK_FACE, "NotoSansSC-Bold.otf")
_FACES = TypeAdapter(list[Face])


class Faces:
    """The bundled Faces, then those imported into `folder` in the order they were imported: <id>.ttf
    or <id>.otf each, and their index. Without a folder, the bundled ones only."""

    def __init__(self, folder: Path | None = None) -> None:
        self.folder = folder
        self._index = None if folder is None else Index(folder / INDEX_FILE, _FACES)
        self._lock = threading.Lock()
        self._listeners = Listeners()
        # The imported Faces as last read, and the index's state they were read at.
        self._read: tuple[tuple[int, int] | None, list[Face]] = (None, [])

    def ids(self) -> list[str]:
        return [*BUNDLED_IDS, *(face.id for face in self._imported())]

    def all(self) -> list[Face]:
        return [*(_bundled(face_id) for face_id in BUNDLED_IDS), *self._imported()]

    def find(self, face_id: str) -> Face | None:
        """The Face `face_id`, FALLBACK_FACE's too, or None."""
        if face_id in BUNDLED_IDS or face_id == FALLBACK_FACE:
            return _bundled(face_id)
        return next((face for face in self._imported() if face.id == face_id), None)

    def get(self, face_id: str) -> Face:
        face = self.find(face_id)
        if face is None:
            raise FaceNotFound(face_id)
        return face

    def file(self, face_id: str) -> Path:
        """The Face's file; MissingFace when it is gone from disk."""
        face = self.get(face_id)
        if not face.file.is_file():
            again = "run make setup" if face.bundled else "import it again"
            raise MissingFace(f"The font file of {face.label} ({face.id}) is missing: {again}")
        return face.file

    def add(self, data: bytes, filename: str) -> FontImport:
        """Import the font `data`, uploaded as `filename`: a TTF or OTF gives one Face, a collection
        one per member and a variable font one per named instance (or its default, when it names
        none). A Face already in the registry isn't added again. BadFont when it is too large or
        fontTools can't read it."""
        if self.folder is None or self._index is None:
            raise BadFont("Fonts can't be imported here")
        if len(data) > MAX_UPLOAD_BYTES:
            raise BadFont(f"A font can be {MAX_UPLOAD_BYTES // 2**20} MB at most")
        source = _sha256(data)
        with self._lock:
            faces = self.all()
            known = {face.sha256: face for face in faces} | {face.source: face for face in faces if face.source}
            if source in known:
                return FontImport([], [face for face in faces if source in (face.sha256, face.source)], [])
            ids = {face.id for face in faces}
            added: list[tuple[Face, bytes]] = []
            existing = []
            for static in statics(data):
                digest = _sha256(static)
                if digest in known:
                    existing.append(known[digest])
                    continue
                font = _open(static)
                face_id = _unique(_slug(_name(font, 6) or _name(font, 4) or Path(filename).stem), ids)
                ids.add(face_id)
                file = self.folder / f"{face_id}{'.otf' if 'CFF ' in font or 'CFF2' in font else '.ttf'}"
                face = replace(_describe(font, face_id, file, bundled=False), sha256=digest, source=source)
                added.append((face, static))
                known[digest] = face
            self.folder.mkdir(parents=True, exist_ok=True)
            try:
                for face, static in added:
                    write_atomic(face.file, static)
                self._index.add(*(replace(face, file=Path(face.file.name)) for face, _ in added))
            except BaseException:
                for face, _ in added:
                    face.file.unlink(missing_ok=True)
                raise
        if added:
            self._changed()
        warnings = [
            f"{face.label}: its licence says it may not be embedded (Restricted License). Check that you may use it in your videos."
            for face, _ in added if face.restricted
        ]
        return FontImport([face for face, _ in added], existing, warnings)

    def delete(self, face_id: str) -> None:
        """Remove an imported Face and its file. BundledFace for a bundled one. (Whether anything still
        names it is for the caller to check.)"""
        if face_id in BUNDLED_IDS or face_id == FALLBACK_FACE:
            raise BundledFace(face_id)
        with self._lock:
            face = self.get(face_id)
            if self._index is None or not self._index.remove(face_id):
                raise FaceNotFound(face_id)
            face.file.unlink(missing_ok=True)
        self._changed()

    def gather(self, face_ids: set[str], folder: Path) -> Path:
        """`folder`, made to hold the Faces `face_ids` (links to their files) and nothing else, for
        libass's `fontsdir`. MissingFace when one's file is gone from disk, or it isn't a Face."""
        folder.mkdir(parents=True, exist_ok=True)
        for old in folder.iterdir():
            old.unlink()
        for face_id in sorted(face_ids):
            try:
                file = self.file(face_id)
            except FaceNotFound:
                raise MissingFace(f"No font {face_id}: it has been deleted") from None
            (folder / f"{face_id}{file.suffix}").symlink_to(file.resolve())
        return folder

    def watch(self, listener: Callable[[], None]) -> AbstractContextManager[None]:
        """Call `listener` each time this process adds or removes Faces, until the block ends. It is
        called on the thread making the change, and must return quickly."""
        return self._listeners.watching(listener)

    def _imported(self) -> list[Face]:
        """The imported Faces, read again when the index has changed since they were last read."""
        if self._index is None or self.folder is None:
            return []
        try:
            stat = self._index.path.stat()
            state = (stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            state = None
        seen, faces = self._read
        if state != seen:
            folder = self.folder
            faces = [replace(face, file=folder / face.file.name) for face in self._index.all()]
            self._read = (state, faces)
            if seen is not None or faces:
                _changes.notify()
        return faces

    def _changed(self) -> None:
        _changes.notify()
        self._listeners.notify()


_registry = Faces()
_changes = Listeners()


def registry() -> Faces:
    """The Faces of this process."""
    return _registry


def use(folder: Path) -> Faces:
    """Make the registry the bundled Faces and those imported into `folder`, and return it."""
    global _registry
    _registry = Faces(folder)
    _changes.notify()
    return _registry


def on_change(listener: Callable[[], None]) -> None:
    """Call `listener` (which clears a cache) whenever the Faces change."""
    _changes.add(listener)


def font(face_id: str) -> Face:
    """The Face `face_id`; KeyError for one that isn't."""
    face = _registry.find(face_id)
    if face is None:
        raise KeyError(face_id)
    return face


def _bundled(face_id: str) -> Face:
    """A bundled Face, read from its file. Until `make setup` has downloaded its file, it is named after
    the file, isn't listed, and fails a render saying so."""
    filename = next(filename for id, filename in [*_BUNDLED, _FALLBACK] if id == face_id)
    file = FONTS_DIR / filename
    if not file.is_file():
        name = Path(filename).stem.replace("-", " ")
        return Face(
            id=face_id, label=name, family=name, typographic_family=name, weight=400, italic=False, bundled=True,
            file=file, copyright="", licence="", licence_url="", restricted=False, sha256="",
        )
    return _read_bundled(face_id, file)


@cache
def _read_bundled(face_id: str, file: Path) -> Face:
    data = file.read_bytes()
    font = _open(data)
    face = _describe(font, face_id, file, bundled=True)
    fallback = face_id == FALLBACK_FACE
    return replace(
        face,
        label=face.label.removesuffix(" Regular"),
        # A family's Regular (and the fallback, alone in its fonts directory) is matched by its family
        # (name ID 1), as the first bundled Faces always were; any other by its full name, which picks
        # exactly it, never another of its family.
        family=_name(font, 1) if fallback or _name(font, 2) == "Regular" else face.family,
        # Hashed as an import of its file would be, so that importing it adds nothing; the fallback's as
        # it is, since writing its tens of thousands of glyphs out again takes seconds.
        sha256=_sha256(data) if fallback else _sha256(_saved(font)),
    )


def statics(data: bytes) -> list[bytes]:
    """The static fonts `data` holds, as files: its collection's members, or itself; a variable font
    as one per named instance (its default, when it names none). Each is written by fontTools, so
    that one font gives the same file whether it came alone or in a collection. BadFont when
    fontTools can't read it."""
    from fontTools.ttLib import TTCollection

    if data[:4] == b"ttcf":
        try:
            count = len(TTCollection(BytesIO(data), lazy=True).fonts)
        except Exception:
            raise BadFont(_UNREADABLE) from None
        members = [_open(data, number) for number in range(count)]
    else:
        members = [_open(data)]
    statics = []
    for member in members:
        statics.extend(_instances(member) if "fvar" in member else [_saved(member)])
    return statics


def _instances(varfont) -> list[bytes]:
    """A variable font's named instances as static fonts, named as their own Faces; or its default."""
    from fontTools.varLib import instancer

    fvar = varfont["fvar"]
    if not fvar.instances:
        default = {axis.axisTag: axis.defaultValue for axis in fvar.axes}
        return [_saved(instancer.instantiateVariableFont(varfont, default, inplace=False))]
    family = _name(varfont, 16, 1)
    ps_family = _name(varfont, 25) or re.sub(r"[^A-Za-z0-9]", "", family)
    statics = []
    for instance in fvar.instances:
        style = varfont["name"].getDebugName(instance.subfamilyNameID) or "Regular"
        ps_name = (
            varfont["name"].getDebugName(instance.postscriptNameID) if instance.postscriptNameID not in (None, 0xFFFF) else None
        ) or f"{ps_family}-{re.sub(r'[^A-Za-z0-9]', '', style)}"
        static = instancer.instantiateVariableFont(varfont, dict(instance.coordinates), inplace=False)
        _rename(static, family, style, ps_name, instance.coordinates)
        statics.append(_saved(static))
    return statics


def _rename(font, family: str, style: str, ps_name: str, location: dict[str, float]) -> None:
    """Name a variable font's instance as a static Face of `family` in `style`, and set its style bits."""
    italic = "Italic" in style or location.get("ital", 0) >= 0.5 or location.get("slnt", 0) != 0
    bold = style in ("Bold", "Bold Italic")
    ribbi = style in _RIBBI
    names = {
        1: family if ribbi else f"{family} {style}",
        2: style if ribbi else ("Italic" if italic else "Regular"),
        3: ps_name,
        4: f"{family} {style}",
        6: ps_name,
        16: family,
        17: style,
    }
    table = font["name"]
    for name_id, value in names.items():
        table.removeNames(nameID=name_id)
        table.setName(value, name_id, 3, 1, 0x409)
    table.removeNames(nameID=25)
    os2 = font["OS/2"]
    os2.fsSelection = (os2.fsSelection & ~0x61) | (0x01 if italic else 0) | (0x20 if bold else 0) | (0x40 if not (italic or bold) else 0)
    font["head"].macStyle = (0x01 if bold else 0) | (0x02 if italic else 0)


def _describe(font, face_id: str, file: Path, bundled: bool) -> Face:
    os2, post = font["OS/2"], font["post"]
    cff = "CFF " in font or "CFF2" in font
    full_name = _name(font, 4) or f"{_name(font, 1)} {_name(font, 2)}".strip()
    return Face(
        id=face_id,
        label=full_name,
        family=_name(font, 6) if cff else full_name,
        typographic_family=_name(font, 16, 1),
        weight=os2.usWeightClass,
        italic=bool(os2.fsSelection & 0x01) or post.italicAngle != 0,
        bundled=bundled,
        file=file,
        copyright=_name(font, 0),
        licence=_name(font, 13),
        licence_url=_name(font, 14),
        restricted=os2.fsType & _EMBEDDING_BITS == _RESTRICTED,
        sha256="",
    )


_UNREADABLE = "That file isn't a font that can be read: import a TTF, OTF or TTC file"


def _open(data: bytes, number: int = -1):
    """The font in `data` (member `number` of a collection), with the tables a Face needs read: BadFont
    when fontTools can't read them."""
    from fontTools.ttLib import TTFont

    try:
        font = TTFont(BytesIO(data), fontNumber=number)
        for table in ("name", "OS/2", "head", "hmtx", "post"):
            font[table]
        if not font.getBestCmap():
            raise BadFont("That font maps no characters to its glyphs")
    except BadFont:
        raise
    except Exception:
        raise BadFont(_UNREADABLE) from None
    return font


def _saved(font) -> bytes:
    font.flavor = None
    out = BytesIO()
    # Modified when it was created, so that one font always gives the same file: saving a collection
    # stamps its members with the time.
    font.recalcTimestamp = False
    font["head"].modified = font["head"].created
    font.save(out)
    return out.getvalue()


def _name(font, *name_ids: int) -> str:
    """The first of `name_ids` the font names, or ""."""
    for name_id in name_ids:
        if value := (font["name"].getDebugName(name_id) or "").strip():
            return value
    return ""


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "font"


def _unique(face_id: str, taken: set[str]) -> str:
    if face_id not in taken:
        return face_id
    number = 2
    while f"{face_id}-{number}" in taken:
        number += 1
    return f"{face_id}-{number}"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

