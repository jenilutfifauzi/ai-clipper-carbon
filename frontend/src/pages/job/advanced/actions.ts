import type { Adjust, AdjustmentLayer, AudioEffect, AudioEffectKind, AudioEffectSetting, ClipSegment, Grade, JoinTransition, Keyframe, Keys, MusicClip, Overlay, Shape, TextLayer, TextStyle, Transform, Transition, TransitionKind, VideoEffect, VideoEffectKind } from "../../../api";
import { CLEAN_SWITCHES, isCleanSwitch, type CleanSwitchId } from "../../../audioEffects";
import { adjusted, NEUTRAL_GRADE, relooked } from "../editor/grading";
import { withJoinTransition } from "../editor/joinTransition";
import type { PlayedSegment } from "../editor/playback";
import type { StyleDraft } from "../editor/useStyleDraft";
import { offsetAt, playedSourceAt, playedTimeAt, rangeOf, segmentLength, sourceAt, type SegmentRange } from "../editor/segmentTime";
import { TRANSITION_KINDS } from "../editor/transitions";
import { DUCK_MAX, DUCK_MIN, FADE_MAX_SECS, fadesWithin, halfFadeMax, ITEM_MIN_SECS, keptOffset, NEW_LAYER_SECS, newId, round, type AdvancedEdits } from "./edits";
import { mirroredKeys, rekeyed, scaledKeys, shownTransform, toMillionth } from "./keyActions";
import { draggedSegments, MEDIA_MIN_SECS, SEGMENT_MIN_SECS } from "./MainTrack";
import { isPicked, isPlaced, itemsOf, listOf, onlyItem, picked, TRACK_OF, type ItemKind, type ItemRef, type Pick, type PlacedKind } from "./pick";
import { removedNotice, ripple, type Layers, type TrackChange } from "./ripple";
import { speedLabel, speedOf } from "./speed";
import type { LandedTake } from "./takeFlow";
import type { TrackKind } from "./trackState";

/**
 * What the actions on a Pick are done in (not a Scene of the plan): the edits and the Pick, the Main Track as it plays, the
 * Clip's length, `gap` (which moves a time on the Source's timeline into the silence between Words
 * nearest it), `ids` (new items' ids), `magnetic`, whether the layers follow the Main Track (the
 * Magnetic timeline), the `locked` Tracks, whose items aren't picked, split or pasted (but
 * follow the Main Track all the same), and `join`, the Join Transition of the Candidate's Style
 * Preset, which each new join an action makes gets (withJoins).
 */
export interface PickContext {
  edits: AdvancedEdits;
  pick: Pick;
  played: PlayedSegment[];
  duration: number;
  gap: (time: number) => number;
  ids?: () => string;
  magnetic?: boolean;
  locked?: TrackKind[];
  join?: JoinTransition | null;
}

/** An action's result: the edits after it (one change, so one step of undo), what is picked then, and what to tell. */
export interface Outcome {
  edits: AdvancedEdits;
  pick: Pick;
  notice?: string;
}

export type Timed = TextLayer | Shape | MusicClip | Overlay | AdjustmentLayer;
export type TimedKind = "text" | "shape" | "music" | "overlay" | "adjustment";

/**
 * An Adjustment Layer with its fades each held to half its length (ADR 0013, as the backend refuses
 * longer ones): after a trim, a cut or a split. As it is when they fit.
 */
export function fadesHalved<T extends Timed>(item: T): T {
  if (!("strength" in item)) return item;
  const half = halfFadeMax(item.secs);
  if (item.fade_in <= half && item.fade_out <= half) return item;
  return { ...item, fade_in: Math.min(item.fade_in, half), fade_out: Math.min(item.fade_out, half) };
}

/**
 * How each kind of timed item behaves: its list in the edits; where a copy goes when there is no
 * room after it (a text or a Shape a little lower, so that both show); and, split in two, what each part keeps
 * (a song's or video's second part goes on from where the first stops in its file; a song has no
 * fades at the cut, nor a fade longer than its part).
 */
const KINDS: {
  [K in TimedKind]: {
    list: "text_layers" | "shapes" | "music" | "overlays" | "adjustment_layers";
    aside: (item: Timed) => Partial<Timed>;
    cut: (item: Timed, at: number) => { first: Partial<Timed>; second: Partial<Timed> };
  };
} = {
  text: {
    list: "text_layers",
    aside: (item) => {
      const { transform } = item as TextLayer;
      return { transform: { ...transform, y: Math.min(transform.y + 80, 1920) } };
    },
    cut: () => ({ first: {}, second: {} }),
  },
  shape: {
    list: "shapes",
    aside: (item) => {
      const { transform } = item as Shape;
      return { transform: { ...transform, y: Math.min(transform.y + 80, 1920) } };
    },
    cut: () => ({ first: {}, second: {} }),
  },
  music: {
    list: "music",
    aside: () => ({}),
    // Each part plays its stretch of the song (keptOffset), at its Speed: in Reverse, the first the later part.
    cut: (item, at) => {
      const clip = item as MusicClip;
      const into = at - clip.start;
      return {
        first: { offset: keptOffset(clip, 0, into), fade_in: Math.min(clip.fade_in, round(into)), fade_out: 0 },
        second: { offset: keptOffset(clip, into, clip.secs), fade_in: 0, fade_out: Math.min(clip.fade_out, round(clip.start + clip.secs - at)) },
      };
    },
  },
  overlay: {
    list: "overlays",
    aside: (item) => {
      const { transform } = item as Overlay;
      return { transform: { ...transform, y: Math.min(transform.y + 80, 1920) } };
    },
    // Each part shows its stretch of the video (keptOffset): in Reverse, the first the later part.
    cut: (item, at) => {
      const overlay = item as Overlay;
      const into = at - overlay.start;
      return { first: { offset: keptOffset(overlay, 0, into) }, second: { offset: keptOffset(overlay, into, overlay.secs) } };
    },
  },
  adjustment: {
    list: "adjustment_layers",
    aside: () => ({}),
    // No fade at the cut, so that the grade goes on across it; each part's other fade held to half of it.
    cut: (item, at) => {
      const layer = item as AdjustmentLayer;
      const into = at - layer.start;
      const rest = layer.start + layer.secs - at;
      return {
        first: { fade_in: Math.min(layer.fade_in, halfFadeMax(into)), fade_out: 0 },
        second: { fade_in: 0, fade_out: Math.min(layer.fade_out, halfFadeMax(rest)) },
      };
    },
  },
};

export const idOf = (scene: PickContext) => (scene.ids ?? newId)();

/**
 * An action's `outcome` with a copy of the scene's Join Transition on each join of its Main Track
 * that wasn't one in `from` (the scene's edits; a drag's, where it began) and has no Transition
 * (editor/joinTransition.ts), in the same change. Every action that changes the Main Track ends here.
 */
export function withJoins<T extends Outcome | null>(scene: PickContext, outcome: T, from: AdvancedEdits = scene.edits): T {
  if (!outcome || !scene.join) return outcome;
  const ids = (segments: ClipSegment[]) => segments.map((segment) => segment.id);
  const transitions = withJoinTransition(ids(from.segments), ids(outcome.edits.segments), outcome.edits.transitions, scene.join);
  return transitions === outcome.edits.transitions ? outcome : { ...outcome, edits: { ...outcome.edits, transitions } };
}

/**
 * The picked items removed. The Main Track is never left empty: with every Segment picked, the first
 * stays, picked, and the owner is told. On the Magnetic timeline (or `rippled`), the layers and the
 * hook follow the Main Track: each removed Segment's stretch as played is cut out of it.
 */
export function remove(scene: PickContext, rippled = scene.magnetic ?? false): Outcome | null {
  const { edits, pick } = scene;
  if (!itemsOf(pick).length) return null;
  const kept = <T extends { id: string }>(items: T[], kind: ItemKind) => items.filter((item) => !isPicked(pick, kind, item.id));
  const next = {
    ...edits,
    segments: kept(edits.segments, "segment"),
    text_layers: kept(edits.text_layers, "text"),
    shapes: kept(edits.shapes, "shape"),
    music: kept(edits.music, "music"),
    overlays: kept(edits.overlays, "overlay"),
    // Left out of a Candidate from before them, which has none.
    ...(edits.adjustment_layers && { adjustment_layers: kept(edits.adjustment_layers, "adjustment") }),
  };
  if (!next.segments.length) {
    const first = edits.segments[0];
    const stays = "The first Segment stays: a clip needs at least one.";
    const pickFirst = picked({ kind: "segment", id: first.id });
    // Only the one Segment there is picked: nothing changes.
    if (itemsOf(pick).length === 1 && edits.segments.length === 1) return { edits, pick: pickFirst, notice: stays };
    next.segments = [first];
    const after = rippledAfter(scene, next, rippled);
    return withJoins(scene, { edits: after.edits, pick: pickFirst, notice: [stays, after.notice].filter(Boolean).join(" ") });
  }
  return withJoins(scene, { ...rippledAfter(scene, next, rippled), pick: null });
}

// `next`, with the Segments of the context's edits that it no longer has cut out of the Main Track
// when `rippled`, and what to tell of the layers that went with them.
function rippledAfter(scene: PickContext, next: AdvancedEdits, rippled: boolean): { edits: AdvancedEdits; notice?: string } {
  const changes: TrackChange[] = scene.edits.segments.flatMap((segment, i) => {
    const shown = scene.played[i];
    return shown && !next.segments.some((other) => other.id === segment.id)
      ? [{ kind: "removed" as const, at: shown.start, secs: shown.end - shown.start }]
      : [];
  });
  return rippledIf(next, changes, rippled, scene.duration);
}

// `next` with its layers and hook following the Main Track's `changes` when they do (`on`), and what
// to tell of the layers that a cut took.
function rippledIf<T extends Layers>(next: T, changes: TrackChange[], on: boolean, duration?: number): { edits: T; notice?: string } {
  if (!on || !changes.length) return { edits: next };
  const { edits, removed } = ripple(next, changes, duration);
  const notice = removedNotice(removed);
  return notice ? { edits, notice } : { edits };
}

/** The layers and the hook of `edits`: what a ripple changes. */
export const layersOf = ({ text_layers, shapes, music, overlays, adjustment_layers, hook_start, hook_secs }: Layers): Layers => ({
  text_layers,
  shapes,
  music,
  overlays,
  adjustment_layers,
  hook_start,
  hook_secs,
});

/**
 * The picked items removed and their gaps closed, whatever the Magnetic timeline's switch says (Ripple
 * delete, GLOSSARY.md): the Text Layers, Shapes, Music Clips and Overlays of a Track after a removed one of
 * it move up by its length (those over it stay), and then the layers follow the removed Segments.
 */
