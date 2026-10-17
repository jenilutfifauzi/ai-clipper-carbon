import type { ClipSegment, Keyframe, Keys, MusicClip, Overlay, TextLayer, Transform } from "../../../api";
import type { PlayedSegment } from "../editor/playback";
import { offsetAt, playedSourceAt, playedTimeAt, rangeOf, segmentLength, sourceAt, type SegmentRange } from "../editor/segmentTime";
import { FADE_MAX_SECS, fadesWithin, ITEM_MIN_SECS, keptOffset, newId, round, type AdvancedEdits } from "./edits";
import { mirroredKeys, rekeyed, scaledKeys, shownTransform, toMillionth } from "./keyActions";
import { draggedSegments, MEDIA_MIN_SECS, SEGMENT_MIN_SECS } from "./MainTrack";
import { isPicked, itemsOf, LISTS, onlyItem, picked, TRACK_OF, type ItemKind, type ItemRef, type Pick } from "./pick";
import { removedNotice, ripple, type Layers, type TrackChange } from "./ripple";
import { speedLabel, speedOf } from "./speed";
import type { TrackKind } from "./trackState";

/**
 * What the actions on a Pick are done in (not a Scene of the plan): the edits and the Pick, the Main Track as it plays, the
 * Clip's length, `gap` (which moves a time on the Source's timeline into the silence between Words
 * nearest it), `ids` (new items' ids), `magnetic`, whether the layers follow the Main Track (the
 * Magnetic timeline), and the `locked` Tracks, whose items aren't picked, split or pasted (but
 * follow the Main Track all the same).
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
}

/** An action's result: the edits after it (one change, so one step of undo), what is picked then, and what to tell. */
export interface Outcome {
  edits: AdvancedEdits;
  pick: Pick;
  notice?: string;
}

export type Timed = TextLayer | MusicClip | Overlay;
export type TimedKind = "text" | "music" | "overlay";

/**
 * How each kind of timed item behaves: its list in the edits; where a copy goes when there is no
 * room after it (a text a little lower, so that both show); and, split in two, what each part keeps
 * (a song's or video's second part goes on from where the first stops in its file; a song has no
 * fades at the cut, nor a fade longer than its part).
 */
