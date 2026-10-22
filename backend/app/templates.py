"""Templates (GLOSSARY.md: Template, Main Slot, Anchor, Template item;
docs/adr/0023-templates-are-marked-copies-anchored-by-their-edges.md): a Candidate's Advanced Edit
saved for reuse, and copied onto other Candidates of any length.

`capture` and `apply` are pure. `capture` takes a Candidate (its draft edits applied) and gives the
Template's parts: its layers, each with its Anchor, its intro and outro (the media Segments around the
Candidate's own, the Main Slot) and its hook's place. `apply` takes a Template and a Candidate and
gives the Candidate's new edits: the intro and outro around its own Segments, each layer placed by its
Anchor, all marked as Template items, and its hand-made layers and hook moved with the Main Slot.

The owner's Templates are kept in DATA_DIR/templates.json, written atomically under a lock, as the Text
Presets are. There are no built-in ones.
"""

import math
import re
import threading
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field, fields, replace
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Any, NamedTuple
from uuid import uuid4

from pydantic import Field, FiniteFloat, StringConstraints, TypeAdapter, computed_field

from app.audio_effects import AUDIO_EFFECTS_MAX, AudioEffect
from app.candidates import (
    KEY_GAP_SECS,
    KICKER_MAX_CHARS,
    TEXT_LAYER_MAX_CHARS,
    AdjustmentLayer,
    Candidate,
    CueEdit,
    Framing,
    Grade,
    ItemId,
    Layout,
    MusicClip,
    Overlay,
    Segment,
    Shape,
    TemplateId,
    TextLayer,
    Transition,
    Volume,
    WordEdit,
    grades_of,
    timeline_length,
)
from app.jobs import DEFAULT_TEMPLATE
from app.keyframes import rewindow
from app.review import CandidateChange, Episode, update
from app.segment_time import overlay_time, segment_time, transition_overlap
from app.storage import write_atomic
from app.styles import DEFAULT_PRESET, Name, StyleOverrides
from app.video_effects import VIDEO_EFFECTS_MAX, VideoEffect

# In DATA_DIR.
TEMPLATES_FILE = "templates.json"
# The editor's least item length (ITEM_MIN_SECS in frontend/src/pages/job/advanced/edits.ts): a layer
# cut shorter to fit a Clip is left out, as the Clipboard leaves one out.
ITEM_MIN_SECS = 0.1
# The editor keeps times to the hundredth (`round` in edits.ts), a Clip's length to the ms: a layer it
# put under the whole Clip may end this much past it, which isn't cut.
_EDGE_REACH = 0.005
# How far past its song's or video's end a Music Clip's or Overlay's read may go (as app/api.py allows).
_READ_REACH = 0.05
# The hook's shortest and longest time (hook_secs in app/api.py).
HOOK_SECS = (0.5, 30.0)


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
    """The Candidate's boundaries, as a Template saved from it has them: its intro is the media
    Segments before its first Segment of the Source, its outro those after its last, and its Main
    Slot what is between; with no intro nor outro, its whole Clip. Measured on its Timeline, its
    Transitions' overlaps included. InvalidTemplate for one with no Segment of the Source."""
    track = candidate.main_track()
    sources = [i for i, segment in enumerate(track) if segment.media is None]
    if not sources:
        raise InvalidTemplate("A Template needs a Segment of the episode, whose place is its Main Slot: this clip shows only Media Library videos")
    return _bounds(track, candidate.transitions, sources[0], sources[-1] + 1)


def _bounds(track: Sequence[Segment], transitions: Sequence[Transition], first: int, end: int) -> Boundaries:
    """The boundaries of a Main Track whose Main Slot is `track[first:end]`: where its first
    Segment starts on the Timeline and its last ends, the Transitions' overlaps included."""
    played = _played(track, transitions)
    return Boundaries(0.0, played[first][0], played[end - 1][1], timeline_length(list(track), list(transitions)))