export function rippleRemove(scene: PickContext): Outcome | null {
  const { layers } = pickedItems(scene);
  const edits = { ...scene.edits };
  for (const kind of Object.keys(KINDS) as TimedKind[]) {
    const gone = layers.filter((layer) => layer.kind === kind).map(({ item }) => ({ start: item.start, end: item.start + item.secs }));
    if (!gone.length) continue;
    const list = KINDS[kind].list;
    const closed = (listOf(edits, kind) as Timed[])
      .filter((item) => !isPicked(scene.pick, kind, item.id))
      .map((item) => {
        const by = covered(gone.filter((span) => span.end <= item.start + 1e-6));
        return by ? { ...item, start: round(item.start - by) } : item;
      });
    Object.assign(edits, { [list]: closed });
  }
  return remove({ ...scene, edits }, true);
}

// How long `spans` cover, counting where they overlap once.
function covered(spans: { start: number; end: number }[]): number {
  let total = 0;
  let reached = -Infinity;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    total += Math.max(0, span.end - Math.max(span.start, reached));
    reached = Math.max(reached, span.end);
  }
  return total;
}

/**
 * The layers and the hook after the clip editor trims an uncut Clip from `from` to `to` (on the
 * Source's timeline), on the Magnetic timeline: a later start cuts the Clip's first seconds out, an
 * earlier one puts seconds in before them; an earlier end cuts its last seconds out.
 */
export function clipTrimmed<T extends Layers>(
  layers: T,
  from: { start: number; end: number },
  to: { start: number; end: number },
): { layers: T; notice?: string } {
  const changes: TrackChange[] = [];
  if (to.start > from.start) changes.push({ kind: "removed", at: 0, secs: to.start - from.start });
  if (to.start < from.start) changes.push({ kind: "inserted", at: 0, secs: from.start - to.start });
  if (to.end < from.end) changes.push({ kind: "removed", at: to.end - from.start, secs: from.end - to.end });
  const { edits, notice } = rippledIf(layers, changes, true, from.end - from.start);
  return notice ? { layers: edits, notice } : { layers: edits };
}

/** Where a Segment added at the playhead (`time`) goes on the Main Track: after the one playing there, else last. */
export function placeAfter(played: PlayedSegment[], time: number): number {
  const at = played.findIndex((shown) => time < shown.end);
  return at === -1 ? played.length : at + 1;
}

/**
 * The join a Transition card's click goes to, by the Segment it follows: the picked join, else the
 * join nearest the playhead (`time`; the earlier of two as near), drawn where its Segment ends as
 * played; none in a Clip of one Segment.
 */
export function cardTarget(pick: Pick, segments: { id: string }[], played: { end: number }[], time: number): string | null {
  if (pick?.kind === "join") return pick.after;
  let nearest: string | null = null;
  let distance = Infinity;
  for (const [i, segment] of segments.slice(0, -1).entries()) {
    const away = Math.abs((played[i]?.end ?? Infinity) - time);
    if (away < distance) [nearest, distance] = [segment.id, away];
  }
  return nearest;
}

/** A kind picked uniformly from all of them but those to `avoid`, by `random` (in [0, 1)). */
export function randomKind(avoid: readonly TransitionKind[], random: () => number = Math.random): TransitionKind {
  const open = TRANSITION_KINDS.filter((kind) => !avoid.includes(kind));
  return open[Math.min(Math.floor(random() * open.length), open.length - 1)];
}

/**
 * Randomise all joins: each join of `segments`, in order, gets a kind picked at random, never the
 * kind of the join before; each keeps `model`'s (the picked join's) length, knobs and sound.
 */
export function randomisedTransitions(model: Transition, segments: { id: string }[], random: () => number = Math.random): Transition[] {
  const transitions: Transition[] = [];
  for (const segment of segments.slice(0, -1)) {
    const before = transitions.at(-1);
    transitions.push({ ...model, after: segment.id, kind: randomKind(before ? [before.kind] : [], random) });
  }
  return transitions;
}

/** Apply to all joins: `model` (the picked join's whole Transition) on every join of `segments`, each with its own `after`. */
export const appliedToAll = (model: Transition, segments: { id: string }[]): Transition[] =>
  segments.slice(0, -1).map((segment) => ({ ...model, after: segment.id }));

/** The Random card's kind for the join after Segment `after`: one picked at random, unlike the kinds of the joins either side. */
export function randomCardKind(transitions: Transition[], segments: { id: string }[], after: string, random: () => number = Math.random): TransitionKind {
  const at = segments.findIndex((segment) => segment.id === after);
  const neighbours = [segments[at - 1], segments[at + 1]].flatMap((segment) => transitions.find((transition) => transition.after === segment?.id)?.kind ?? []);
  return randomKind(neighbours, random);
}

/** Where a Segment dropped at `time` goes on the Main Track: after each Segment whose middle is before it. */
export const placeDropped = (played: PlayedSegment[], time: number) => played.filter((shown) => (shown.start + shown.end) / 2 < time).length;

/** `segment` put in on the Main Track at `place`, picked; on the Magnetic timeline the layers after it play later. */
export function insertSegment(scene: PickContext, segment: ClipSegment, place: number): Outcome {
  const { segments } = scene.edits;
  const next = { ...scene.edits, segments: [...segments.slice(0, place), segment, ...segments.slice(place)] };
  const at = scene.played[place]?.start ?? scene.duration;
  return withJoins(scene, {
    edits: rippledIf(next, [{ kind: "inserted", at, secs: segmentLength(segment) }], scene.magnetic ?? false).edits,
    pick: picked({ kind: "segment", id: segment.id }),
  });
}

/**
 * The Main Track when a drag of a Segment began: the edits then, and the track as drawn (`shown`) and
 * as planned (`planned`). Every step of the drag is made from it, so that the drag is one change.
 */
export interface SegmentDrag {
  edits: AdvancedEdits;
  shown: PlayedSegment[];
  planned: PlayedSegment[];
}

/**
 * Segment `id` dragged since `origin`: moved to another place, or its start or end trimmed (within its
 * file's `lengthOf`, and the `longest` clip). See draggedSegments. Trimmed on the Magnetic timeline,
 * the layers move with the edge from where they were when the drag began; moved, they stay. The
 * joins new since it began get the Join Transition.
 */
export function dragSegment(
  scene: PickContext,
  origin: SegmentDrag,
  id: string,
  change: { start: number; end: number; edge: "move" | "start" | "end" },
  lengthOf: (segment: ClipSegment) => number,
  longest?: number,
): Outcome {
  const before = origin.edits.segments.find((segment) => segment.id === id);
  // A video's Keyframes re-anchored to what its trim keeps (retimed), and its fades fitted to it, from
  // the Segment as the drag began.
  const segments = draggedSegments(origin.edits.segments, id, change, lengthOf, origin.shown, origin.planned, longest).map((segment) =>
    segment.id === id && before ? fadesFitted(retimed(before, segment, change.edge)) : segment,
  );
  const index = segments.findIndex((segment) => segment.id === id);
  const whole = origin.planned[index];
  const moved = { ...scene.edits, segments, transitions: origin.edits.transitions };
  if (change.edge === "move" || !whole || !scene.magnetic) return withJoins(scene, { edits: moved, pick: scene.pick }, origin.edits);
  // Longer (or shorter) by `by` at the trimmed edge, as planned.
  const by = segmentLength(segments[index]) - segmentLength(rangeOf(whole));
  const at = change.edge === "end" ? whole.end + Math.min(by, 0) : whole.start;
  const { edits, notice } = rippledIf(
    origin.edits,
    [{ kind: by < 0 ? "removed" : "inserted", at, secs: Math.abs(by) }],
    Math.abs(by) > 1e-6,
    origin.shown.at(-1)?.end,
  );
  return withJoins(scene, { edits: { ...moved, ...layersOf(edits) }, pick: scene.pick, ...(notice ? { notice } : {}) }, origin.edits);
}

/** Every Segment, Text Layer, Shape, Music Clip and Overlay picked (not the hook, the captions or a join). */
export function pickAll(edits: AdvancedEdits): Pick {
  const refs = (kind: ItemKind) => (listOf(edits, kind) as { id: string }[]).map((item) => ({ kind, id: item.id }));
  return picked(...refs("segment"), ...refs("text"), ...refs("shape"), ...refs("music"), ...refs("overlay"), ...refs("adjustment"));
}

// The picked Segments in Main Track order, and the picked Text Layers, Shapes, Music Clips and
// Overlays in their lists' order: the order their copies and parts are made and picked in.
export function pickedItems(scene: PickContext) {
  const { edits, pick } = scene;
  const segments = edits.segments.filter((segment) => isPicked(pick, "segment", segment.id));
  const layers = (Object.keys(KINDS) as TimedKind[]).flatMap((kind) =>
    ((edits[KINDS[kind].list] ?? []) as Timed[]).filter((item) => isPicked(pick, kind, item.id)).map((item) => ({ kind, item })),
  );
  return { segments, layers };
}

/**
 * The Pick duplicated, the copies picked. Its Segments are copied as a block, in order, right after
 * the last of them. Its Text Layers, Shapes, Music Clips and Overlays are copied as they are placed, right
 * after the group they make when there is room before the Clip's end, else each where its kind puts
 * it aside. On the Magnetic timeline, the layers after the copied Segments play later.
 */
export function duplicate(scene: PickContext): Outcome | null {
  const { edits, duration } = scene;
  const { segments, layers } = pickedItems(scene);
  if (!segments.length && !layers.length) return null;
  const next = { ...edits };
  const copies: ItemRef[] = [];
  // How much longer the copied Segments make the Clip.
  let added = 0;
  if (segments.length) {
    const last = edits.segments.indexOf(segments.at(-1)!);
    const block = segments.map((segment) => ({ ...segment, id: idOf(scene) }));
    next.segments = [...edits.segments.slice(0, last + 1), ...block, ...edits.segments.slice(last + 1)];
    added = block.reduce((sum, segment) => sum + segmentLength(segment), 0);
    const at = scene.played[last + 1]?.start ?? duration;
    Object.assign(next, rippledIf(next, [{ kind: "inserted", at, secs: added }], scene.magnetic ?? false).edits);
    copies.push(...block.map((segment) => ({ kind: "segment" as const, id: segment.id })));
  }
  if (layers.length) {
    // As they are once the copied Segments have moved them, in a Clip that much longer.
    const moved = pickedItems({ ...scene, edits: next }).layers;
    const length = duration + added;
    const first = Math.min(...moved.map(({ item }) => item.start));
    const end = Math.max(...moved.map(({ item }) => item.start + item.secs));
    const room = end + (end - first) <= length + 1e-6;
    for (const { kind, item } of moved) {
      const copy = stillDetached({ ...item, id: idOf(scene), ...(room ? { start: round(item.start + end - first) } : KINDS[kind].aside(item)) } as Timed, next.segments);
      const list = KINDS[kind].list;
      Object.assign(next, { [list]: [...(listOf(next, kind) as Timed[]), copy] });
      copies.push({ kind, id: copy.id });
    }
  }
  return withJoins(scene, { edits: next, pick: picked(...copies) });
}