const KINDS: {
  [K in TimedKind]: {
    list: "text_layers" | "music" | "overlays";
    aside: (item: Timed) => Partial<Timed>;
    cut: (item: Timed, at: number) => { first: Partial<Timed>; second: Partial<Timed> };
  };
} = {
  text: {
    list: "text_layers",
    aside: (item) => ({ y: Math.min((item as TextLayer).y + 80, 1920) }),
    cut: () => ({ first: {}, second: {} }),
  },
  music: {
    list: "music",
    aside: () => ({}),
    cut: (item, at) => {
      const clip = item as MusicClip;
      return {
        first: { fade_in: Math.min(clip.fade_in, round(at - clip.start)), fade_out: 0 },
        second: { offset: round(clip.offset + at - clip.start), fade_in: 0, fade_out: Math.min(clip.fade_out, round(clip.start + clip.secs - at)) },
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
};

export const idOf = (scene: PickContext) => (scene.ids ?? newId)();

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
    music: kept(edits.music, "music"),
    overlays: kept(edits.overlays, "overlay"),
  };
  if (!next.segments.length) {
    const first = edits.segments[0];
    const stays = "The first Segment stays: a clip needs at least one.";
    const pickFirst = picked({ kind: "segment", id: first.id });
    // Only the one Segment there is picked: nothing changes.
    if (itemsOf(pick).length === 1 && edits.segments.length === 1) return { edits, pick: pickFirst, notice: stays };
    next.segments = [first];
    const after = rippledAfter(scene, next, rippled);
    return { edits: after.edits, pick: pickFirst, notice: [stays, after.notice].filter(Boolean).join(" ") };
  }
  return { ...rippledAfter(scene, next, rippled), pick: null };
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
export const layersOf = ({ text_layers, music, overlays, hook_start, hook_secs }: Layers): Layers => ({
  text_layers,
  music,
  overlays,
  hook_start,
  hook_secs,
});

/**
 * The picked items removed and their gaps closed, whatever the Magnetic timeline's switch says (Ripple
 * delete, GLOSSARY.md): the Text Layers, Music Clips and Overlays of a Track after a removed one of
 * it move up by its length (those over it stay), and then the layers follow the removed Segments.
 */
export function rippleRemove(scene: PickContext): Outcome | null {
  const { layers } = pickedItems(scene);
  const edits = { ...scene.edits };
  for (const kind of Object.keys(KINDS) as TimedKind[]) {
    const gone = layers.filter((layer) => layer.kind === kind).map(({ item }) => ({ start: item.start, end: item.start + item.secs }));
    if (!gone.length) continue;
    const list = KINDS[kind].list;
    const closed = (edits[list] as Timed[])
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

/** Where a Segment dropped at `time` goes on the Main Track: after each Segment whose middle is before it. */
export const placeDropped = (played: PlayedSegment[], time: number) => played.filter((shown) => (shown.start + shown.end) / 2 < time).length;

/** `segment` put in on the Main Track at `place`, picked; on the Magnetic timeline the layers after it play later. */
export function insertSegment(scene: PickContext, segment: ClipSegment, place: number): Outcome {
  const { segments } = scene.edits;
  const next = { ...scene.edits, segments: [...segments.slice(0, place), segment, ...segments.slice(place)] };
  const at = scene.played[place]?.start ?? scene.duration;
  return {
    edits: rippledIf(next, [{ kind: "inserted", at, secs: segmentLength(segment) }], scene.magnetic ?? false).edits,
    pick: picked({ kind: "segment", id: segment.id }),
  };
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
 * the layers move with the edge from where they were when the drag began; moved, they stay.
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
  // A video's Keyframes re-anchored to what its trim keeps (retimed), from the Segment as the drag began.
  const segments = draggedSegments(origin.edits.segments, id, change, lengthOf, origin.shown, origin.planned, longest).map((segment) =>
    segment.id === id && before ? retimed(before, segment, change.edge) : segment,
  );
  const index = segments.findIndex((segment) => segment.id === id);
  const whole = origin.planned[index];
  if (change.edge === "move" || !whole || !scene.magnetic) return { edits: { ...scene.edits, segments }, pick: scene.pick };
  // Longer (or shorter) by `by` at the trimmed edge, as planned.
  const by = segmentLength(segments[index]) - segmentLength(rangeOf(whole));
  const at = change.edge === "end" ? whole.end + Math.min(by, 0) : whole.start;
  const { edits, notice } = rippledIf(
    origin.edits,
    [{ kind: by < 0 ? "removed" : "inserted", at, secs: Math.abs(by) }],
    Math.abs(by) > 1e-6,
    origin.shown.at(-1)?.end,
  );
  return { edits: { ...scene.edits, segments, ...layersOf(edits) }, pick: scene.pick, ...(notice ? { notice } : {}) };
}

/** Every Segment, Text Layer, Music Clip and Overlay picked (not the hook, the captions or a join). */
export function pickAll(edits: AdvancedEdits): Pick {
  const refs = (kind: ItemKind) => edits[LISTS[kind]].map((item) => ({ kind, id: item.id }));
  return picked(...refs("segment"), ...refs("text"), ...refs("music"), ...refs("overlay"));
}

// The picked Segments in Main Track order, and the picked Text Layers, Music Clips and Overlays in
// their lists' order: the order their copies and parts are made and picked in.
export function pickedItems(scene: PickContext) {
  const { edits, pick } = scene;
  const segments = edits.segments.filter((segment) => isPicked(pick, "segment", segment.id));
  const layers = (Object.keys(KINDS) as TimedKind[]).flatMap((kind) =>
    (edits[KINDS[kind].list] as Timed[]).filter((item) => isPicked(pick, kind, item.id)).map((item) => ({ kind, item })),
  );
  return { segments, layers };
}

/**
 * The Pick duplicated, the copies picked. Its Segments are copied as a block, in order, right after
 * the last of them. Its Text Layers, Music Clips and Overlays are copied as they are placed, right
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
      const copy = { ...item, id: idOf(scene), ...(room ? { start: round(item.start + end - first) } : KINDS[kind].aside(item)) } as Timed;
      const list = KINDS[kind].list;
      Object.assign(next, { [list]: [...(next[list] as Timed[]), copy] });
      copies.push({ kind, id: copy.id });
    }
  }
  return { edits: next, pick: picked(...copies) };
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
  const item = (scene.edits[KINDS[ref.kind].list] as Timed[]).find((other) => other.id === ref.id);
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
    // Keyframes, where a Segment has them, are re-anchored to each part, in seconds from its start.
    const second = rekeyed<ClipSegment>({ ...segment, ...secondRange, id: idOf(scene) }, offsetAt(segment, cut), segmentLength(segment));
    const first = rekeyed<ClipSegment>(
      { ...segment, ...firstRange },
      offsetAt(segment, segment.reverse ? firstRange.end : firstRange.start),
      offsetAt(segment, cut),
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
    const tail = rekeyed({ ...item, id: idOf(scene), start: time, secs: round(item.start + item.secs - time), ...second } as Timed, time - item.start, item.secs);
    const list = KINDS[kind].list;
    Object.assign(next, { [list]: (next[list] as Timed[]).flatMap((other) => (other.id === item.id ? [head, tail] : [other])) });
    tails.push({ kind, id: tail.id });
  }
  return tails.length ? { edits: next, pick: picked(...tails) } : null;
}

// Every Segment, Text Layer, Music Clip and Overlay the playhead at `time` is inside, but on locked Tracks.
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
 * Layer, Music Clip and Overlay there (Split all, GLOSSARY.md). The hook is never split.
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
 * video's Freeze frame takes its Framing as shown there, its Keyframes sampled into constants. A
 * Transition after the Segment stays after the tail. The Main Track gets FREEZE_SECS longer at the
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
  const head = rekeyed<ClipSegment>({ ...segment, ...headRange }, into - (cutAt - shown.start), into);
  const tail = rekeyed<ClipSegment>({ ...segment, ...tailRange, id: idOf(scene) }, into, length);
  const held: ClipSegment = { id: idOf(scene), start: cut, end: cut, hold: FREEZE_SECS };
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
  return {
    edits: rippledIf(next, [{ kind: "inserted", at: cutAt, secs: FREEZE_SECS }], scene.magnetic ?? false).edits,
    pick: picked({ kind: "segment", id: held.id }),
  };
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
 * The picked Text Layers, Music Clips and Overlays moved `delta` seconds later (earlier when it is
 * negative), as a group: no further than keeps them all inside the Clip. Picked Segments stay.
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
    Object.assign(next, { [list]: (next[list] as Timed[]).map((other) => (other.id === item.id ? { ...other, start: round(other.start + by) } : other)) });
  }
  return { edits: next, pick: scene.pick };
}

// The output's size, in pixels: where the middles of Text Layers and Overlays can be.
const FRAME = { width: 1080, height: 1920 };

// Where a Text Layer's or an Overlay's middle is on the frame (an Overlay's Transform has it), and the
// item with its middle at (x, y).
const middleOf = (item: TextLayer | Overlay) => ("transform" in item ? item.transform : item);
const middledAt = <T extends TextLayer | Overlay>(item: T, x: number, y: number): T =>
  "transform" in item ? { ...item, transform: { ...item.transform, x, y } } : { ...item, x, y };

// Where a keyed Overlay's middle goes along `axis`: its Keyframes' values (none for a Text Layer).
const keyedMiddles = (item: TextLayer | Overlay, axis: "x" | "y") => ("keys" in item ? (item.keys[axis] ?? []).map((key) => key.value) : []);

/**
 * The picked Text Layers and Overlays moved on the frame by (`dx`, `dy`) output pixels, together: no
 * further than keeps each one's middle in the frame. A keyed Overlay's motion moves with it: each of
 * its x and y Keyframes by as much, kept in the frame as its middle is.
 */
export function nudge(scene: PickContext, dx: number, dy: number): Outcome | null {
  const placed = pickedItems(scene).layers.filter(({ kind }) => kind !== "music") as { kind: "text" | "overlay"; item: TextLayer | Overlay }[];
  if (!placed.length) return null;
  const within = (by: number, values: number[], size: number) => Math.min(Math.max(by, -Math.min(...values)), size - Math.max(...values));
  const byX = within(dx, placed.flatMap(({ item }) => [middleOf(item).x, ...keyedMiddles(item, "x")]), FRAME.width);
  const byY = within(dy, placed.flatMap(({ item }) => [middleOf(item).y, ...keyedMiddles(item, "y")]), FRAME.height);
  const shifted = (keys: Keyframe[], by: number) => keys.map((key) => ({ ...key, value: toMillionth(key.value + by) }));
  const next = { ...scene.edits };
  for (const { kind, item } of placed) {
    const list = KINDS[kind].list;
    Object.assign(next, {
      [list]: (next[list] as (TextLayer | Overlay)[]).map((other) => {
        if (other.id !== item.id) return other;
        const { x, y } = middleOf(other);
        const moved = middledAt(other, Math.round(x + byX), Math.round(y + byY));
        if (!("keys" in moved) || !(moved.keys.x || moved.keys.y)) return moved;
        const { x: xs, y: ys } = moved.keys;
        return { ...moved, keys: { ...moved.keys, ...(xs && { x: shifted(xs, byX) }), ...(ys && { y: shifted(ys, byY) }) } };
      }),
    });
  }
  return { edits: next, pick: scene.pick };
}

/** The value `field` has in every one of `layers`, or undefined where they differ (mixed). */
export function shared<K extends keyof TextLayer>(layers: TextLayer[], field: K): TextLayer[K] | undefined {
  const [first, ...rest] = layers;
  return first && rest.every((layer) => layer[field] === first[field]) ? first[field] : undefined;
}

/** `field` of every picked Text Layer set to `value`. */
export function restyle<K extends keyof TextLayer>(scene: { edits: AdvancedEdits; pick: Pick }, field: K, value: TextLayer[K]): Outcome {
  const text_layers = scene.edits.text_layers.map((layer) => (isPicked(scene.pick, "text", layer.id) ? { ...layer, [field]: value } : layer));
  return { edits: { ...scene.edits, text_layers }, pick: scene.pick };
}

/**
 * Music Clip or media Segment `item`'s volume set to `volume`, rounded to 0.01 and kept within 0–2
 * (by its Volume Line or the inspector). A Source Segment has none to set here: the Clip's own sound
 * has one volume. Null for one, or for an item that isn't there.
 */
export function setVolume(scene: { edits: AdvancedEdits; pick: Pick }, item: { kind: "music" | "segment"; id: string }, volume: number): Outcome | null {
  const { edits, pick } = scene;
  const level = Math.round(Math.min(Math.max(volume, 0), 2) * 100) / 100;
  const set = <T extends { id: string }>(items: T[]) => items.map((other) => (other.id === item.id ? { ...other, volume: level } : other));
  if (item.kind === "music") return edits.music.some((clip) => clip.id === item.id) ? { edits: { ...edits, music: set(edits.music) }, pick } : null;
  return edits.segments.some((segment) => segment.id === item.id && segment.media) ? { edits: { ...edits, segments: set(edits.segments) }, pick } : null;
}

/** A Segment or a video Overlay, which has a Speed. */
export type SpedRef = { kind: "segment" | "overlay"; id: string };

/**
 * Segment or video Overlay `item`'s Speed set to `speed` (speedOf), a trim at its end (ADR 0009): its
 * Keyframes scaled by the old Speed ÷ the new, so that they stay on the same frames. A Segment keeps
 * its range and plays it in its new Timeline length; the Main Track closes up or opens out after it,
 * and on the Magnetic timeline the layers follow as they follow a trim of its end. Refused, with a
 * notice, when a video's Segment would play under MEDIA_MIN_SECS or the Clip would last longer than
 * the `longest` clip. An Overlay keeps its start and shows as much of its video, its end kept within
 * the video (`video` seconds long). Null for a Freeze frame, or an item that isn't there.
 */
export function setSpeed(scene: PickContext, item: SpedRef, value: number, limits: { longest?: number; video?: number } = {}): Outcome | null {
  const { edits, pick } = scene;
  const speed = speedOf(value);
  if (item.kind === "overlay") {
    const overlay = edits.overlays.find((other) => other.id === item.id);
    if (!overlay) return null;
    const by = (overlay.speed ?? 1) / speed;
    const room = limits.video === undefined ? Infinity : (limits.video - overlay.offset) / speed;
    const secs = round(Math.max(Math.min(overlay.secs * by, room), ITEM_MIN_SECS));
    const sped = rekeyed({ ...overlay, speed, secs, keys: scaledKeys(overlay.keys, by) }, 0, secs);
    return { edits: { ...edits, overlays: edits.overlays.map((other) => (other.id === item.id ? sped : other)) }, pick };
  }
  const index = edits.segments.findIndex((other) => other.id === item.id);
  const segment = edits.segments[index];
  if (!segment || segment.hold != null) return null;
  const by = (segment.speed ?? 1) / speed;
  const sped = { ...segment, speed, ...(segment.keys && { keys: scaledKeys(segment.keys, by) }) };
  const [before, after] = [segmentLength(segment), segmentLength(sped)];
  const refused = (notice: string): Outcome => ({ edits, pick, notice });
  if (segment.media && after < MEDIA_MIN_SECS) {
    return refused(`A video's Segment lasts ${MEDIA_MIN_SECS} s at least: at ${speedLabel(speed)} this one would last ${after.toFixed(2)} s.`);
  }
  const length = scene.duration + after - before;
  if (limits.longest !== undefined && length > limits.longest + 1e-6) {
    return refused(`A clip can last at most ${limits.longest} s: at ${speedLabel(speed)} this one would last ${Math.round(length)} s.`);
  }
  const next = { ...edits, segments: edits.segments.map((other) => (other.id === item.id ? sped : other)) };
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
  return (scene: PickContext, item: SpedRef, speed: number, group: string, limits?: { longest?: number; video?: number }): Outcome | null => {
    const origin = last && last.group === group && last.made === scene.edits ? last.origin : scene;
    const outcome = setSpeed({ ...origin, pick: scene.pick, magnetic: scene.magnetic }, item, speed, limits);
    if (!outcome) return null;
    if (outcome.edits === origin.edits && outcome.notice) return { ...outcome, edits: scene.edits };
    last = { group, origin, made: outcome.edits };
    return outcome;
  };
}

/**
 * The one picked Segment or video Overlay, which Reverse (R) turns on or off: null with nothing or
 * several picked, or for a Freeze frame (it holds one frame), an image Overlay (`video` says whether
 * a Media Library item is a video), a Text Layer or a Music Clip.
 */
export function reversible(scene: { edits: AdvancedEdits; pick: Pick }, video: (media: string) => boolean): SpedRef | null {
  const only = onlyItem(scene.pick);
  const { segments, overlays } = scene.edits;
  if (only?.kind === "segment" && segments.some((segment) => segment.id === only.id && segment.hold == null)) return { kind: "segment", id: only.id };
  if (only?.kind === "overlay" && overlays.some((overlay) => overlay.id === only.id && video(overlay.media))) return { kind: "overlay", id: only.id };
  return null;
}

/**
 * The one picked Segment or video Overlay, whose Speed sheet the phone's toolbar opens: as
 * `reversible`, and a Freeze frame too (its sheet shows its Duration).
 */
export function paced(scene: { edits: AdvancedEdits; pick: Pick }, video: (media: string) => boolean): SpedRef | null {
  const only = onlyItem(scene.pick);
  if (only?.kind === "segment" && scene.edits.segments.some((segment) => segment.id === only.id)) return { kind: "segment", id: only.id };
  return reversible(scene, video);
}

/**
 * Segment or video Overlay `item` played backwards, or forwards again (`reverse`, ADR 0009), from a
 * Retimed copy. It keeps its range and its place and length on the Timeline. Its Keyframes are
 * mirrored (mirroredKeys), so that its motion stays on the same frames of its video, as a Speed
 * change scales them. Null for a Freeze frame, or an item that isn't there.
 */
export function setReverse(scene: { edits: AdvancedEdits; pick: Pick }, item: SpedRef, reverse: boolean): Outcome | null {
  const { edits, pick } = scene;
  const turned = <T extends { reverse?: boolean; keys?: Keys }>(other: T, length: number): T =>
    other.keys && reverse !== (other.reverse ?? false) ? { ...other, reverse, keys: mirroredKeys(other.keys, length) } : { ...other, reverse };
  if (item.kind === "overlay") {
    if (!edits.overlays.some((other) => other.id === item.id)) return null;
    return { edits: { ...edits, overlays: edits.overlays.map((other) => (other.id === item.id ? turned(other, other.secs) : other)) }, pick };
  }
  if (!edits.segments.some((other) => other.id === item.id && other.hold == null)) return null;
  return { edits: { ...edits, segments: edits.segments.map((other) => (other.id === item.id ? turned(other, segmentLength(other)) : other)) }, pick };
}

/**
 * Music Clip `id`'s fade in or fade out (`fade`) set to `secs` (by its Fade Ramp's handle or the
 * inspector), rounded to a hundredth: 0–10 s, and no further than where the other fade begins, so
 * that the two together are never longer than the Music Clip. Cut short by the Clip's end (`heard`
 * seconds of it are heard), both are set as they are heard, so that what is stored is what the
 * Timeline draws and the Clip plays. Null for one that isn't there.
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
  if (!clip) return null;
  // Its fades as heard: shortened when the Clip's end cuts it short (`heard` seconds of it).
  const fades = fadesWithin(clip, heard ?? clip.secs);
  const other = fade === "fade_in" ? "fade_out" : "fade_in";
  const most = Math.max(0, Math.min(FADE_MAX_SECS, (heard ?? clip.secs) - fades[other]));
  const set = { ...clip, [other]: fades[other], [fade]: round(Math.min(Math.max(secs, 0), most)) };
  return { edits: { ...edits, music: edits.music.map((each) => (each.id === id ? set : each)) }, pick };
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
