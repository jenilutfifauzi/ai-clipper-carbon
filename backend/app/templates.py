"""Templates (GLOSSARY.md: Template, Main Slot, Anchor, Template item;
docs/adr/0023-templates-are-marked-copies-anchored-by-their-edges.md): a Candidate's Advanced Edit
saved for reuse, and copied onto other Candidates of any length.

`capture` and `apply` are pure. `capture` takes a Candidate (its draft edits applied) and gives the
Template's layers, each with its Anchor; `apply` takes a Template and a Candidate and gives the
Candidate's new edits, each layer placed by its Anchor and marked as a Template item.

The owner's Templates are kept in DATA_DIR/templates.json, written atomically under a lock, as the Text
Presets are. There are no built-in ones.
"""

import math
import threading
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any, NamedTuple
from uuid import uuid4

from pydantic import Field, FiniteFloat, TypeAdapter

from app.candidates import AdjustmentLayer, Candidate, ItemId, MusicClip, Overlay, Shape, TemplateId, TextLayer
from app.jobs import DEFAULT_TEMPLATE
from app.keyframes import rewindow
from app.review import CandidateChange, Episode, update
from app.segment_time import overlay_time
from app.storage import write_atomic
from app.styles import Name

# In DATA_DIR.
TEMPLATES_FILE = "templates.json"
# The editor's least item length (ITEM_MIN_SECS in frontend/src/pages/job/advanced/edits.ts): a layer
# cut shorter to fit a Clip is left out, as the Clipboard leaves one out.
ITEM_MIN_SECS = 0.1


class TemplateNotFound(LookupError):
    pass


class InvalidTemplate(ValueError):
    """A Template that can't be saved from a Candidate as asked."""


class Boundary(StrEnum):
    """What an edge of a Template's layer hangs from (GLOSSARY.md, Anchor)."""

    CLIP_START = "clip_start"
    MAIN_START = "main_start"
    MAIN_END = "main_end"
    CLIP_END = "clip_end"


START_SIDE = (Boundary.CLIP_START, Boundary.MAIN_START)
END_SIDE = (Boundary.MAIN_END, Boundary.CLIP_END)
# Of two boundaries at one time (the Main Slot's start is the Clip's when there is no intro), the
# Main Slot's: an edge then follows the Candidate's own cut.
_PREFERRED = (Boundary.MAIN_START, Boundary.MAIN_END, Boundary.CLIP_START, Boundary.CLIP_END)


class AnchorKind(StrEnum):
    """The names the editor and the agent give an Anchor: Start (both edges from one start-side
    boundary), End (both from one end-side boundary) and Span (one edge from each side)."""

    START = "start"
    END = "end"
    SPAN = "span"


@dataclass(frozen=True)
class Edge:
    """Where one edge of a layer is: `offset` seconds from its `boundary` (negative before it)."""

    boundary: Boundary
    offset: Annotated[FiniteFloat, Field(ge=-3600, le=3600)]


@dataclass(frozen=True)
class Anchor:
    """How a Template's layer keeps its place on a Candidate of another length: by each of its edges."""

    start: Edge
    end: Edge

    def __post_init__(self) -> None:
        if self.start.boundary in END_SIDE and self.end.boundary in START_SIDE:
            raise ValueError("An Anchor's start edge can't hang from an end-side boundary and its end edge from a start-side one")

    @property
    def kind(self) -> AnchorKind:
        if self.end.boundary in START_SIDE:
            return AnchorKind.START
        return AnchorKind.END if self.start.boundary in END_SIDE else AnchorKind.SPAN


class Boundaries(NamedTuple):
    """Where a Candidate's boundaries are on its Timeline, in seconds."""

    clip_start: float
    main_start: float
    main_end: float
    clip_end: float

    def at(self, boundary: Boundary) -> float:
        return getattr(self, boundary.value)


def boundaries(candidate: Candidate) -> Boundaries:
    """The Candidate's boundaries: with no intro nor outro, its Main Slot is its whole Clip."""
    length = candidate.duration
    return Boundaries(0.0, 0.0, length, length)