def _played(track: Sequence[Segment], transitions: Sequence[Transition]) -> list[tuple[float, float]]:
    """Where each Segment of a Main Track starts and ends on the Timeline: each after the one before,
    less the overlap of the Transition between them (as `timeline_length` counts them)."""
    by_join = {transition.after: transition.secs for transition in transitions}
    lengths = [segment_time(segment).length for segment in track]
    played, at = [], 0.0
    for i, (segment, length) in enumerate(zip(track, lengths)):
        played.append((round(at, 3), round(at + length, 3)))
        joined = by_join.get(segment.id)
        at += length - (transition_overlap(joined, length, lengths[i + 1]) if joined is not None and i + 1 < len(track) else 0.0)
    return played


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
class TemplatePart:
    """A Template's intro or outro: media Segments played in order, the Transitions at the joins
    between them, and `join`, the Transition at its join with the Main Slot (an intro's after its last
    Segment; an outro's after the Main Slot's last, whose id each Candidate gives), if any."""

    segments: list[Segment] = field(default_factory=list)
    transitions: list[Transition] = field(default_factory=list)
    join: Transition | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def secs(self) -> float:
        """How long it plays: its Segments, less the overlaps between them. (Its join with the Main
        Slot overlaps each Candidate by as much as that Candidate's Segment allows.)"""
        return timeline_length(self.segments, self.transitions) if self.segments else 0.0


@dataclass(frozen=True)
class Treatment:
    """The Main Slot's treatment (GLOSSARY.md, Main Slot): the first Source Segment's Grade, Video
    Effects and Audio Effects when the Template was saved, given to every Source Segment it is applied
    to."""

    grade: Grade = Grade()
    video_effects: Annotated[list[VideoEffect], Field(max_length=VIDEO_EFFECTS_MAX)] = field(default_factory=list)
    audio_effects: Annotated[list[AudioEffect], Field(max_length=AUDIO_EFFECTS_MAX)] = field(default_factory=list)


@dataclass(frozen=True)
class Template:
    """A named, global Advanced Edit saved for reuse (GLOSSARY.md, Template)."""

    id: TemplateId
    name: Name
    created_at: datetime
    updated_at: datetime
    layers: TemplateLayers = field(default_factory=TemplateLayers)
    intro: TemplatePart = field(default_factory=TemplatePart)
    outro: TemplatePart = field(default_factory=TemplatePart)
    # The Word Edits and Cue Edits of the intro's and outro's videos (their Media Words).
    word_edits: list[WordEdit] = field(default_factory=list)
    cue_edits: list[CueEdit] = field(default_factory=list)
    # Where the hook comes on, in seconds from the Main Slot's start (negative: before it), and how long it stays.
    hook_offset: Annotated[FiniteFloat, Field(ge=-3600, le=3600)] = 0.0
    hook_secs: Annotated[FiniteFloat, Field(ge=HOOK_SECS[0], le=HOOK_SECS[1])] = 3.0
    # Its style: a Style Preset (Default's, as on a Candidate, once that is deleted) and the fields of
    # it replaced; the Layout, and the Framing of a Manual one.
    preset_id: str = DEFAULT_PRESET
    style_overrides: StyleOverrides = field(default_factory=StyleOverrides)
    layout: Layout = Layout.AUTO
    framing: Framing | None = None
    # The Candidate's own Grade, over its whole Main Track, and its Clip volume.
    grade: Grade = Grade()
    source_volume: Volume = 1.0
    treatment: Treatment = Treatment()
    # The Kicker it gives each Candidate; "" for none, leaving theirs.
    kicker: Annotated[str, StringConstraints(max_length=KICKER_MAX_CHARS)] = ""

    # What it names in the libraries, as a Candidate's `media_ids`, `looks` and `faces` give them: the
    # Media Library, Imported Looks and Faces won't delete an item while a Template names it. (Its
    # Watermark's Logo isn't held: a Logo deleted later shows no Watermark, as a Preset's does.)

    def media_ids(self) -> set[str]:
        """The Media Library items it uses: its layers' and its intro's and outro's videos."""
        return (
            {layer.item.media for layer in self.layers.music if layer.item.media}
            | {layer.item.media for layer in self.layers.overlays}
            | {segment.media for segment in self.intro.segments + self.outro.segments if segment.media}
        )

    def grades(self) -> Iterator[tuple[str, Grade]]:
        """Each of its Grades, with the part it is: its own, its Main Slot treatment's, its intro's and
        outro's Segments' and its layers'."""
        yield "its grade", self.grade
        yield "its Main Slot treatment", self.treatment.grade
        overlays = [layer.item for layer in self.layers.overlays]
        segments = self.intro.segments + self.outro.segments
        yield from grades_of(None, segments, overlays, [layer.item for layer in self.layers.adjustment_layers])

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
        for layer in self.layers.text_layers:
            named.setdefault(layer.item.style.font, []).append(f"Text Layer {layer.item.id}")
        for section in ("caption", "hook", "watermark"):
            face = getattr(self.style_overrides, section).get("font")
            if isinstance(face, str):
                named.setdefault(face, []).append(f"{section} style")
        return named


