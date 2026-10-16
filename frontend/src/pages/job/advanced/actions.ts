import type { ClipSegment, Keyframe, MusicClip, Overlay, TextLayer } from "../../../api";
import type { PlayedSegment } from "../editor/playback";
import { FADE_MAX_SECS, fadesWithin, ITEM_MIN_SECS, newId, round, type AdvancedEdits } from "./edits";
import { rekeyed, toMillionth } from "./keyActions";
import { draggedSegments, SEGMENT_MIN_SECS } from "./MainTrack";
import { isPicked, itemsOf, LISTS, picked, TRACK_OF, type ItemKind, type ItemRef, type Pick } from "./pick";
import { removedNotice, ripple, type Layers, type TrackChange } from "./ripple";
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
    cut: (item, at) => ({ first: {}, second: { offset: round((item as Overlay).offset + at - item.start) } }),
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

const segmentSecs = (segment: ClipSegment) => segment.end - segment.start;

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
    edits: rippledIf(next, [{ kind: "inserted", at, secs: segmentSecs(segment) }], scene.magnetic ?? false).edits,
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
 * file's `lengthOf`). See draggedSegments. Trimmed on the Magnetic timeline, the layers move with
 * the edge from where they were when the drag began; moved, they stay.
 */
export function dragSegment(
  scene: PickContext,
  origin: SegmentDrag,
  id: string,
  change: { start: number; end: number; edge: "move" | "start" | "end" },
  lengthOf: (segment: ClipSegment) => number,
): Outcome {
  const before = origin.edits.segments.find((segment) => segment.id === id);
  // A video's Keyframes re-anchored to what its trim keeps (retimed), from the Segment as the drag began.
  const segments = draggedSegments(origin.edits.segments, id, change, lengthOf, origin.shown, origin.planned).map((segment) =>
    segment.id === id && before ? retimed(before, segment, change.edge) : segment,
  );
  const index = segments.findIndex((segment) => segment.id === id);
  const whole = origin.planned[index];
  if (change.edge === "move" || !whole || !scene.magnetic) return { edits: { ...scene.edits, segments }, pick: scene.pick };
  // Longer (or shorter) by `by` at the trimmed edge, as planned.
  const by = segments[index].end - segments[index].start - (whole.source_end - whole.source_start);
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
    added = block.reduce((sum, segment) => sum + segmentSecs(segment), 0);
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

// Whether the playhead at `time` is inside picked item `ref`, so that it can be split there.
function inside(scene: PickContext, ref: ItemRef, time: number): boolean {
  if (ref.kind === "segment") {
    const shown = scene.played[scene.edits.segments.findIndex((segment) => segment.id === ref.id)];
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
    const there = shown.source_start + at - shown.start;
    const cut = Math.round((segment.media ? there : scene.gap(there)) * 1000) / 1000;
    // Keyframes, where a Segment has them, are re-anchored to each part, in seconds from its start.
    const second = rekeyed<ClipSegment>({ ...segment, id: idOf(scene), start: cut }, cut - segment.start, segment.end - segment.start);
    const first = rekeyed<ClipSegment>({ ...segment, start: shown.source_start, end: cut }, shown.source_start - segment.start, cut - segment.start);
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
  const from = edge === "move" ? 0 : next.start - origin.start;
  const length = "secs" in next ? next.secs : next.end - next.start;
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