class LayerKind(StrEnum):
    """A kind of a Template's layers, by the list a Candidate holds them in."""

    TEXT_LAYERS = "text_layers"
    SHAPES = "shapes"
    MUSIC = "music"
    OVERLAYS = "overlays"
    ADJUSTMENT_LAYERS = "adjustment_layers"

    @property
    def named(self) -> str:
        return _NAMES[self]


_NAMES = {
    LayerKind.TEXT_LAYERS: "Text Layer",
    LayerKind.SHAPES: "Shape",
    LayerKind.MUSIC: "Music Clip",
    LayerKind.OVERLAYS: "Overlay",
    LayerKind.ADJUSTMENT_LAYERS: "Adjustment Layer",
}

type Layer = TextLayer | Shape | MusicClip | Overlay | AdjustmentLayer


@dataclass(frozen=True)
class Anchored[T]:
    """A Template's layer: the item as it was on the Candidate it was saved from, and its Anchor."""

    item: T
    anchor: Anchor


@dataclass(frozen=True)
class TemplateLayers:
    """A Template's Text Layers, Shapes, Music Clips (of Media Library items only), Overlays and
    Adjustment Layers, each in the order the Candidate drew them."""

    text_layers: list[Anchored[TextLayer]] = field(default_factory=list)
    shapes: list[Anchored[Shape]] = field(default_factory=list)
    music: list[Anchored[MusicClip]] = field(default_factory=list)
    overlays: list[Anchored[Overlay]] = field(default_factory=list)
    adjustment_layers: list[Anchored[AdjustmentLayer]] = field(default_factory=list)

    def items(self) -> Iterator[tuple[LayerKind, Anchored[Any]]]:
        for kind in LayerKind:
            for layer in getattr(self, kind.value):
                yield kind, layer


@dataclass(frozen=True)
class Template:
    """A named, global Advanced Edit saved for reuse (GLOSSARY.md, Template)."""

    id: TemplateId
    name: Name
    created_at: datetime
    updated_at: datetime
    layers: TemplateLayers = field(default_factory=TemplateLayers)


@dataclass(frozen=True)
class AnchorOverride:
    """An Anchor the owner chose for one of the Candidate's layers, in place of the guess."""

    kind: LayerKind
    id: ItemId
    anchor: AnchorKind


@dataclass(frozen=True)
class Captured:
    """A Template's layers as `capture` makes them, and what the owner is told."""

    layers: TemplateLayers
    notices: list[str]


@dataclass(frozen=True)
class Applied:
    """A Candidate's edits as `apply` makes them, and what the owner is told."""

    change: CandidateChange
    notices: list[str]


def capture(candidate: Candidate, overrides: Sequence[AnchorOverride] = ()) -> Captured:
    """The layers of a Template saved from `candidate`, each edge hanging from its nearest boundary
    but where `overrides` chooses its Anchor. Music Clips of the Source's sound are left out: another
    Job's Clips can't play it. InvalidTemplate for an override of a layer the Candidate hasn't."""
    bounds = boundaries(candidate)
    chosen = {(override.kind, override.id): override.anchor for override in overrides}
    for kind, item_id in chosen.keys() - {(kind, item.id) for kind, item in _layers_of(candidate)}:
        raise InvalidTemplate(f"The clip has no {kind.named} {item_id} to anchor")
    layers: dict[LayerKind, list[Anchored[Any]]] = {kind: [] for kind in LayerKind}
    unheard = 0
    for kind, item in _layers_of(candidate):
        if isinstance(item, MusicClip):
            if item.media is None:
                unheard += 1
                continue
            # The Segment it was Detached from is the Candidate's own.
            item = replace(item, detached_from=None)
        # A Template's own layers are never Template items: they are marked when applied.
        item = replace(item, template=None)
        anchor = anchored(item.start, item.start + item.secs, bounds, chosen.get((kind, item.id)))
        layers[kind].append(Anchored(item, anchor))
    notices = []
    if unheard:
        notices.append(f"{_count(unheard, 'Music Clip')} of the episode's sound left out: a Template plays only Media Library items.")
    return Captured(TemplateLayers(**{kind.value: listed for kind, listed in layers.items()}), notices)