# What a Template holds beyond its name and times: what `capture` gives.
_IDENTITY = ("id", "name", "created_at", "updated_at")


@dataclass(frozen=True)
class AnchorOverride:
    """An Anchor the owner chose for one of the Candidate's layers, in place of the guess."""

    kind: LayerKind
    id: ItemId
    anchor: AnchorKind


@dataclass(frozen=True)
class Captured:
    """A Template's parts as `capture` makes them (each a Template's field of its name), and what the
    owner is told."""

    layers: TemplateLayers
    notices: list[str]
    intro: TemplatePart = field(default_factory=TemplatePart)
    outro: TemplatePart = field(default_factory=TemplatePart)
    word_edits: list[WordEdit] = field(default_factory=list)
    cue_edits: list[CueEdit] = field(default_factory=list)
    hook_offset: float = 0.0
    hook_secs: float = 3.0
    preset_id: str = DEFAULT_PRESET
    style_overrides: StyleOverrides = field(default_factory=StyleOverrides)
    layout: Layout = Layout.AUTO
    framing: Framing | None = None
    grade: Grade = Grade()
    source_volume: float = 1.0
    treatment: Treatment = Treatment()
    kicker: str = ""

    def contents(self) -> dict[str, Any]:
        """The Template's fields it gives, by name."""
        return {f.name: getattr(self, f.name) for f in fields(Template) if f.name not in _IDENTITY}


@dataclass(frozen=True)
class Applied:
    """A Candidate's edits as `apply` makes them, and what the owner is told."""

    change: CandidateChange
    notices: list[str]


def capture(candidate: Candidate, overrides: Sequence[AnchorOverride] = ()) -> Captured:
    """The Template saved from `candidate`: its intro and outro (the media Segments before its first
    Segment of the Source and after its last, with the Transitions at their joins and the Word Edits
    and Cue Edits of their videos), its hook by its distance from the Main Slot's start, and its
    layers, each edge hanging from its nearest boundary but where `overrides` chooses its Anchor.
    Left out, with a notice: media Segments between Segments of the Source, and Music Clips of the
    Source's sound, which another Job's Clips can't play. InvalidTemplate for a Candidate with no
    Segment of the Source, or for an override of a layer the Candidate hasn't. Its style, Layout,
    Grade, Clip volume and Kicker are the Candidate's, and its Main Slot treatment its first Segment of
    the Source's. Template Fields in its Text Layers are kept as typed."""
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
    track = candidate.main_track()
    sources = [i for i, segment in enumerate(track) if segment.media is None]
    first, last = sources[0], sources[-1]
    by_join = {transition.after: replace(transition, template=None) for transition in candidate.transitions}
    intro, outro = [_unmarked(segment) for segment in track[:first]], [_unmarked(segment) for segment in track[last + 1 :]]
    shown = {segment.media for segment in [*intro, *outro]}
    notices = []
    if between := sum(segment.media is not None for segment in track[first : last + 1]):
        notices.append(f"{_count(between, 'media Segment')} between the episode's Segments left out: a Template's Main Slot is each Candidate's own.")
    if unheard:
        notices.append(f"{_count(unheard, 'Music Clip')} of the episode's sound left out: a Template plays only Media Library items.")
    return Captured(
        TemplateLayers(**{kind.value: listed for kind, listed in layers.items()}),
        notices,
        intro=TemplatePart(intro, _between(intro, by_join), by_join.get(intro[-1].id) if intro else None),
        outro=TemplatePart(outro, _between(outro, by_join), by_join.get(track[last].id) if outro else None),
        word_edits=[replace(edit, template=None) for edit in candidate.word_edits if edit.media is not None and edit.media in shown],
        cue_edits=[replace(edit, template=None) for edit in candidate.cue_edits if edit.media is not None and edit.media in shown],
        hook_offset=round(candidate.hook_start - bounds.main_start, 6),
        hook_secs=min(max(candidate.hook_secs, HOOK_SECS[0]), HOOK_SECS[1]),
        preset_id=candidate.preset_id,
        style_overrides=candidate.style_overrides,
        layout=candidate.layout,
        framing=candidate.framing if candidate.layout is Layout.MANUAL else None,
        grade=candidate.grade,
        source_volume=candidate.source_volume,
        treatment=Treatment(track[first].grade, track[first].video_effects, track[first].audio_effects),
        kicker=candidate.hook_kicker,
    )