// Whether the playhead at `time` is inside picked item `ref`, so that it can be split there. A Freeze
// frame isn't split: it holds one frame.
function inside(scene: PickContext, ref: ItemRef, time: number): boolean {
  if (ref.kind === "segment") {
    const index = scene.edits.segments.findIndex((segment) => segment.id === ref.id);
    const shown = scene.played[index];
    if (scene.edits.segments[index]?.hold != null) return false;
    return !!shown && time > shown.start + SEGMENT_MIN_SECS && time < shown.end - SEGMENT_MIN_SECS;
  }
  const item = ((scene.edits[KINDS[ref.kind].list] ?? []) as Timed[]).find((other) => other.id === ref.id);
  return !!item && time > item.start + ITEM_MIN_SECS && time < item.start + item.secs - ITEM_MIN_SECS;
}

/** Whether a picked item can be split at `time`: when it is inside one. */
export function canSplit(scene: PickContext, time: number): boolean {
  return itemsOf(scene.pick).some((ref) => inside(scene, ref, time));
}

/**
 * The picked items the playhead (`at`) is inside split there, their second parts picked. A Segment is
 * cut where it is in the Source (or its video) as played, Transitions and Word snapping included; one
 * of the Source in the silence between Words nearest the playhead, since the backend snaps each
 * part's edge to the Words it holds and a cut through a Word would give that Word to both.
 */
export function split(scene: PickContext, at: number): Outcome | null {
  const { edits } = scene;
  const { segments, layers } = pickedItems(scene);
  const next = { ...edits };
  const tails: ItemRef[] = [];
  for (const segment of segments) {
    if (!inside(scene, { kind: "segment", id: segment.id }, at)) continue;
    const shown = scene.played[edits.segments.indexOf(segment)];
    const there = playedSourceAt(shown, at);
    const cut = Math.round((segment.media ? there : scene.gap(there)) * 1000) / 1000;
    // On the Timeline the first part plays first: in Reverse, the later part of the range, from its
    // end (as played) down to the cut. Both keep the Segment's Speed, pitch and Reverse, and a
    // reversed one's copy serves both.
    const [firstRange, secondRange] = segment.reverse
      ? [{ start: cut, end: rangeOf(shown).end }, { start: segment.start, end: cut }]
      : [{ start: shown.source_start, end: cut }, { start: cut, end: segment.end }];
    // Keyframes, where a Segment has them, are re-anchored to each part, in seconds from its start;
    // its fades are cut with it (cutFades).
    const [first, second] = cutFades(
      segment,
      rekeyed<ClipSegment>({ ...segment, ...firstRange }, offsetAt(segment, segment.reverse ? firstRange.end : firstRange.start), offsetAt(segment, cut)),
      rekeyed<ClipSegment>({ ...segment, ...secondRange, id: idOf(scene) }, offsetAt(segment, cut), segmentLength(segment)),
    );
    next.segments = next.segments.flatMap((other) => (other.id === segment.id ? [first, second] : [other]));
    tails.push({ kind: "segment", id: second.id });
  }
  const time = round(at);
  for (const { kind, item } of layers) {
    if (!inside(scene, { kind, id: item.id }, at)) continue;
    const { first, second } = KINDS[kind].cut(item, time);
    // Each part has the Keyframes of its own stretch (keyActions.ts' rekeyed).
    const head = rekeyed({ ...item, secs: round(time - item.start), ...first } as Timed, 0, time - item.start);
    const tail = stillDetached(
      rekeyed({ ...item, id: idOf(scene), start: time, secs: round(item.start + item.secs - time), ...second } as Timed, time - item.start, item.secs),
      next.segments,
    );
    const list = KINDS[kind].list;
    Object.assign(next, { [list]: (listOf(next, kind) as Timed[]).flatMap((other) => (other.id === item.id ? [head, tail] : [other])) });
    tails.push({ kind, id: tail.id });
  }
  return tails.length ? withJoins(scene, { edits: next, pick: picked(...tails) }) : null;
}

// Every Segment, Text Layer, Shape, Music Clip and Overlay the playhead at `time` is inside, but on locked Tracks.
function under(scene: PickContext, time: number): ItemRef[] {
  const locked = scene.locked ?? [];
  return itemsOf(pickAll(scene.edits)).filter((ref) => !locked.includes(TRACK_OF[ref.kind]) && inside(scene, ref, time));
}

/** Whether Split can cut at `time`: a picked item there, or with nothing picked, any item there (Split all). */
export function canSplitAt(scene: PickContext, time: number): boolean {
  return scene.pick === null ? under(scene, time).length > 0 : canSplit(scene, time);
}

/**
 * Split at the playhead (`at`): the picked items there, or with nothing picked every Segment, Text
 * Layer, Shape, Music Clip and Overlay there (Split all, GLOSSARY.md). The hook is never split.
 */
export function splitAt(scene: PickContext, at: number): Outcome | null {
  if (scene.pick !== null) return split(scene, at);
  const items = under(scene, at);
  return items.length ? split({ ...scene, pick: picked(...items) }, at) : null;
}

/** How long a new Freeze frame holds its frame. */
export const FREEZE_SECS = 1;

// The index of the Segment a Freeze frame can be made of at `time`: the one the playhead is inside,
// SEGMENT_MIN_SECS from its edges, not itself a Freeze frame and not on a locked Track; else -1.
function freezable(scene: PickContext, time: number): number {
  if (scene.locked?.includes(TRACK_OF.segment)) return -1;
  return scene.edits.segments.findIndex((segment) => inside(scene, { kind: "segment", id: segment.id }, time));
}

/** Whether Freeze frame can be made at `time`: the playhead inside a Segment, SEGMENT_MIN_SECS from its edges. */
export const canFreezeAt = (scene: PickContext, time: number) => freezable(scene, time) !== -1;

/**
 * Freeze frame at the playhead (`at`, docs/adr/0009): the Segment there split into a head, a Freeze
 * frame of FREEZE_SECS holding the frame shown at the playhead (at any Speed, in Reverse), and a
 * tail, the Freeze frame picked. The cut is at that frame, a Source Segment's too (not between Words
 * as Split's), so nothing is played twice or skipped. Keyframes are re-anchored on head and tail; a
 * video's Freeze frame takes its Framing as shown there, its Keyframes sampled into constants, and
 * every part keeps the Segment's Grade. A Transition after the Segment stays after the tail. The Main Track gets FREEZE_SECS longer at the
 * playhead, and on the Magnetic timeline the layers after it play later. Refused, with a notice, past the `longest` clip; null where none can be made.
 */
export function freezeFrame(scene: PickContext, at: number, limits: { longest?: number } = {}): Outcome | null {
  const { edits } = scene;
  const index = freezable(scene, at);
  if (index === -1) return null;
  if (limits.longest !== undefined && scene.duration + FREEZE_SECS > limits.longest + 1e-6) {
    const notice = `A clip can last at most ${limits.longest} s: a Freeze frame would make this one ${Math.round(scene.duration + FREEZE_SECS)} s.`;
    return { edits, pick: scene.pick, notice };
  }
  const segment = edits.segments[index];
  const shown = scene.played[index];
  // The head ends and the tail begins on the held frame: the backend leaves a Source Segment's end
  // that touches a held Segment of its time unsnapped.
  const cut = Math.round(playedSourceAt(shown, at) * 1000) / 1000;
  const length = segmentLength(segment);
  const into = offsetAt(segment, cut);
  // Where the cut is on the Timeline, which the Freeze frame goes in at.
  const cutAt = playedTimeAt(shown, cut);
  // On the Timeline the head plays first: in Reverse, the later part of the range.
  const [headRange, tailRange] = segment.reverse
    ? [{ start: cut, end: segment.end }, { start: segment.start, end: cut }]
    : [{ start: shown.source_start, end: cut }, { start: cut, end: segment.end }];
  const [head, tail] = cutFades(
    segment,
    rekeyed<ClipSegment>({ ...segment, ...headRange }, into - (cutAt - shown.start), into),
    rekeyed<ClipSegment>({ ...segment, ...tailRange, id: idOf(scene) }, into, length),
  );
  const held: ClipSegment = { id: idOf(scene), start: cut, end: cut, hold: FREEZE_SECS };
  // The held frame in its Segment's colour.
  if (segment.grade) held.grade = segment.grade;
  if (segment.media) {
    held.media = segment.media;
    held.volume = segment.volume;
    if (segment.framing) held.framing = { ...segment.framing, transform: heldTransform(segment.framing.transform, segment.keys ?? {}, at - shown.start) };
  }
  const next = {
    ...edits,
    segments: edits.segments.flatMap((other) => (other.id === segment.id ? [head, held, tail] : [other])),
    transitions: edits.transitions.map((transition) => (transition.after === segment.id ? { ...transition, after: tail.id } : transition)),
  };
  return withJoins(scene, {
    edits: rippledIf(next, [{ kind: "inserted", at: cutAt, secs: FREEZE_SECS }], scene.magnetic ?? false).edits,
    pick: picked({ kind: "segment", id: held.id }),
  });
}

// A video's Transform as it is shown `at` seconds into its Segment, its Keyframes sampled into
// constants; a turn past ±360° (a Keyframe's may be) as the same turn within it.
function heldTransform(transform: Transform, keys: Keys, at: number): Transform {
  const shown = shownTransform(transform, keys, at);
  return Math.abs(shown.rotation) > 360 ? { ...shown, rotation: shown.rotation % 360 } : shown;
}

/**
 * A Freeze frame's hold set to `secs` (its Duration field), a change at its end: at least
 * MEDIA_MIN_SECS, and no longer than keeps the Clip within the `longest` clip. Its Keyframes past a
 * shorter end are re-anchored away. The Main Track closes up or opens out after it, and on the
 * Magnetic timeline the layers follow. Null for a Segment that isn't one.
 */
export function setHold(scene: PickContext, id: string, secs: number, limits: { longest?: number } = {}): Outcome | null {
  const { edits, pick } = scene;
  const index = edits.segments.findIndex((other) => other.id === id);
  const segment = edits.segments[index];
  if (!segment || segment.hold == null) return null;
  const most = limits.longest === undefined ? Infinity : limits.longest - (scene.duration - segment.hold);
  const hold = Math.round(Math.max(Math.min(secs, most), MEDIA_MIN_SECS) * 1000) / 1000;
  const next = { ...edits, segments: edits.segments.map((other) => (other.id === id ? rekeyed({ ...segment, hold }, 0, hold) : other)) };
  return { ...rippledAtEnd(scene, next, index, segment.hold, hold), pick };
}

// `next`, Segment `index` of the scene's edits `before` long on the Timeline and `after` long now,
// with the layers following its end on the Magnetic timeline, and what to tell of those its cut took.
function rippledAtEnd(scene: PickContext, next: AdvancedEdits, index: number, before: number, after: number): { edits: AdvancedEdits; notice?: string } {
  const end = (scene.played[index]?.start ?? 0) + before;
  const change: TrackChange = after < before ? { kind: "removed", at: end - (before - after), secs: before - after } : { kind: "inserted", at: end, secs: after - before };
  return rippledIf(next, [change], (scene.magnetic ?? false) && Math.abs(after - before) > 1e-6, scene.duration);
}