def anchored(start: float, end: float, bounds: Boundaries, kind: AnchorKind | None = None) -> Anchor:
    """The Anchor of a layer from `start` to `end`: as `kind` names it, or each edge from its nearest
    boundary."""
    if kind is AnchorKind.START:
        boundary = _nearest(start, bounds, START_SIDE)
        return Anchor(_edge(start, bounds, boundary), _edge(end, bounds, boundary))
    if kind is AnchorKind.END:
        boundary = _nearest(end, bounds, END_SIDE)
        return Anchor(_edge(start, bounds, boundary), _edge(end, bounds, boundary))
    if kind is AnchorKind.SPAN:
        return Anchor(_edge(start, bounds, _nearest(start, bounds, START_SIDE)), _edge(end, bounds, _nearest(end, bounds, END_SIDE)))
    return Anchor(_edge(start, bounds, _nearest(start, bounds, _PREFERRED)), _edge(end, bounds, _nearest(end, bounds, _PREFERRED)))


def apply(template: Template | None, candidate: Candidate, named: Mapping[str, Template] | None = None) -> Applied:
    """The Candidate's layers once `template` is applied, or with None ("No Template") its Template
    items taken off alone: its Template items (of any Template) taken off, its own kept, and each of
    the Template's layers placed by its Anchor on the Candidate's boundaries and marked. A layer
    reaching past the Clip is cut short at its edge, or left out when shorter than ITEM_MIN_SECS
    there. `named` holds the Templates the Candidate's marks may name, by id: an item taken off that
    differs from a fresh application of its Template was changed by hand, and is counted; so is every
    item of a Template not there (deleted)."""
    kept: dict[LayerKind, list[Any]] = {
        kind: [item for item in getattr(candidate, kind.value) if item.template is None] for kind in LayerKind
    }
    notices = _replaced(candidate, named or {}, "removed" if template is None else "replaced")
    if template is None:
        return Applied(CandidateChange(**{kind.value: listed for kind, listed in kept.items()}), notices)
    placed = _placed(template, candidate, kept)
    told = [placed.trimmed and f"{_count(placed.trimmed, 'layer')} cut short to fit", placed.left_out and f"{placed.left_out} left out, falling outside the clip"]
    if placed.trimmed or placed.left_out:
        notices.append(f"{'; '.join(part for part in told if part)}.")
    return Applied(CandidateChange(**{kind.value: listed for kind, listed in placed.layers.items()}), notices)


class _Placed(NamedTuple):
    """A Template's layers placed on a Candidate beside the layers it keeps, and how many were cut
    short or left out."""

    layers: dict[LayerKind, list[Any]]
    trimmed: int
    left_out: int


def _placed(template: Template, candidate: Candidate, kept: Mapping[LayerKind, list[Any]]) -> _Placed:
    bounds = boundaries(candidate)
    layers = {kind: list(listed) for kind, listed in kept.items()}
    trimmed = left_out = 0
    for kind, layer in template.layers.items():
        start = bounds.at(layer.anchor.start.boundary) + layer.anchor.start.offset
        end = bounds.at(layer.anchor.end.boundary) + layer.anchor.end.offset
        fitted = _fitted(layer.item, start, end, bounds.clip_end)
        if fitted is None:
            left_out += 1
            continue
        item, cut = fitted
        trimmed += cut
        item_id = _free_id(item.id, {other.id for other in layers[kind]})
        layers[kind].append(replace(item, id=item_id, template=template.id))
    return _Placed(layers, trimmed, left_out)