def _unmarked(segment: Segment) -> Segment:
    return replace(segment, template=None)


def _between(segments: Sequence[Segment], by_join: Mapping[str, Transition]) -> list[Transition]:
    """The Transitions at the joins between `segments`, from `by_join` (by the Segment each follows)."""
    return [by_join[segment.id] for segment in segments[:-1] if segment.id in by_join]


def anchored(start: float, end: float, bounds: Boundaries, kind: AnchorKind | None = None) -> Anchor:
    """The Anchor of a layer from `start` to `end`: as `kind` names it, or each edge from its nearest
    boundary. A layer wholly inside the intro or the outro hangs from that part's two boundaries:
    there, Start hangs both edges from the one nearer its start edge, End from the one nearer its end
    edge, and Span its start edge from the part's start and its end edge from its end."""
    starts, ends, guessed = START_SIDE, END_SIDE, _PREFERRED
    if bounds.main_start > bounds.clip_start and end <= bounds.main_start + 1e-6:
        starts = ends = guessed = (Boundary.CLIP_START, Boundary.MAIN_START)
    elif bounds.clip_end > bounds.main_end and start >= bounds.main_end - 1e-6:
        starts = ends = guessed = (Boundary.MAIN_END, Boundary.CLIP_END)
    if kind is AnchorKind.START:
        boundary = _nearest(start, bounds, starts)
        return Anchor(_edge(start, bounds, boundary), _edge(end, bounds, boundary))
    if kind is AnchorKind.END:
        boundary = _nearest(end, bounds, ends)
        return Anchor(_edge(start, bounds, boundary), _edge(end, bounds, boundary))
    if kind is AnchorKind.SPAN:
        if starts is ends:
            return Anchor(_edge(start, bounds, starts[0]), _edge(end, bounds, ends[1]))
        return Anchor(_edge(start, bounds, _nearest(start, bounds, starts)), _edge(end, bounds, _nearest(end, bounds, ends)))
    return Anchor(_edge(start, bounds, _nearest(start, bounds, guessed)), _edge(end, bounds, _nearest(end, bounds, guessed)))


def apply(
    template: Template | None, candidate: Candidate, named: Mapping[str, Template] | None = None, lengths: Mapping[str, float] | None = None
) -> Applied:
    """The Candidate once `template` is applied, or with None ("No Template") its Template items taken
    off alone. Its Template items (of any Template) are taken off: layers, intro and outro Segments,
    their Transitions and their videos' Word Edits and Cue Edits. The Template's intro goes before the
    Candidate's own Segments (one implicit Segment made explicit) and its outro after them, with its
    Transitions at their joins (the Join Transition never applies there; the joins between its own
    Segments keep theirs), and its videos' Word Edits and Cue Edits but where the Candidate has its own
    of that key; all marked. Its hand-made layers and hook move by as much as the Main Slot's start
    moved, as a ripple at Timeline 0 would (one wholly on the old intro is left out); then the hook is
    put at the Template's distance from the Main Slot's start, as long as the Template's. Each of the
    Template's layers is placed by its Anchor on the new boundaries and marked: a Span whose edges
    cross there is left out; one stretched or shortened keeps the Keyframes of its first half at their
    distance from its start and those of its second half from its end. A Music Clip or video Overlay
    stops where its song or video ends, by `lengths` (the Media Library's songs' and videos' lengths,
    by id; one not there isn't stopped), never looping. A layer reaching past the Clip is cut short at
    its edge, or left out when shorter than ITEM_MIN_SECS there. Each of these is told. Its Text
    Layers' Template Fields are filled from the Candidate (an empty one with a notice). The Template's
    style, Layout, Grade and Clip volume replace the Candidate's, its Kicker too when it has one (the
    hook text is the Candidate's), and every Segment of the Source takes its Main Slot treatment,
    keeping its cut, Speed, Reverse, volume, fades and Keyframes. "No Template" leaves these be. `named` holds
    the Templates the Candidate's marks may name, by id: an item taken off that differs from a fresh
    application of its Template was changed by hand, and is counted; so is every item of a Template
    not there (deleted)."""
    lengths = lengths or {}
    notices = _replaced(candidate, named or {}, "removed" if template is None else "replaced", lengths)
    wrap = _wrapped(template, candidate)
    look: dict[str, Any] = {}
    shift = round(wrap.bounds.main_start - _main_start(candidate), 6)
    kept, dropped = _shifted(candidate, shift)
    if dropped:
        notices.append(f"{_count(dropped, 'layer')} made by hand over the intro removed.")
    hook = _moved(candidate.hook_start, candidate.hook_secs, shift)
    if template is not None:
        hook = (wrap.bounds.main_start + template.hook_offset, template.hook_secs)
        placed = _placed(template, wrap.bounds, kept, _field_values(template, candidate), lengths)
        if placed.crossed:
            notices.append(f"{_count(placed.crossed, 'Span')} left out: {'its' if placed.crossed == 1 else 'their'} edges cross on this clip.")
        notices.extend(_stopped(kind, n) for kind, n in placed.stopped.items())
        told = [placed.trimmed and f"{_count(placed.trimmed, 'layer')} cut short to fit", placed.left_out and f"{placed.left_out} left out, falling outside the clip"]
        if placed.trimmed or placed.left_out:
            notices.append(f"{'; '.join(part for part in told if part)}.")
        notices.extend(f"{{{name}}} left empty: this clip has no {_FIELD_NAMES[name]}." for name in placed.empty)
        kept = placed.layers
        wrap = wrap._replace(segments=[_treated(segment, template.treatment) if segment.media is None else segment for segment in wrap.segments])
        look = {
            "preset_id": template.preset_id, "style_overrides": template.style_overrides, "layout": template.layout,
            "framing": template.framing if template.layout is Layout.MANUAL else None,
            "grade": template.grade, "source_volume": template.source_volume, **({"hook_kicker": template.kicker} if template.kicker else {}),
        }
    hook_secs = min(max(hook[1], HOOK_SECS[0]), HOOK_SECS[1], max(wrap.bounds.clip_end, HOOK_SECS[0]))
    hook_start = round(max(0.0, min(hook[0], wrap.bounds.clip_end - hook_secs)), 6)
    track = _track(template, candidate, wrap)
    change = CandidateChange(
        **{kind.value: listed for kind, listed in kept.items()}, **track, **look, hook_start=hook_start, hook_secs=round(hook_secs, 6)
    )
    return Applied(change, notices)