/** Freeze frame at the playhead, from the item tools and Shift+F: see freezeFrame. */
export interface Freezer {
  canFreeze: (time: number) => boolean;
  freeze: () => void;
}

/** Freeze frame at the playhead (`now`), its outcome applied (`apply`) as one change. */
export function freezer(scene: PickContext, now: () => number, apply: (outcome: Outcome) => void, limits: { longest?: number } = {}): Freezer {
  return {
    canFreeze: (time) => canFreezeAt(scene, time),
    freeze: () => {
      const outcome = freezeFrame(scene, now(), limits);
      if (outcome) apply(outcome);
    },
  };
}

/**
 * The picked Text Layers, Shapes, Music Clips and Overlays moved `delta` seconds later (earlier when
 * it is negative), as a group: no further than keeps them all inside the Clip. Picked Segments stay.
 */
export function move(scene: PickContext, delta: number): Outcome | null {
  const { layers } = pickedItems(scene);
  if (!layers.length) return null;
  const first = Math.min(...layers.map(({ item }) => item.start));
  const end = Math.max(...layers.map(({ item }) => Math.min(item.start + item.secs, scene.duration)));
  const by = Math.min(Math.max(delta, -first), scene.duration - end);
  const next = { ...scene.edits };
  for (const { kind, item } of layers) {
    const list = KINDS[kind].list;
    Object.assign(next, { [list]: (listOf(next, kind) as Timed[]).map((other) => (other.id === item.id ? { ...other, start: round(other.start + by) } : other)) });
  }
  return { edits: next, pick: scene.pick };
}

// The output's size, in pixels: where the middles of Text Layers, Shapes and Overlays can be.
const FRAME = { width: 1080, height: 1920 };

// What is placed on the frame by its Transform: a Text Layer, a Shape or an Overlay.
type Placed = TextLayer | Shape | Overlay;

// Where a Text Layer's, a Shape's or an Overlay's middle is on the frame (its Transform has it), and
// the item with its middle at (x, y).
const middleOf = (item: Placed) => item.transform;
const middledAt = <T extends Placed>(item: T, x: number, y: number): T => ({ ...item, transform: { ...item.transform, x, y } });

// Where a keyed Text Layer's, Shape's or Overlay's middle goes along `axis`: its Keyframes' values.
const keyedMiddles = (item: Placed, axis: "x" | "y") => (item.keys[axis] ?? []).map((key) => key.value);

/**
 * The picked Text Layers, Shapes and Overlays moved on the frame by (`dx`, `dy`) output pixels, together: no
 * further than keeps each one's middle in the frame. A keyed one's motion moves with it: each of its
 * x and y Keyframes by as much, kept in the frame as its middle is.
 */
export function nudge(scene: PickContext, dx: number, dy: number): Outcome | null {
  const placed = pickedItems(scene).layers.filter(({ kind }) => isPlaced(kind)) as { kind: PlacedKind; item: Placed }[];
  if (!placed.length) return null;
  const within = (by: number, values: number[], size: number) => Math.min(Math.max(by, -Math.min(...values)), size - Math.max(...values));
  const byX = within(dx, placed.flatMap(({ item }) => [middleOf(item).x, ...keyedMiddles(item, "x")]), FRAME.width);
  const byY = within(dy, placed.flatMap(({ item }) => [middleOf(item).y, ...keyedMiddles(item, "y")]), FRAME.height);
  const shifted = (keys: Keyframe[], by: number) => keys.map((key) => ({ ...key, value: toMillionth(key.value + by) }));
  const next = { ...scene.edits };
  for (const { kind, item } of placed) {
    const list = KINDS[kind].list;
    Object.assign(next, {
      [list]: (listOf(next, kind) as Placed[]).map((other) => {
        if (other.id !== item.id) return other;
        const { x, y } = middleOf(other);
        const moved = middledAt(other, Math.round(x + byX), Math.round(y + byY));
        if (!(moved.keys.x || moved.keys.y)) return moved;
        const { x: xs, y: ys } = moved.keys;
        return { ...moved, keys: { ...moved.keys, ...(xs && { x: shifted(xs, byX) }), ...(ys && { y: shifted(ys, byY) }) } };
      }),
    });
  }
  return { edits: next, pick: scene.pick };
}

/** The value `read` gives of every one of `layers` (Text Layers, Shapes), or undefined where they differ (mixed). */
export function shared<T, V>(layers: T[], read: (layer: T) => V): V | undefined {
  const [first, ...rest] = layers;
  return first && rest.every((layer) => read(layer) === read(first)) ? read(first) : undefined;
}

/** Every picked Text Layer changed by `change` (its style's colour set, say). */
export function restyle(scene: { edits: AdvancedEdits; pick: Pick }, change: (layer: TextLayer) => TextLayer): Outcome {
  const text_layers = scene.edits.text_layers.map((layer) => (isPicked(scene.pick, "text", layer.id) ? change(layer) : layer));
  return { edits: { ...scene.edits, text_layers }, pick: scene.pick };
}

/** Every picked Shape changed by `change` (its Shape Style's fill set, say), as `restyle` changes Text Layers. */
export function reshape(scene: { edits: AdvancedEdits; pick: Pick }, change: (shape: Shape) => Shape): Outcome {
  const shapes = scene.edits.shapes.map((shape) => (isPicked(scene.pick, "shape", shape.id) ? change(shape) : shape));
  return { edits: { ...scene.edits, shapes }, pick: scene.pick };
}

/**
 * Every picked Segment's, Overlay's and Adjustment Layer's Grade (ADR 0013) with the dials of `change` set, its other dials
 * kept; or with `change` "reset", neutral again. One change, however many are picked. With nothing
 * picked, the Candidate's own Grade instead. Null with only other items picked.
 */
export function regrade(scene: { edits: AdvancedEdits; pick: Pick }, change: Partial<Adjust> | "reset"): Outcome | null {
  return regraded(scene, (grade) => (change === "reset" ? NEUTRAL_GRADE : adjusted(grade, change)));
}

/**
 * Every picked Segment's, Overlay's and Adjustment Layer's Grade given the Look of `change` (null: none, its Adjust kept),
 * its intensity, or both: a Filters card's click, or the Color section's Look picker and intensity.
 * One change, however many are picked; with nothing picked, the Candidate's own Grade. Null with only
 * other items picked. A card's hover draws the preview from it, never saving it.
 */
export function relook(scene: { edits: AdvancedEdits; pick: Pick }, change: { look?: string | null; intensity?: number }): Outcome | null {
  return regraded(scene, (grade) => relooked(grade, change));
}

/** The id `gradesOf` gives the Candidate's own Grade, with nothing picked. */
export const CLIP_GRADE_ID = "clip";

/**
 * What `regrade` and `relook` change, by id: the picked Segments, Overlays and Adjustment Layers (in
 * that order) with their Grades, or with nothing picked the Candidate's Grade, by CLIP_GRADE_ID. Empty
 * with only other items picked.
 */
export function gradesOf(scene: { edits: AdvancedEdits; pick: Pick }): { id: string; grade?: Grade }[] {
  const { edits, pick } = scene;
  if (pick === null) return [{ id: CLIP_GRADE_ID, grade: edits.grade }];
  return [
    ...edits.segments.filter((segment) => isPicked(pick, "segment", segment.id)),
    ...edits.overlays.filter((overlay) => isPicked(pick, "overlay", overlay.id)),
    ...listOf(edits, "adjustment").filter((layer) => isPicked(pick, "adjustment", layer.id)),
  ];
}

// The Pick's Grades, or the Candidate's with nothing picked, each made `change` of what it was.
function regraded(scene: { edits: AdvancedEdits; pick: Pick }, change: (grade: Grade | undefined) => Grade): Outcome | null {
  const { edits, pick } = scene;
  if (pick === null) return { edits: { ...edits, grade: change(edits.grade) }, pick };
  const graded = <T extends ClipSegment | Overlay>(items: T[], kind: "segment" | "overlay"): T[] =>
    items.some((item) => isPicked(pick, kind, item.id)) ? items.map((item) => (isPicked(pick, kind, item.id) ? { ...item, grade: change(item.grade) } : item)) : items;
  const segments = graded(edits.segments, "segment");
  const overlays = graded(edits.overlays, "overlay");
  const layers = listOf(edits, "adjustment");
  const adjustment_layers = layers.some((layer) => isPicked(pick, "adjustment", layer.id))
    ? layers.map((layer) => (isPicked(pick, "adjustment", layer.id) ? { ...layer, grade: change(layer.grade) } : layer))
    : edits.adjustment_layers;
  if (segments === edits.segments && overlays === edits.overlays && adjustment_layers === edits.adjustment_layers) return null;
  return { edits: { ...edits, segments, overlays, ...(adjustment_layers && { adjustment_layers }) }, pick };
}

/** Every picked Text Layer given `style`, a Text Preset's Text Style: their words, Transforms, Keyframes and times stay their own. */
export const applyTextStyle = (scene: { edits: AdvancedEdits; pick: Pick }, style: TextStyle): Outcome => restyle(scene, (layer) => ({ ...layer, style }));

/**
 * The captions' look set from the inspector's Caption Style panel or Preset bar: the Candidate's Style
 * Preset and Style Overrides as `look` has them, one change. Null while the Captions Track is locked.
 */
export function restyleCaptions(scene: { edits: AdvancedEdits; pick: Pick; locked?: TrackKind[] }, look: StyleDraft): Outcome | null {
  if (scene.locked?.includes("captions")) return null;
  return { edits: { ...scene.edits, preset_id: look.preset_id, style_overrides: look.style_overrides }, pick: scene.pick };
}

/**
 * Music Clip or Segment `item`'s volume set to `volume`, rounded to 0.01 and kept within 0–2 (by its
 * Volume Line or the inspector); a Source Segment's under the Clip's own sound. Null for a Freeze
 * frame of the Source, which is silent, or for an item that isn't there.
 */
export function setVolume(scene: { edits: AdvancedEdits; pick: Pick }, item: { kind: "music" | "segment"; id: string }, volume: number): Outcome | null {
  const { edits, pick } = scene;
  const level = Math.round(Math.min(Math.max(volume, 0), 2) * 100) / 100;
  const set = <T extends { id: string }>(items: T[]) => items.map((other) => (other.id === item.id ? { ...other, volume: level } : other));
  if (item.kind === "music") return edits.music.some((clip) => clip.id === item.id) ? { edits: { ...edits, music: set(edits.music) }, pick } : null;
  const heard = edits.segments.some((segment) => segment.id === item.id && (segment.media || segment.hold == null));
  return heard ? { edits: { ...edits, segments: set(edits.segments) }, pick } : null;
}

/**
 * M on the Pick (GLOSSARY.md, Muted): its items with sound all Muted when any of them is heard, else
 * all unmuted, keeping their volume, Keyframes and fades. Text Layers, Shapes, Freeze frames, images
 * and videos without sound (`sounded` says whether a Media Library item has sound) are left alone, as
 * are the hook, the captions and a join. Null when none with sound is picked.
 */