def _replaced(candidate: Candidate, named: Mapping[str, Template], done: str) -> list[str]:
    """What the owner is told of the Candidate's Template items being taken off (`done`): those
    changed by hand since their Template put them there, as told by a fresh application of it (their
    ids aside, which depend on the hand-made items beside them), and those of a deleted Template."""
    changed = gone = 0
    for template_id in dict.fromkeys(item.template for _, item in _layers_of(candidate) if item.template is not None):
        marked = [(kind, item) for kind, item in _layers_of(candidate) if item.template == template_id]
        if template_id not in named:
            gone += len(marked)
            continue
        fresh = _placed(named[template_id], candidate, {kind: [] for kind in LayerKind}).layers
        for kind, item in marked:
            same = next((i for i, put in enumerate(fresh[kind]) if replace(put, id=item.id) == item), None)
            if same is None:
                changed += 1
            else:
                del fresh[kind][same]
    notices = []
    if changed:
        notices.append(f"{_count(changed, 'Template item')} changed by hand {done}.")
    if gone:
        notices.append(f"{_count(gone, 'Template item')} of a deleted Template {done}.")
    return notices


def _layers_of(candidate: Candidate) -> Iterator[tuple[LayerKind, Layer]]:
    for kind in LayerKind:
        for item in getattr(candidate, kind.value):
            yield kind, item


def _nearest(at: float, bounds: Boundaries, among: Sequence[Boundary]) -> Boundary:
    """The boundary of `among` nearest `at`; of two as near, the first of _PREFERRED."""
    return min(sorted(among, key=_PREFERRED.index), key=lambda boundary: abs(at - bounds.at(boundary)))


def _edge(at: float, bounds: Boundaries, boundary: Boundary) -> Edge:
    return Edge(boundary, round(at - bounds.at(boundary), 6))


def _fitted[T: Layer](item: T, start: float, end: float, length: float) -> tuple[T, bool] | None:
    """`item` placed from `start` to `end`, cut at the Clip's edges (0 and `length`), and whether it
    was; None when what is left is shorter than ITEM_MIN_SECS. Its Keyframes and a song's or video's
    read follow the cut, as the Clipboard's paste does; an Adjustment Layer's fades stay within half
    of it."""
    shown_start, shown_end = max(start, 0.0), min(end, length)
    secs = round(shown_end - shown_start, 6)
    if secs < ITEM_MIN_SECS - 1e-9:
        return None
    # The part of it kept, in seconds from where it was placed.
    kept_from, kept_to = shown_start - start, shown_end - start
    cut = kept_from > 1e-9 or end - shown_end > 1e-9
    fields: dict[str, Any] = {"start": round(shown_start, 6), "secs": secs}
    if getattr(item, "keys", None) and (kept_from > 1e-9 or kept_to < item.secs - 1e-9):
        fields["keys"] = {prop: rewindow(keys, kept_from, kept_to) for prop, keys in item.keys.items()}
    if isinstance(item, MusicClip | Overlay) and cut:
        played = overlay_time(item.offset, end - start, item.speed, item.reverse)
        fields["offset"] = round(max(0.0, min(played.source_at(kept_from), played.source_at(kept_to))), 6)
    if isinstance(item, AdjustmentLayer):
        half = math.floor(secs / 2 * 100) / 100
        fields |= {"fade_in": min(item.fade_in, half), "fade_out": min(item.fade_out, half)}
    return replace(item, **fields), cut


def _free_id(wanted: str, taken: set[str]) -> str:
    """`wanted`, or when another item of its kind has it, the first of wanted-2, wanted-3… free."""
    if wanted not in taken:
        return wanted
    return next(new for n in range(2, len(taken) + 3) if (new := f"{wanted[:28]}-{n}") not in taken)


def _count(n: int, one: str) -> str:
    return f"{n} {one}{'' if n == 1 else 's'}"


def branded(template: Template, new: list[Candidate], episode: Episode) -> list[Candidate]:
    """New Candidates (not saved yet) with `template` applied: still at their first Revision and not
    edited, as Selection or the owner's Add made them."""
    made = []
    for candidate in new:
        _, applied = update([candidate], candidate.id, apply(template, candidate).change, episode)
        made.append(replace(applied, revision=candidate.revision, edited=candidate.edited))
    return made