class _Wrapped(NamedTuple):
    """A Candidate's Main Track, Transitions, Word Edits and Cue Edits once a Template (or none) is
    applied, and the boundaries they make."""

    segments: list[Segment]
    transitions: list[Transition]
    word_edits: list[WordEdit]
    cue_edits: list[CueEdit]
    bounds: Boundaries


def _wrapped(template: Template | None, candidate: Candidate) -> _Wrapped:
    """The Candidate's own Segments (its Main Track's unmarked ones), the Transitions at the joins
    between them and its own Word Edits and Cue Edits, with `template`'s intro and outro around them,
    marked."""
    own = [segment for segment in candidate.main_track() if segment.template is None]
    inner = {segment.id for segment in own[:-1]}
    transitions = [transition for transition in candidate.transitions if transition.template is None and transition.after in inner]
    word_edits = [edit for edit in candidate.word_edits if edit.template is None]
    cue_edits = [edit for edit in candidate.cue_edits if edit.template is None]
    if template is None:
        return _Wrapped(own, transitions, word_edits, cue_edits, _bounds(own, transitions, 0, len(own)))
    taken = {segment.id for segment in own}
    intro, into = _part(template.intro, template.id, taken)
    outro, out_of = _part(template.outro, template.id, taken)
    if template.intro.join is not None and intro:
        into.append(replace(template.intro.join, after=intro[-1].id, template=template.id))
    if template.outro.join is not None and outro:
        out_of.insert(0, replace(template.outro.join, after=own[-1].id, template=template.id))
    segments = [*intro, *own, *outro]
    transitions = [*into, *transitions, *out_of]
    keys = {_key(edit) for edit in word_edits}
    word_edits = [*word_edits, *(replace(edit, template=template.id) for edit in template.word_edits if _key(edit) not in keys)]
    keys = {_key(edit) for edit in cue_edits}
    cue_edits = [*cue_edits, *(replace(edit, template=template.id) for edit in template.cue_edits if _key(edit) not in keys)]
    return _Wrapped(segments, transitions, word_edits, cue_edits, _bounds(segments, transitions, len(intro), len(intro) + len(own)))