export function toggleMute(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean): Outcome | null {
  const { edits, pick } = scene;
  const chosen = new Set(pickedSounds(scene, sounded));
  if (!chosen.size) return null;
  const muted = [...chosen].some((item) => !item.muted);
  const set = <T extends { muted?: boolean }>(items: T[]) => items.map((item) => (chosen.has(item) ? { ...item, muted } : item));
  return { edits: { ...edits, segments: set(edits.segments), music: set(edits.music), overlays: set(edits.overlays) }, pick };
}

// The picked items with sound, which M Mutes or unmutes (toggleMute).
function pickedSounds({ edits, pick }: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean): { muted?: boolean }[] {
  return [
    ...edits.segments.filter((segment) => isPicked(pick, "segment", segment.id) && segment.hold == null && (!segment.media || sounded(segment.media))),
    ...edits.music.filter((clip) => isPicked(pick, "music", clip.id)),
    ...edits.overlays.filter((overlay) => isPicked(pick, "overlay", overlay.id) && sounded(overlay.media)),
  ];
}

// The phone's toolbar Mute: `muted` once every picked item with sound is Muted, when it reads Unmute.
export interface Muter {
  muted: boolean;
  toggle: () => void;
}

/**
 * The phone's toolbar Mute of the Pick, by M's rule (toggleMute), its outcome applied (`apply`) as one
 * change. Null when nothing with sound is picked: the button is then off.
 */
export function muter(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean, apply: (outcome: Outcome) => void): Muter | null {
  const sounds = pickedSounds(scene, sounded);
  if (!sounds.length) return null;
  return {
    muted: sounds.every((item) => item.muted),
    toggle: () => {
      const outcome = toggleMute(scene, sounded);
      if (outcome) apply(outcome);
    },
  };
}

/**
 * Music Clip `id`'s Duck under speech (GLOSSARY.md, Ducking): off with null, else on at `duck` dB, a
 * whole number from DUCK_MIN to DUCK_MAX. Null for a Music Clip of the Source or one marked Speech,
 * which are never Ducked, or one that isn't there.
 */
export function setDuck(scene: { edits: AdvancedEdits; pick: Pick }, id: string, duck: number | null): Outcome | null {
  const { edits, pick } = scene;
  if (!edits.music.some((clip) => clip.id === id && clip.media !== null && !clip.speech)) return null;
  const depth = duck === null ? null : Math.min(Math.max(Math.round(duck), DUCK_MIN), DUCK_MAX);
  return { edits: { ...edits, music: edits.music.map((clip) => (clip.id === id ? { ...clip, duck: depth } : clip)) }, pick };
}

/**
 * Music Clip `id` marked Speech or not (GLOSSARY.md, Speech; ADR 0018), in one change: switched on, its
 * Duck is cleared too, since a Music Clip that is speech is never Ducked. Null for a Music Clip of the
 * Source, whose Words are its speech, or one that isn't there.
 */
export function setSpeech(scene: { edits: AdvancedEdits; pick: Pick }, id: string, speech: boolean): Outcome | null {
  const { edits, pick } = scene;
  if (!edits.music.some((clip) => clip.id === id && clip.media !== null)) return null;
  const marked = (clip: MusicClip): MusicClip => (speech ? { ...clip, speech, duck: null } : { ...clip, speech });
  return { edits: { ...edits, music: edits.music.map((clip) => (clip.id === id ? marked(clip) : clip)) }, pick };
}

/**
 * A Take landed (GLOSSARY.md, Take; ADR 0018): one change that adds a Music Clip of its item `media`
 * at `start` for `secs`, marked Speech and not Ducked, whole and at full volume; the Timeline lays it
 * on the Music Track's lowest free lane. It is Picked, and `id` names it. Undone, the Music Clip goes
 * and the item stays.
 */
export function landTake(scene: { edits: AdvancedEdits }, take: LandedTake, ids: () => string = newId): Outcome & { id: string } {
  const clip: MusicClip = {
    id: ids(),
    media: take.media,
    start: round(Math.max(0, take.start)),
    secs: round(take.secs),
    offset: 0,
    volume: 1,
    fade_in: 0,
    fade_out: 0,
    keys: {},
    duck: null,
    speech: true,
  };
  return { edits: { ...scene.edits, music: [...scene.edits.music, clip] }, pick: picked({ kind: "music", id: clip.id }), id: clip.id };
}

/**
 * Whether Segment `id` can be Detached (GLOSSARY.md, Detach): it has a sound of its own to move off,
 * which a Freeze frame, a Muted Segment and a video without sound (`sounded` says whether a Media
 * Library item has sound) don't, and no Music Clip is Detached from it already.
 */
export function canDetach(edits: AdvancedEdits, id: string, sounded: (media: string) => boolean): boolean {
  const segment = edits.segments.find((other) => other.id === id);
  if (!segment || segment.hold != null || segment.muted || (segment.media && !sounded(segment.media))) return false;
  return !edits.music.some((clip) => clip.detached_from === id);
}

/** Whether Reattach is offered for Segment `id`: while it is there and some Music Clip is Detached from it. */
export const canReattach = (edits: AdvancedEdits, id: string) =>
  edits.segments.some((segment) => segment.id === id) && edits.music.some((clip) => clip.detached_from === id);