def gone(template_id: str) -> str:
    """What a Job is told when its Template was deleted before its Candidates were made."""
    return f"Template {template_id} was deleted: new Candidates are made without it."


@dataclass(frozen=True)
class _Saved:
    """What DATA_DIR/templates.json holds."""

    templates: list[Template] = field(default_factory=list)
    # The default Template's id: new Jobs' Candidates get it, unless they choose another or none.
    default: TemplateId | None = None


_SAVED = TypeAdapter(_Saved)


class TemplateStore:
    """The owner's Templates, in `path`, in the order they were made."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def all(self) -> list[Template]:
        return self._saved().templates

    def get(self, template_id: str) -> Template:
        for template in self.all():
            if template.id == template_id:
                return template
        raise TemplateNotFound(template_id)

    def default(self) -> str | None:
        """The default Template's id, or None when there is none."""
        return self._saved().default

    def use_as_default(self, template_id: str | None) -> None:
        """Make one of the Templates the default, or with None, have none. TemplateNotFound for an
        unknown one."""
        with self._lock:
            saved = self._saved()
            if template_id is not None:
                self._index(saved, template_id)
            self._save(replace(saved, default=template_id))

    def for_new_job(self, choice: str | None) -> str | None:
        """A new Job's Template as chosen (DEFAULT_TEMPLATE, an id or None) resolved to an id or None.
        TemplateNotFound for an unknown id."""
        if choice == DEFAULT_TEMPLATE:
            return self.default()
        return None if choice is None else self.get(choice).id

    def for_new_candidates(self, template_id: str | None) -> tuple[Template | None, list[str]]:
        """The Template a Job's new Candidates get, by its id (or None), and what the Job is told:
        `gone` when it was deleted since, and then they get none."""
        if template_id is None:
            return None, []
        try:
            return self.get(template_id), []
        except TemplateNotFound:
            return None, [gone(template_id)]

    def create(self, name: str, layers: TemplateLayers) -> Template:
        now = datetime.now(UTC)
        with self._lock:
            saved = self._saved()
            template = Template(uuid4().hex[:8], name, now, now, layers)
            self._save(replace(saved, templates=[*saved.templates, template]))
        return template

    def save_over(self, template_id: str, name: str, layers: TemplateLayers) -> Template:
        """One of the Templates replaced by another of the same id. Candidates it was applied to keep
        their copies."""
        return self._change(template_id, lambda template: replace(template, name=name, layers=layers))

    def rename(self, template_id: str, name: str) -> Template:
        return self._change(template_id, lambda template: replace(template, name=name))

    def delete(self, template_id: str) -> None:
        """Delete one of the Templates, which then is no longer the default. Candidates keep their
        Template items, whose mark then names a missing Template."""
        with self._lock:
            saved = self._saved()
            i = self._index(saved, template_id)
            default = None if saved.default == template_id else saved.default
            self._save(replace(saved, templates=[*saved.templates[:i], *saved.templates[i + 1 :]], default=default))

    def _change(self, template_id: str, change: Callable[[Template], Template]) -> Template:
        with self._lock:
            saved = self._saved()
            i = self._index(saved, template_id)
            template = replace(change(saved.templates[i]), updated_at=datetime.now(UTC))
            self._save(replace(saved, templates=[*saved.templates[:i], template, *saved.templates[i + 1 :]]))
        return template

    def _index(self, saved: _Saved, template_id: str) -> int:
        for i, template in enumerate(saved.templates):
            if template.id == template_id:
                return i
        raise TemplateNotFound(template_id)

    def _saved(self) -> _Saved:
        return _SAVED.validate_json(self.path.read_bytes()) if self.path.is_file() else _Saved()

    def _save(self, saved: _Saved) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(self.path, _SAVED.dump_json(saved, indent=2))