def _part(part: TemplatePart, template_id: str, taken: set[str]) -> tuple[list[Segment], list[Transition]]:
    """An intro's or outro's Segments and the Transitions between them, marked, each Segment given a
    free id (added to `taken`) and each Transition following it to its new id."""
    ids: dict[str, str] = {}
    for segment in part.segments:
        ids[segment.id] = _free_id(segment.id, taken)
        taken.add(ids[segment.id])
    segments = [replace(segment, id=ids[segment.id], template=template_id) for segment in part.segments]
    transitions = [replace(transition, after=ids[transition.after], template=template_id) for transition in part.transitions if transition.after in ids]
    return segments, transitions


def _key(edit: WordEdit | CueEdit) -> tuple[str, float]:
    """A Word Edit's or Cue Edit's key: its timeline and its time there, to the ms (app/review.py)."""
    return edit.media or "", round(edit.at, 3)


def _main_start(candidate: Candidate) -> float:
    """Where the Candidate's own Segments (its Main Track's unmarked ones) start on its Timeline."""
    track = candidate.main_track()
    first = next((i for i, segment in enumerate(track) if segment.template is None), 0)
    return _played(track, candidate.transitions)[first][0]


def _track(template: Template | None, candidate: Candidate, wrap: _Wrapped) -> dict[str, Any]:
    """The fields of the change that `wrap` sets: none when the Candidate has no intro's or outro's
    items to take off, `template` none to put in, and its Segments are as they were."""
    marked = any(item.template is not None for item in [*candidate.segments, *candidate.transitions, *candidate.word_edits, *candidate.cue_edits])
    brings = template is not None and bool(template.intro.segments or template.outro.segments or template.word_edits or template.cue_edits)
    if not (marked or brings or wrap.segments != candidate.main_track()):
        return {}
    return {"segments": wrap.segments, "transitions": wrap.transitions, "word_edits": wrap.word_edits, "cue_edits": wrap.cue_edits}


def _shifted(candidate: Candidate, shift: float) -> tuple[dict[LayerKind, list[Any]], int]:
    """The Candidate's hand-made layers moved by `shift` seconds, as a ripple at Timeline 0 moves
    them: later by it, or earlier with the part before 0 cut off (a song or a video going on from as
    far into it, its Keyframes following) and one left shorter than ITEM_MIN_SECS left out; and how
    many were left out."""
    kept: dict[LayerKind, list[Any]] = {kind: [] for kind in LayerKind}
    dropped = 0
    for kind, item in _layers_of(candidate):
        if item.template is not None:
            continue
        if shift >= 0:
            kept[kind].append(replace(item, start=round(item.start + shift, 6)) if shift else item)
        elif (fitted := _fitted(item, item.start + shift, item.start + item.secs + shift, math.inf)) is not None:
            kept[kind].append(fitted[0])
        else:
            dropped += 1
    return kept, dropped


def _moved(start: float, secs: float, shift: float) -> tuple[float, float]:
    """The hook from `start`, `secs` long, moved as `_shifted` moves a layer, but never left out:
    wholly before 0, it starts there, as long as it was."""
    if shift >= 0:
        return start + shift, secs
    end = start + secs + shift
    if end <= 0:
        return 0.0, secs
    return max(start + shift, 0.0), end - max(start + shift, 0.0)


class _Placed(NamedTuple):
    """A Template's layers placed on a Candidate beside the layers it keeps, and how many were cut
    short, left out, Spans left out for their crossed edges and, by kind, stopped at their song's or
    video's end."""

    layers: dict[LayerKind, list[Any]]
    trimmed: int
    left_out: int
    # The Template Fields left empty, by name, in the order of _FIELD_NAMES.
    empty: list[str]
    crossed: int
    stopped: dict[LayerKind, int]


def _placed(
    template: Template, bounds: Boundaries, kept: Mapping[LayerKind, list[Any]], values: Mapping[str, str], lengths: Mapping[str, float]
) -> _Placed:
    """`template`'s layers placed by their Anchors on `bounds` and marked beside the `kept` ones, its
    Text Layers' Template Fields filled with `values`, its songs and videos stopped by `lengths`."""
    layers = {kind: list(listed) for kind, listed in kept.items()}
    trimmed = left_out = crossed = 0
    stopped: dict[LayerKind, int] = {}
    empty: set[str] = set()
    for kind, layer in template.layers.items():
        start = bounds.at(layer.anchor.start.boundary) + layer.anchor.start.offset
        end = bounds.at(layer.anchor.end.boundary) + layer.anchor.end.offset
        if end - start < ITEM_MIN_SECS - 1e-9:
            crossed += 1
            continue
        item, ends = _ended(_stretched(layer.item, end - start), lengths)
        if ends:
            stopped[kind] = stopped.get(kind, 0) + 1
        fitted = _fitted(item, start, start + item.secs, bounds.clip_end)
        if fitted is None:
            left_out += 1
            continue
        item, cut = fitted
        trimmed += cut
        if isinstance(item, TextLayer):
            item = replace(item, text=_filled(item.text, values, empty))
        item_id = _free_id(item.id, {other.id for other in layers[kind]})
        layers[kind].append(replace(item, id=item_id, template=template.id))
    return _Placed(layers, trimmed, left_out, [name for name in _FIELD_NAMES if name in empty], crossed, stopped)