// Seconds to the thousandth, as a Segment's cut is: what Detach places a Music Clip by, so that it is
// heard where its Segment was.
const toThousandth = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Detach (GLOSSARY.md, ADR 0016) on Segments `ids` that allow it (canDetach), as one change: each one's
 * sound onto a new Music Clip of it (the Source's for a Segment of the episode, the video's for a
 * video's), and the Segment Muted. The Music Clip is heard as the Segment was, as planned (`track`:
 * snapped to Words, a Transition's overlap included): from where its sound starts on the Timeline, as
 * long, its range, Speed, pitch, Reverse, volume, fades, volume Keyframes (the same `at`) and Audio
 * Effects, with `detached_from`. It lands on the first Music lane free there. The new Music Clips are picked; null
 * when none of the Segments allows it.
 */
export function detach(scene: PickContext, ids: string[], track: PlayedSegment[], sounded: (media: string) => boolean): Outcome | null {
  const { edits } = scene;
  const made: MusicClip[] = [];
  edits.segments.forEach((segment, i) => {
    const shown = track[i];
    if (!shown || !ids.includes(segment.id) || !canDetach(edits, segment.id, sounded)) return;
    const secs = toThousandth(shown.end - shown.start);
    const clip: MusicClip = {
      id: idOf(scene),
      media: segment.media ?? null,
      start: toThousandth(shown.start),
      secs,
      offset: toThousandth(rangeOf(shown).start),
      volume: segment.volume ?? 1,
      speed: segment.speed ?? 1,
      pitch: segment.pitch ?? false,
      reverse: segment.reverse ?? false,
      ...fadesWithin({ fade_in: segment.fade_in ?? 0, fade_out: segment.fade_out ?? 0 }, secs),
      keys: segment.keys?.volume?.length ? { volume: segment.keys.volume } : {},
      // Its Audio Effects (ADR 0017), switched-off entries too; the Segment keeps its own for Reattach.
      ...(segment.audio_effects?.length ? { audio_effects: segment.audio_effects } : {}),
      detached_from: segment.id,
      // Speech isn't ducked: said so, so that the server's default for a new song doesn't apply (ADR 0016).
      duck: null,
    };
    made.push(rekeyed(clip, 0, secs));
  });
  if (!made.length) return null;
  const detached = new Set(made.map((clip) => clip.detached_from));
  return {
    edits: {
      ...edits,
      segments: edits.segments.map((segment) => (detached.has(segment.id) ? { ...segment, muted: true } : segment)),
      music: [...edits.music, ...made],
    },
    pick: picked(...made.map((clip) => ({ kind: "music" as const, id: clip.id }))),
  };
}

/**
 * Reattach (GLOSSARY.md, Detach) of Segment `id`, as one change: every Music Clip Detached from it
 * deleted, however it was moved, trimmed or split since, and the Segment unmuted. Nothing changed on
 * them is copied back. The Segment is picked; null where it isn't offered (canReattach).
 */
export function reattach(scene: { edits: AdvancedEdits; pick: Pick }, id: string): Outcome | null {
  const { edits } = scene;
  if (!canReattach(edits, id)) return null;
  return {
    edits: {
      ...edits,
      segments: edits.segments.map((segment) => (segment.id === id ? { ...segment, muted: false } : segment)),
      music: edits.music.filter((clip) => clip.detached_from !== id),
    },
    pick: picked({ kind: "segment", id }),
  };
}

/** Detach and Reattach from an item's context menu and the inspector: see detach and reattach. */
export interface Detacher {
  canDetach: (id: string) => boolean;
  canReattach: (id: string) => boolean;
  // Segment `id`'s sound Detached, and that of the other picked Segments when it is picked with them.
  detach: (id: string) => void;
  reattach: (id: string) => void;
}

/** Detach and Reattach in `scene`, the Main Track as planned being `track`, each outcome applied (`apply`) as one change. */
export function detacher(scene: PickContext, track: PlayedSegment[], sounded: (media: string) => boolean, apply: (outcome: Outcome) => void): Detacher {
  const run = (outcome: Outcome | null) => outcome && apply(outcome);
  return {
    canDetach: (id) => canDetach(scene.edits, id, sounded),
    canReattach: (id) => canReattach(scene.edits, id),
    detach: (id) => {
      const ids = isPicked(scene.pick, "segment", id) ? pickedItems(scene).segments.map((segment) => segment.id) : [id];
      run(detach(scene, ids, track, sounded));
    },
    reattach: (id) => run(reattach(scene, id)),
  };
}

/**
 * `item`, a Music Clip new to the Candidate (a part of a split, a copy, a paste), still Detached from
 * its Segment while `segments` have it, else no longer: the API takes a new `detached_from` only when
 * it names a Segment of the Candidate. Any other item as it is.
 */
export function stillDetached<T extends object>(item: T, segments: ClipSegment[]): T {
  const from = "detached_from" in item ? (item.detached_from as string | null | undefined) : undefined;
  return from && !segments.some((segment) => segment.id === from) ? { ...item, detached_from: null } : item;
}

/** A Segment, a video Overlay or a Music Clip, which has a Speed. */
export type SpeedRef = { kind: "segment" | "overlay" | "music"; id: string };

/**
 * Segment, video Overlay or Music Clip `item`'s Speed set to `speed` (speedOf), a trim at its end (ADR
 * 0009, 0016): its Keyframes scaled by the old Speed ÷ the new, so that they stay on the same frames
 * (or moments of its song). A Segment keeps its range and plays it in its new Timeline length; the
 * Main Track closes up or opens out after it, and on the Magnetic timeline the layers follow as they
 * follow a trim of its end. Refused, with a notice, when a video's Segment would play under
 * MEDIA_MIN_SECS or the Clip would last longer than the `longest` clip. An Overlay or a Music Clip
 * keeps its start and plays as much of its file, its end kept within the file (`video` seconds long,
 * its video's or song's), a Music Clip's fades within it. Null for a Freeze frame, or an item that
 * isn't there.
 */
export function setSpeed(scene: PickContext, item: SpeedRef, value: number, limits: { longest?: number; video?: number } = {}): Outcome | null {
  const { edits, pick } = scene;
  const speed = speedOf(value);
  const sped = <T extends Overlay | MusicClip>(timed: T): T => {
    const by = (timed.speed ?? 1) / speed;
    const room = limits.video === undefined ? Infinity : (limits.video - timed.offset) / speed;
    const secs = round(Math.max(Math.min(timed.secs * by, room), ITEM_MIN_SECS));
    return rekeyed({ ...timed, speed, secs, keys: scaledKeys(timed.keys, by) }, 0, secs);
  };
  if (item.kind === "overlay") {
    if (!edits.overlays.some((other) => other.id === item.id)) return null;
    return { edits: { ...edits, overlays: edits.overlays.map((other) => (other.id === item.id ? sped(other) : other)) }, pick };
  }
  if (item.kind === "music") {
    if (!edits.music.some((other) => other.id === item.id)) return null;
    const fitted = (clip: MusicClip) => ({ ...clip, ...fadesWithin(clip, clip.secs) });
    return { edits: { ...edits, music: edits.music.map((other) => (other.id === item.id ? fitted(sped(other)) : other)) }, pick };
  }
  const index = edits.segments.findIndex((other) => other.id === item.id);
  const segment = edits.segments[index];
  if (!segment || segment.hold != null) return null;
  const by = (segment.speed ?? 1) / speed;
  // Its fades fitted to its new length.
  const atSpeed = fadesFitted({ ...segment, speed, ...(segment.keys && { keys: scaledKeys(segment.keys, by) }) });
  const [before, after] = [segmentLength(segment), segmentLength(atSpeed)];
  const refused = (notice: string): Outcome => ({ edits, pick, notice });
  if (segment.media && after < MEDIA_MIN_SECS) {
    return refused(`A video's Segment lasts ${MEDIA_MIN_SECS} s at least: at ${speedLabel(speed)} this one would last ${after.toFixed(2)} s.`);
  }
  const length = scene.duration + after - before;
  if (limits.longest !== undefined && length > limits.longest + 1e-6) {
    return refused(`A clip can last at most ${limits.longest} s: at ${speedLabel(speed)} this one would last ${Math.round(length)} s.`);
  }
  const next = { ...edits, segments: edits.segments.map((other) => (other.id === item.id ? atSpeed : other)) };
  return { ...rippledAtEnd(scene, next, index, before, after), pick };
}

/**
 * A gesture's setSpeed: each step of one gesture (the slider, the chips and the field, by `group`)
 * made from the edits as it began, so that sliding through a slow Speed and back brings back the
 * layers its ripple cut and the Keyframes it crowded. Edits changed since its last step (an undo,
 * another editor) begin it again. A refused step leaves the edits as they are, with its notice.
 */
export function gestureSpeed() {
  let last: { group: string; origin: PickContext; made: AdvancedEdits } | null = null;
  return (scene: PickContext, item: SpeedRef, speed: number, group: string, limits?: { longest?: number; video?: number }): Outcome | null => {
    const origin = last && last.group === group && last.made === scene.edits ? last.origin : scene;
    const outcome = setSpeed({ ...origin, pick: scene.pick, magnetic: scene.magnetic }, item, speed, limits);
    if (!outcome) return null;
    if (outcome.edits === origin.edits && outcome.notice) return { ...outcome, edits: scene.edits };
    last = { group, origin, made: outcome.edits };
    return outcome;
  };
}

/**
 * The one picked Segment, video Overlay or Music Clip, which Reverse (R) turns on or off: null with
 * nothing or several picked, or for a Freeze frame (it holds one frame), an image Overlay (`video`
 * says whether a Media Library item is a video), a Text Layer or a Shape.
 */
export function reversible(scene: { edits: AdvancedEdits; pick: Pick }, video: (media: string) => boolean): SpeedRef | null {
  const only = onlyItem(scene.pick);
  const { segments, overlays, music } = scene.edits;
  if (only?.kind === "segment" && segments.some((segment) => segment.id === only.id && segment.hold == null)) return { kind: "segment", id: only.id };
  if (only?.kind === "overlay" && overlays.some((overlay) => overlay.id === only.id && video(overlay.media))) return { kind: "overlay", id: only.id };
  if (only?.kind === "music" && music.some((clip) => clip.id === only.id)) return { kind: "music", id: only.id };
  return null;
}

/**
 * The one picked Segment, video Overlay or Music Clip, whose Speed sheet the phone's toolbar opens: as
 * `reversible`, and a Freeze frame too (its sheet shows its Duration).
 */
export function speedSheetItem(scene: { edits: AdvancedEdits; pick: Pick }, video: (media: string) => boolean): SpeedRef | null {
  const only = onlyItem(scene.pick);
  if (only?.kind === "segment" && scene.edits.segments.some((segment) => segment.id === only.id)) return { kind: "segment", id: only.id };
  return reversible(scene, video);
}

/**
 * Segment, video Overlay or Music Clip `item` played backwards, or forwards again (`reverse`, ADR
 * 0009), from a Retimed copy. It keeps its range and its place and length on the Timeline. Its
 * Keyframes are mirrored (mirroredKeys), so that its motion stays on the same frames of its video (a
 * song's volume on the same moments of it), as a Speed change scales them. Null for a Freeze frame,
 * or an item that isn't there.
 */
export function setReverse(scene: { edits: AdvancedEdits; pick: Pick }, item: SpeedRef, reverse: boolean): Outcome | null {
  const { edits, pick } = scene;
  const turned = <T extends { reverse?: boolean; keys?: Keys }>(other: T, length: number): T =>
    other.keys && reverse !== (other.reverse ?? false) ? { ...other, reverse, keys: mirroredKeys(other.keys, length) } : { ...other, reverse };
  if (item.kind === "overlay") {
    if (!edits.overlays.some((other) => other.id === item.id)) return null;
    return { edits: { ...edits, overlays: edits.overlays.map((other) => (other.id === item.id ? turned(other, other.secs) : other)) }, pick };
  }
  if (item.kind === "music") {
    if (!edits.music.some((other) => other.id === item.id)) return null;
    return { edits: { ...edits, music: edits.music.map((other) => (other.id === item.id ? turned(other, other.secs) : other)) }, pick };
  }
  if (!edits.segments.some((other) => other.id === item.id && other.hold == null)) return null;
  return { edits: { ...edits, segments: edits.segments.map((other) => (other.id === item.id ? turned(other, segmentLength(other)) : other)) }, pick };
}

/**
 * Music Clip or Segment `id`'s fade in or fade out (`fade`) set to `secs` (by its Fade Ramp's handle
 * or the inspector), rounded to a hundredth: 0–10 s, and no further than where the other fade begins,
 * so that the two together are never longer than it (a Segment, on the Timeline). Cut short by the
 * Clip's end, or heard on under a Transition (`heard` seconds of it are heard), both are set as they
 * are heard, so that what is stored is what the Timeline draws and the Clip plays. Null for a Freeze
 * frame, which is silent, or an item that isn't there.
 */
export function setFade(
  scene: { edits: AdvancedEdits; pick: Pick },
  id: string,
  fade: "fade_in" | "fade_out",
  secs: number,
  heard?: number,
): Outcome | null {
  const { edits, pick } = scene;
  const clip = edits.music.find((other) => other.id === id);
  const segment = edits.segments.find((other) => other.id === id && other.hold == null);
  const item = clip ?? segment;
  if (!item) return null;
  const length = heard ?? (clip ? clip.secs : segmentLength(item as ClipSegment));
  // Its fades as heard: shortened when it is shorter than both (`length` seconds of it).
  const fades = fadesWithin({ fade_in: item.fade_in ?? 0, fade_out: item.fade_out ?? 0 }, length);
  const other = fade === "fade_in" ? "fade_out" : "fade_in";
  const most = Math.max(0, Math.min(FADE_MAX_SECS, length - fades[other]));
  const set = <T extends { id: string }>(items: T[]) =>
    items.map((each) => (each.id === id ? { ...each, [other]: fades[other], [fade]: round(Math.min(Math.max(secs, 0), most)) } : each));
  return { edits: clip ? { ...edits, music: set(edits.music) } : { ...edits, segments: set(edits.segments) }, pick };
}

// Segment `segment` with its fades within its Timeline length (fadesWithin), when it has any: trimmed or
// sped up shorter than both, it has them shortened by the same share.
function fadesFitted(segment: ClipSegment): ClipSegment {
  if (!segment.fade_in && !segment.fade_out) return segment;
  return { ...segment, ...fadesWithin({ fade_in: segment.fade_in ?? 0, fade_out: segment.fade_out ?? 0 }, segmentLength(segment)) };
}

// The `head` and `tail` faded Segment `segment` is cut into (by Split or a Freeze frame), as a Music
// Clip's are: the head keeps its fade in and the tail its fade out, each within its part, and no
// fades at the cut.
function cutFades(segment: ClipSegment, head: ClipSegment, tail: ClipSegment): [ClipSegment, ClipSegment] {
  if (!segment.fade_in && !segment.fade_out) return [head, tail];
  return [fadesFitted({ ...head, fade_out: 0 }), fadesFitted({ ...tail, fade_in: 0 })];
}

/**
 * Music Clip `clip` (moved, trimmed, or played from elsewhere in its song) put in place of the one
 * with its id; trimmed shorter than its fades, they are shortened with it (see fadesWithin).
 */
export function changeMusic(scene: { edits: AdvancedEdits; pick: Pick }, clip: MusicClip): Outcome {
  const { edits, pick } = scene;
  const fitted = { ...clip, ...fadesWithin(clip, clip.secs) };
  return { edits: { ...edits, music: edits.music.map((each) => (each.id === clip.id ? fitted : each)) }, pick };
}

/** Which part of an item a change on the Timeline or in the inspector moves: all of it, or one edge. */
export type TimedEdge = "move" | "start" | "end";

/**
 * `next`, item `origin` moved or with an edge trimmed (`edge`), its Keyframes re-anchored from
 * `origin`'s: a later start moves them earlier by as much, and one cut off either end leaves one at
 * the edge with the value there (keyActions.ts' rewindow). Moved, they move with it, but those past a
 * shorter end. Longer, it keeps them on the same moments. A Segment, from `start` to `end` of its
 * file, is trimmed the same way: a later `start` cuts as much off its head.
 */
export function retimed<T extends { start: number } & ({ secs: number } | { end: number })>(origin: T, next: T, edge: TimedEdge): T {
  if (!("keys" in origin) || !origin.keys) return next;
  if ("secs" in next) {
    const from = edge === "move" ? 0 : next.start - origin.start;
    return rekeyed({ ...next, keys: origin.keys }, from, from + next.secs);
  }
  // A Segment's, in seconds into it on the Timeline: from where its left edge (its range's start,
  // or end in Reverse) now shows.
  const from = edge === "move" ? 0 : offsetAt(origin as SegmentRange, sourceAt(next as SegmentRange, 0));
  const length = segmentLength(next);
  return rekeyed({ ...next, keys: origin.keys }, from, from + length);
}

/**
 * A gesture's retime: retimed for each step of one gesture (a drag, a slider, arrow keys) named by
 * its `group`, each step made from the item as the gesture began, so that trimming in and back out
 * again brings back the Keyframes cut. An item changed since the last step (an undo, another
 * editor) begins it again.
 */
export function gestureRetime() {
  let last: { group: string; id: string; origin: unknown; made: unknown } | null = null;
  return <T extends { id: string; start: number; secs: number }>(current: T, next: T, edge: TimedEdge, group: string): T => {
    const keysOf = (item: T) => ("keys" in item ? item.keys : undefined);
    const going = last && last.group === group && last.id === current.id && last.made === keysOf(current);
    const origin = going ? (last!.origin as T) : current;
    const made = retimed(origin, next, edge);
    last = { group, id: current.id, origin, made: keysOf(made) };
    return made;
  };
}

/** What can be done to the picked items from the toolbar, the timeline's bar and the keyboard. */
export interface ItemActions {
  remove: () => void;
  // Removes them and closes their gaps (Shift+Delete).
  rippleRemove: () => void;
  duplicate: () => void;
  // Whether a picked item can be split at `time`: when it is inside it.
  canSplit: (time: number) => boolean;
  // At the playhead; nothing when it can't be.
  split: () => void;
  // Onto the Clipboard; cut also removes them.
  copy: () => void;
  cut: () => void;
}

/** Split at the playhead, from the Timeline's bar, the phone's toolbar and Cmd/Ctrl+B: see splitAt. */
export interface Splitter {
  canSplit: (time: number) => boolean;
  split: () => void;
}

/** Split at the playhead (`now`), its outcome applied (`apply`) as one change. */
export function splitter(scene: PickContext, now: () => number, apply: (outcome: Outcome) => void): Splitter {
  return {
    canSplit: (time) => canSplitAt(scene, time),
    split: () => {
      const outcome = splitAt(scene, now());
      if (outcome) apply(outcome);
    },
  };
}

/**
 * The actions on the picked items, when some are, each applied (`apply`) as one change: `now` is the
 * playhead's time, and `clip` puts them on the Clipboard.
 */
export function itemActions(
  scene: PickContext,
  now: () => number,
  apply: (outcome: Outcome) => void,
  clip: { copy: () => void; cut: () => void },
): ItemActions | null {
  if (!itemsOf(scene.pick).length) return null;
  const run = (outcome: Outcome | null) => outcome && apply(outcome);
  return {
    remove: () => run(remove(scene)),
    rippleRemove: () => run(rippleRemove(scene)),
    duplicate: () => run(duplicate(scene)),
    canSplit: (time) => canSplit(scene, time),
    split: () => run(split(scene, now())),
    ...clip,
  };
}

/**
 * A new Adjustment Layer (ADR 0013) with Look `look` at `at` (where a Filters card was dropped on the
 * Timeline): NEW_LAYER_SECS long, or to the Clip's end, at full strength without fades, picked. Null
 * while the Adjust Track is locked, or in a Clip too short for one there.
 */
export function addAdjustmentLayer(scene: PickContext, look: string, at: number): Outcome | null {
  if (scene.locked?.includes("adjust")) return null;
  const start = round(Math.max(0, Math.min(at, scene.duration - ITEM_MIN_SECS)));
  const secs = round(Math.min(NEW_LAYER_SECS, scene.duration - start));
  if (secs < ITEM_MIN_SECS) return null;
  const layer: AdjustmentLayer = { id: idOf(scene), start, secs, grade: relooked(NEUTRAL_GRADE, { look }), strength: 100, fade_in: 0, fade_out: 0 };
  const { edits } = scene;
  return { edits: { ...edits, adjustment_layers: [...listOf(edits, "adjustment"), layer] }, pick: picked({ kind: "adjustment", id: layer.id }) };
}

/**
 * Adjustment Layer `id`'s strength (0..100, whole percents) or fades (each within 0..half its length,
 * to the hundredth) set from the Inspector. Null for a layer that isn't there.
 */
export function setAdjustment(
  scene: { edits: AdvancedEdits; pick: Pick },
  id: string,
  change: { strength?: number; fade_in?: number; fade_out?: number },
): Outcome | null {
  const { edits, pick } = scene;
  const layers = listOf(edits, "adjustment");
  const layer = layers.find((other) => other.id === id);
  if (!layer) return null;
  const half = halfFadeMax(layer.secs);
  const fade = (value: number | undefined, was: number) => (value === undefined ? was : round(Math.min(Math.max(value, 0), half)));
  const next = {
    ...layer,
    strength: change.strength === undefined ? layer.strength : Math.round(Math.min(Math.max(change.strength, 0), 100)),
    fade_in: fade(change.fade_in, layer.fade_in),
    fade_out: fade(change.fade_out, layer.fade_out),
  };
  return { edits: { ...edits, adjustment_layers: layers.map((other) => (other.id === id ? next : other)) }, pick };
}

// An item whose sound has a stack of Audio Effects (ADR 0017).
export type StackRef = { kind: "segment" | "music" | "overlay"; id: string };

/**
 * The picked items with sound, which the Audio Effects section acts on: Segments (not a Freeze frame,
 * nor a video's without sound), Music Clips and video Overlays with sound (`sounded` says whether a
 * Media Library item has sound; an image hasn't). In the order Segments, Music Clips, Overlays.
 */
export function stackedItems({ edits, pick }: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean): StackRef[] {
  return [
    ...edits.segments
      .filter((segment) => isPicked(pick, "segment", segment.id) && segment.hold == null && (!segment.media || sounded(segment.media)))
      .map((segment) => ({ kind: "segment" as const, id: segment.id })),
    ...edits.music.filter((clip) => isPicked(pick, "music", clip.id)).map((clip) => ({ kind: "music" as const, id: clip.id })),
    ...edits.overlays.filter((overlay) => isPicked(pick, "overlay", overlay.id) && sounded(overlay.media)).map((overlay) => ({ kind: "overlay" as const, id: overlay.id })),
  ];
}

// Every picked item with sound given `change` of its stack (an emptied one left without the field);
// null when none is picked.
function restacked(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean, change: (stack: AudioEffect[]) => AudioEffect[]): Outcome | null {
  const { edits, pick } = scene;
  const refs = stackedItems(scene, sounded);
  if (!refs.length) return null;
  const set = <T extends { id: string; audio_effects?: AudioEffect[] }>(items: T[], kind: StackRef["kind"]): T[] =>
    items.map((item) => {
      if (!refs.some((ref) => ref.kind === kind && ref.id === item.id)) return item;
      const { audio_effects, ...rest } = item;
      const next = change(audio_effects ?? []);
      return (next.length ? { ...rest, audio_effects: next } : rest) as T;
    });
  return { edits: { ...edits, segments: set(edits.segments, "segment"), music: set(edits.music, "music"), overlays: set(edits.overlays, "overlay") }, pick };
}

/** A catalogue effect's entry at its defaults, switched on. */
export const audioEffectOf = (kind: AudioEffectKind): AudioEffect => ({
  id: kind.id,
  params: Object.fromEntries(kind.settings.map((setting) => [setting.key, setting.default])),
  enabled: true,
});

/**
 * Add effect: `kind` at its defaults, switched on, at the bottom of every picked item's stack that has
 * sound (stackedItems), as one change; above a Normalize loudness at the bottom, which stays last. Null
 * when none with sound is picked.
 */
export function addAudioEffect(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean, kind: AudioEffectKind): Outcome | null {
  return restacked(scene, sounded, (stack) => {
    const at = stack.at(-1)?.id === "normalize" ? stack.length - 1 : stack.length;
    return [...stack.slice(0, at), audioEffectOf(kind), ...stack.slice(at)];
  });
}

// Whether two entries are the same effect, switched the same way, at the same settings.
const sameEntry = (a: AudioEffect | VideoEffect, b: AudioEffect | VideoEffect) =>
  a.id === b.id &&
  a.enabled === b.enabled &&
  Object.keys(a.params).length === Object.keys(b.params).length &&
  Object.entries(a.params).every(([key, value]) => b.params[key] === value);

/**
 * The stack of the picked items with sound (stackedItems), when every one's is the same; "mixed" when
 * they differ; null when none with sound is picked.
 */
export function sharedStack(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean): AudioEffect[] | "mixed" | null {
  const stacks = stacksOf(scene, sounded);
  const [first, ...rest] = stacks;
  if (!first) return null;
  return rest.every((other) => other.length === first.length && other.every((entry, index) => sameEntry(entry, first[index]))) ? first : "mixed";
}

// The stacks of the picked items with sound, in stackedItems' order.
function stacksOf(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean): AudioEffect[][] {
  const { edits } = scene;
  const list = { segment: edits.segments, music: edits.music, overlay: edits.overlays } as const;
  return stackedItems(scene, sounded).map((ref) => (list[ref.kind] as { id: string; audio_effects?: AudioEffect[] }[]).find((item) => item.id === ref.id)?.audio_effects ?? []);
}

// Entry `index` of the picked stacks given `change` (its stack made anew), on every picked item with
// sound: only while their stacks are the same (sharedStack) and the entry is there; else null.
function entryChanged(
  scene: { edits: AdvancedEdits; pick: Pick },
  sounded: (media: string) => boolean,
  index: number,
  change: (stack: AudioEffect[]) => AudioEffect[] | null,
): Outcome | null {
  const shown = sharedStack(scene, sounded);
  if (shown === null || shown === "mixed" || !shown[index] || !change(shown)) return null;
  return restacked(scene, sounded, (stack) => change(stack)!);
}

/**
 * Entry `index` moved past the next row up (`delta` −1) or down (+1) in every picked stack, landing
 * beside it: a Clean switch's entry is not a row, and the other entries keep their order (so the Clean
 * entries the editor places stay at the top and bottom). Null past the first or last row.
 */
export function moveAudioEffect(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean, index: number, delta: -1 | 1): Outcome | null {
  return entryChanged(scene, sounded, index, (stack) => {
    let to = index + delta;
    while (to >= 0 && to < stack.length && isCleanSwitch(stack[to].id)) to += delta;
    if (to < 0 || to >= stack.length) return null;
    const rest = stack.filter((_, at) => at !== index);
    const neighbour = rest.indexOf(stack[to]);
    const at = delta < 0 ? neighbour : neighbour + 1;
    return [...rest.slice(0, at), stack[index], ...rest.slice(at)];
  });
}

/** Entry `index` switched on or off in every picked stack, staying in its place. */
export function setAudioEffectEnabled(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean, index: number, enabled: boolean): Outcome | null {
  return entryChanged(scene, sounded, index, (stack) => stack.map((entry, at) => (at === index ? { ...entry, enabled } : entry)));
}

/** Entry `index` taken out of every picked stack. */
export function removeAudioEffect(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean, index: number): Outcome | null {
  return entryChanged(scene, sounded, index, (stack) => stack.filter((_, at) => at !== index));
}

/**
 * Entry `index`'s `setting` set to `value` in every picked stack, on the setting's steps and within
 * its range (its other settings as they were). A slider's drag is one change of its group.
 */
export function setAudioEffectSetting(
  scene: { edits: AdvancedEdits; pick: Pick },
  sounded: (media: string) => boolean,
  index: number,
  setting: AudioEffectSetting,
  value: number,
): Outcome | null {
  const level = steppedSetting(setting, value);
  return entryChanged(scene, sounded, index, (stack) => stack.map((entry, at) => (at === index ? { ...entry, params: { ...entry.params, [setting.key]: level } } : entry)));
}

// `value` on `setting`'s steps and within its range.
function steppedSetting({ min, max, step }: AudioEffectSetting, value: number): number {
  const stepped = step > 0 ? min + Math.round((value - min) / step) * step : value;
  return Number(Math.min(Math.max(stepped, min), max).toFixed(6));
}

/** Remove all effects: every picked stack emptied, whether they are the same or Mixed. Null when none with sound is picked. */
export function removeAllAudioEffects(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean): Outcome | null {
  return restacked(scene, sounded, () => []);
}

/** A Clean switch as the picked items with sound show it: on when every one has its entry switched on, off when none has, else Mixed; with the first one's settings while it is on. */
export type CleanSwitch = { on: boolean | "mixed"; params: Record<string, number> | null };

/** The Clean switches of the picked items with sound (stackedItems), by id; null when none with sound is picked. An entry switched off (by the agent) counts as off. */
export function cleanSwitches(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean): Record<CleanSwitchId, CleanSwitch> | null {
  const stacks = stacksOf(scene, sounded);
  if (!stacks.length) return null;
  const entries = (id: CleanSwitchId) => stacks.map((stack) => stack.find((entry) => entry.id === id && entry.enabled));
  return Object.fromEntries(
    CLEAN_SWITCHES.map((id) => {
      const found = entries(id);
      const on = found.every(Boolean) ? true : found.some(Boolean) ? "mixed" : false;
      return [id, { on, params: on === true ? found[0]!.params : null }];
    }),
  ) as Record<CleanSwitchId, CleanSwitch>;
}

// Where a Clean switch's entry goes in a stack: Reduce noise at the top; Enhance voice right after a
// Reduce noise, wherever an agent put it, else at the top; Normalize loudness at the bottom, so that
// it measures the rest.
function cleanPlace(stack: AudioEffect[], id: string): number {
  if (id === "normalize") return stack.length;
  if (id === "enhance-voice") return stack.findLastIndex((entry) => entry.id === "denoise") + 1;
  return 0;
}

/**
 * A Clean switch (`kind`, of the Clean group) turned on or off on every picked item with sound, as
 * one change. On: an item without its entry gets it at its defaults, at its place (`cleanPlace`); an
 * entry there but switched off is switched on where it is. Off: its entries are taken out, wherever
 * they were moved to. Null when none with sound is picked.
 */
export function setCleanSwitch(scene: { edits: AdvancedEdits; pick: Pick }, sounded: (media: string) => boolean, kind: AudioEffectKind, on: boolean): Outcome | null {
  return restacked(scene, sounded, (stack) => {
    if (!on) return stack.filter((entry) => entry.id !== kind.id);
    if (stack.some((entry) => entry.id === kind.id)) return stack.map((entry) => (entry.id === kind.id ? { ...entry, enabled: true } : entry));
    const at = cleanPlace(stack, kind.id);
    return [...stack.slice(0, at), audioEffectOf(kind), ...stack.slice(at)];
  });
}

/** A Clean switch's `setting` set to `value` (on its steps, within its range) on every picked item's entry of `id`, Mixed or not. */
export function setCleanSetting(
  scene: { edits: AdvancedEdits; pick: Pick },
  sounded: (media: string) => boolean,
  id: CleanSwitchId,
  setting: AudioEffectSetting,
  value: number,
): Outcome | null {
  const level = steppedSetting(setting, value);
  return restacked(scene, sounded, (stack) => stack.map((entry) => (entry.id === id ? { ...entry, params: { ...entry.params, [setting.key]: level } } : entry)));
}

// A picture with a stack of Video Effects (ADR 0014): a Segment (its whole frame), an Overlay or an
// Adjustment Layer (what is under it).
export type PictureRef = { kind: "segment" | "overlay" | "adjustment"; id: string };
type Pictured = { id: string; video_effects?: VideoEffect[] };

/** The picked pictures, which the Video Effects section acts on: the Segments, then the Overlays (videos and images), then the Adjustment Layers. */
export function picturedItems({ edits, pick }: { edits: AdvancedEdits; pick: Pick }): PictureRef[] {
  return [
    ...edits.segments.filter((segment) => isPicked(pick, "segment", segment.id)).map((segment) => ({ kind: "segment" as const, id: segment.id })),
    ...edits.overlays.filter((overlay) => isPicked(pick, "overlay", overlay.id)).map((overlay) => ({ kind: "overlay" as const, id: overlay.id })),
    ...listOf(edits, "adjustment")
      .filter((layer) => isPicked(pick, "adjustment", layer.id))
      .map((layer) => ({ kind: "adjustment" as const, id: layer.id })),
  ];
}

// The picture `ref` names in `edits`.
const pictureOf = (edits: AdvancedEdits, ref: PictureRef): Pictured | undefined =>
  (ref.kind === "segment" ? edits.segments : ref.kind === "overlay" ? edits.overlays : listOf(edits, "adjustment")).find((item) => item.id === ref.id);

// Every picked picture given `change` of its stack (an emptied one left without the field; one
// `change` leaves as it was, untouched, and a list with none changed kept as it was); null when none
// is picked or none changes.
function repictured(scene: { edits: AdvancedEdits; pick: Pick }, change: (stack: VideoEffect[]) => VideoEffect[]): Outcome | null {
  const { edits, pick } = scene;
  const refs = picturedItems(scene);
  const set = <T extends Pictured>(items: T[], kind: PictureRef["kind"]): T[] => {
    let changed = false;
    const next = items.map((item) => {
      if (!refs.some((ref) => ref.kind === kind && ref.id === item.id)) return item;
      const { video_effects, ...rest } = item;
      const was = video_effects ?? [];
      const stack = change(was);
      if (stack === was) return item;
      changed = true;
      return (stack.length ? { ...rest, video_effects: stack } : rest) as T;
    });
    return changed ? next : items;
  };
  const segments = set(edits.segments, "segment");
  const overlays = set(edits.overlays, "overlay");
  const layers = listOf(edits, "adjustment");
  const adjustments = set(layers, "adjustment");
  if (segments === edits.segments && overlays === edits.overlays && adjustments === layers) return null;
  return { edits: { ...edits, segments, overlays, ...(adjustments !== layers && { adjustment_layers: adjustments }) }, pick };
}

/** A catalogue Video Effect's entry at its defaults, switched on. */
export const videoEffectOf = (kind: VideoEffectKind): VideoEffect => ({
  id: kind.id,
  params: Object.fromEntries(kind.settings.map((setting) => [setting.key, setting.default])),
  enabled: true,
});

/**
 * Add effect: `kind` at its defaults, switched on, at the bottom of every picked picture's stack, as
 * one change; one that has it already is skipped (an effect is once in a stack). Null when none is
 * picked, or every one has it.
 */
export function addVideoEffect(scene: { edits: AdvancedEdits; pick: Pick }, kind: VideoEffectKind): Outcome | null {
  return repictured(scene, (stack) => (stack.some((entry) => entry.id === kind.id) ? stack : [...stack, videoEffectOf(kind)]));
}

/** The stack of the picked pictures, when every one's is the same; "mixed" when they differ; null when none is picked. */
export function sharedVideoStack(scene: { edits: AdvancedEdits; pick: Pick }): VideoEffect[] | "mixed" | null {
  const { edits } = scene;
  const stacks = picturedItems(scene).map((ref) => pictureOf(edits, ref)?.video_effects ?? []);
  const [first, ...rest] = stacks;
  if (!first) return null;
  return rest.every((other) => other.length === first.length && other.every((entry, index) => sameEntry(entry, first[index]))) ? first : "mixed";
}

// Entry `index` of the picked stacks given `change` (its stack made anew), on every picked picture:
// only while their stacks are the same (sharedVideoStack) and the entry is there; else null.
function videoEntryChanged(scene: { edits: AdvancedEdits; pick: Pick }, index: number, change: (stack: VideoEffect[]) => VideoEffect[] | null): Outcome | null {
  const shown = sharedVideoStack(scene);
  if (shown === null || shown === "mixed" || !shown[index] || !change(shown)) return null;
  return repictured(scene, (stack) => change(stack)!);
}

/** Entry `index` swapped with the one above (`delta` −1) or below (+1) in every picked stack. Null past the first or last. */
export function moveVideoEffect(scene: { edits: AdvancedEdits; pick: Pick }, index: number, delta: -1 | 1): Outcome | null {
  return videoEntryChanged(scene, index, (stack) => {
    const to = index + delta;
    if (to < 0 || to >= stack.length) return null;
    const moved = [...stack];
    [moved[index], moved[to]] = [moved[to], moved[index]];
    return moved;
  });
}

/** Entry `index` switched on or off in every picked stack, staying in its place. */
export function setVideoEffectEnabled(scene: { edits: AdvancedEdits; pick: Pick }, index: number, enabled: boolean): Outcome | null {
  return videoEntryChanged(scene, index, (stack) => stack.map((entry, at) => (at === index ? { ...entry, enabled } : entry)));
}

/** Entry `index` taken out of every picked stack. */
export function removeVideoEffect(scene: { edits: AdvancedEdits; pick: Pick }, index: number): Outcome | null {
  return videoEntryChanged(scene, index, (stack) => stack.filter((_, at) => at !== index));
}

/**
 * Entry `index`'s `setting` set to `value` in every picked stack, on the setting's steps and within
 * its range (its other settings as they were). A slider's drag is one change of its group.
 */
export function setVideoEffectSetting(scene: { edits: AdvancedEdits; pick: Pick }, index: number, setting: AudioEffectSetting, value: number): Outcome | null {
  const level = steppedSetting(setting, value);
  return videoEntryChanged(scene, index, (stack) => stack.map((entry, at) => (at === index ? { ...entry, params: { ...entry.params, [setting.key]: level } } : entry)));
}

/** Remove all effects: every picked stack emptied, whether they are the same or Mixed. Null when none is picked or all are empty. */
export function removeAllVideoEffects(scene: { edits: AdvancedEdits; pick: Pick }): Outcome | null {
  return repictured(scene, (stack) => (stack.length ? [] : stack));
}