def _stopped(kind: LayerKind, n: int) -> str:
    """What the owner is told of `n` Music Clips or Overlays stopped where their song or video ends."""
    item, media = ("Music Clip", "song") if kind is LayerKind.MUSIC else ("Overlay", "video")
    end = f"its {media}'s end" if n == 1 else f"their {media}s' ends"
    return f"{_count(n, item)} stopped at {end}{': a song never loops' if kind is LayerKind.MUSIC else ''}."


def _stretched[T: Layer](item: T, secs: float) -> T:
    """`item` made `secs` long, as a Span is by its edges: its Keyframes in its first half keep their
    distance from its start, those in its second half from its end. Shortened, one that would pass its
    new middle from its half is left out, and one closer than a frame to the one before it."""
    if abs(secs - item.secs) <= 1e-6:
        return item
    keys = getattr(item, "keys", None)
    if not keys:
        return replace(item, secs=round(secs, 6))
    reach = 1e-6

    def moved(listed: Sequence[Any]) -> list[Any]:
        kept: list[Any] = []
        for key in listed:
            first = key.at <= item.secs / 2 + reach
            at = key.at if first else key.at + secs - item.secs
            passes = at > secs / 2 + reach if first else at < secs / 2 - reach
            if not passes and not (kept and at - kept[-1].at < KEY_GAP_SECS - reach):
                kept.append(replace(key, at=round(at, 6)))
        return kept

    return replace(item, secs=round(secs, 6), keys={prop: kept for prop, listed in keys.items() if (kept := moved(listed))})


def _ended[T: Layer](item: T, lengths: Mapping[str, float]) -> tuple[T, bool]:
    """`item`, a Music Clip or a video Overlay, stopped where its song or video ends at its Speed, by
    `lengths` (never looped), its Keyframes cut there; and whether it was. Any other as it is."""
    if not isinstance(item, MusicClip | Overlay) or item.media is None or item.media not in lengths:
        return item, False
    length = lengths[item.media]
    if overlay_time(item.offset, item.secs, item.speed, item.reverse).end <= length + _READ_REACH:
        return item, False
    secs = max(0.0, math.floor((length - item.offset) / item.speed * 1e6) / 1e6)
    keys = {prop: rewindow(listed, 0.0, secs) for prop, listed in item.keys.items()}
    return replace(item, secs=secs, keys={prop: listed for prop, listed in keys.items() if listed}), True


# The Template Fields (GLOSSARY.md, Template Field), by the name typed in braces, and what is told
# when one is empty.
_FIELD_NAMES = {"title": "title", "hook": "hook text", "kicker": "Kicker"}
_FIELD = re.compile(r"\{(title|hook|kicker)\}")


def _field_values(template: Template, candidate: Candidate) -> dict[str, str]:
    """What the Template Fields hold on `candidate` once `template` is applied: its title, its hook
    text without its Emphasis marks, and its Kicker (the Template's, when it has one)."""
    return {"title": candidate.title.strip(), "hook": candidate.hook_text.replace("*", "").strip(), "kicker": template.kicker or candidate.hook_kicker}


def _filled(text: str, values: Mapping[str, str], empty: set[str]) -> str:
    """`text` with its Template Fields filled from `values`, an empty one leaving nothing (its name
    added to `empty`), kept within a Text Layer's longest text."""

    def value(match: re.Match[str]) -> str:
        if not values[match[1]]:
            empty.add(match[1])
        return values[match[1]]

    return _FIELD.sub(value, text)[:TEXT_LAYER_MAX_CHARS]


def _treated(segment: Segment, treatment: Treatment) -> Segment:
    """A Segment of the Source given the Main Slot's treatment: its Grade, Video Effects and Audio
    Effects (none on a Freeze frame, which is silent); the rest of it as it was."""
    audio_effects = [] if segment.hold is not None else treatment.audio_effects
    return replace(segment, grade=treatment.grade, video_effects=treatment.video_effects, audio_effects=audio_effects)


def _replaced(candidate: Candidate, named: Mapping[str, Template], done: str, lengths: Mapping[str, float]) -> list[str]:
    """What the owner is told of the Candidate's Template items being taken off (`done`): those
    changed by hand since their Template put them there, as told by a fresh application of it with
    the same `lengths` (their ids and the Segment a Transition follows aside, which depend on the
    hand-made items beside them), and those of a deleted Template."""
    changed = gone = 0
    marks = _marked(candidate.segments, candidate.transitions, candidate.word_edits, candidate.cue_edits, dict(_layers_by_kind(candidate)))
    for template_id in dict.fromkeys(item.template for _, item in marks):
        marked = [(kind, item) for kind, item in marks if item.template == template_id]
        if template_id not in named:
            gone += len(marked)
            continue
        template = named[template_id]
        wrap = _wrapped(template, candidate)
        layers = _placed(template, wrap.bounds, {kind: [] for kind in LayerKind}, _field_values(template, candidate), lengths).layers
        fresh: dict[str, list[Any]] = {}
        for kind, item in _marked(wrap.segments, wrap.transitions, wrap.word_edits, wrap.cue_edits, layers):
            fresh.setdefault(kind, []).append(item)
        for kind, item in marked:
            puts = fresh.get(kind, [])
            same = next((i for i, put in enumerate(puts) if _alike(put, item)), None)
            if same is None:
                changed += 1
            else:
                del puts[same]
    notices = []
    if changed:
        notices.append(f"{_count(changed, 'Template item')} changed by hand {done}.")
    if gone:
        notices.append(f"{_count(gone, 'Template item')} of a deleted Template {done}.")
    return notices


def _marked(
    segments: Sequence[Segment], transitions: Sequence[Transition], word_edits: Sequence[WordEdit], cue_edits: Sequence[CueEdit],
    layers: Mapping[LayerKind, Sequence[Any]],
) -> list[tuple[str, Any]]:
    """The Template items among these, each with the name of its list."""
    listed: list[tuple[str, Sequence[Any]]] = [
        *((kind.value, layers.get(kind, [])) for kind in LayerKind),
        ("segments", segments), ("transitions", transitions), ("word_edits", word_edits), ("cue_edits", cue_edits),
    ]
    return [(kind, item) for kind, items in listed for item in items if item.template is not None]


def _alike(put: Any, item: Any) -> bool:
    """Whether `item` is as a fresh application put `put`, but for its id or the Segment it follows."""
    return replace(put, **{name: getattr(item, name) for name in ("id", "after") if hasattr(put, name)}) == item


def _layers_by_kind(candidate: Candidate) -> Iterator[tuple[LayerKind, list[Layer]]]:
    for kind in LayerKind:
        yield kind, getattr(candidate, kind.value)


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
    was; None when what is left is shorter than ITEM_MIN_SECS. One ending less than _EDGE_REACH past
    the Clip isn't cut. Its Keyframes and a song's or video's read follow the cut, as the Clipboard's
    paste does; an Adjustment Layer's fades stay within half of it."""
    shown_start, shown_end = max(start, 0.0), (end if end <= length + _EDGE_REACH else length)
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


def branded(template: Template, new: list[Candidate], episode: Episode, lengths: Mapping[str, float] | None = None) -> list[Candidate]:
    """New Candidates (not saved yet) with `template` applied (its songs and videos stopped by
    `lengths`, as `apply`): still at their first Revision and not edited, as Selection or the owner's
    Add made them."""
    made = []
    for candidate in new:
        _, applied = update([candidate], candidate.id, apply(template, candidate, lengths=lengths).change, episode)
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

    def create(self, name: str, captured: Captured) -> Template:
        now = datetime.now(UTC)
        with self._lock:
            saved = self._saved()
            template = Template(uuid4().hex[:8], name, now, now, **captured.contents())
            self._save(replace(saved, templates=[*saved.templates, template]))
        return template

    def save_over(self, template_id: str, name: str, captured: Captured) -> Template:
        """One of the Templates replaced by another of the same id. Candidates it was applied to keep
        their copies."""
        return self._change(template_id, lambda template: replace(template, name=name, **captured.contents()))

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
