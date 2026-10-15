import type { ClipSegment, MusicClip, Overlay, TextLayer } from "../../../api";
import type { PlayedSegment } from "../editor/playback";
import { ITEM_MIN_SECS, newId, round, type AdvancedEdits } from "./edits";
import { draggedSegments, SEGMENT_MIN_SECS } from "./MainTrack";
import { isPicked, itemsOf, LISTS, picked, type ItemKind, type ItemRef, type Pick } from "./pick";
import { removedNotice, ripple, type TrackChange } from "./ripple";

/**
 * What the actions on a Pick are done in (not a Scene of the plan): the edits and the Pick, the Main Track as it plays, the
 * Clip's length, `gap` (which moves a time on the Source's timeline into the silence between Words
 * nearest it), `ids` (new items' ids) and `magnetic`, whether the layers follow the Main Track (the
 * Magnetic timeline).
 */
export interface PickContext {
  edits: AdvancedEdits;
  pick: Pick;
  played: PlayedSegment[];
  duration: number;
  gap: (time: number) => number;
  ids?: () => string;
  magnetic?: boolean;
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
 * fades at the cut).
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
    cut: (item, at) => ({
      first: { fade_out: 0 },
      second: { offset: round((item as MusicClip).offset + at - item.start), fade_in: 0 },
    }),
  },
  overlay: {
    list: "overlays",
    aside: (item) => ({ y: Math.min((item as Overlay).y + 80, 1920) }),
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
  if (!rippled) return { edits: next };
  const changes: TrackChange[] = scene.edits.segments.flatMap((segment, i) => {
    const shown = scene.played[i];
    return shown && !next.segments.some((other) => other.id === segment.id) ? [{ kind: "removed" as const, at: shown.start, secs: shown.end - shown.start }] : [];
  });
  const { edits, removed } = ripple(next, changes);
  return { edits, notice: removedNotice(removed) };
}

/** Where a Segment added at the playhead (`time`) goes on the Main Track: after the one playing there, else last. */
export function placeAfter(played: PlayedSegment[], time: number): number {
  const at = played.findIndex((shown) => time < shown.end);
  return at === -1 ? played.length : at + 1;
}

/** Where a Segment dropped at `time` goes on the Main Track: after each Segment whose middle is before it. */
export const placeDropped = (played: PlayedSegment[], time: number) => played.filter((shown) => (shown.start + shown.end) / 2 < time).length;

/** `segment` put in on the Main Track at `place`, picked. */
export function insertSegment(scene: PickContext, segment: ClipSegment, place: number): Outcome {
  const { segments } = scene.edits;
  return { edits: { ...scene.edits, segments: [...segments.slice(0, place), segment, ...segments.slice(place)] }, pick: picked({ kind: "segment", id: segment.id }) };
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
 * file's `lengthOf`). See draggedSegments.
 */
export function dragSegment(
  scene: PickContext,
  origin: SegmentDrag,
  id: string,
  change: { start: number; end: number; edge: "move" | "start" | "end" },
  lengthOf: (segment: ClipSegment) => number,
): Outcome {
  const segments = draggedSegments(origin.edits.segments, id, change, lengthOf, origin.shown, origin.planned);
  return { edits: { ...scene.edits, segments }, pick: scene.pick };
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
 * it aside.
 */
export function duplicate(scene: PickContext): Outcome | null {
  const { edits, duration } = scene;
  const { segments, layers } = pickedItems(scene);
  if (!segments.length && !layers.length) return null;
  const next = { ...edits };
  const copies: ItemRef[] = [];
  if (segments.length) {
    const last = edits.segments.indexOf(segments.at(-1)!);
    const block = segments.map((segment) => ({ ...segment, id: idOf(scene) }));
    next.segments = [...edits.segments.slice(0, last + 1), ...block, ...edits.segments.slice(last + 1)];
    copies.push(...block.map((segment) => ({ kind: "segment" as const, id: segment.id })));
  }
  if (layers.length) {
    const first = Math.min(...layers.map(({ item }) => item.start));
    const end = Math.max(...layers.map(({ item }) => item.start + item.secs));
    const room = end + (end - first) <= duration + 1e-6;
    for (const { kind, item } of layers) {
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
    const second: ClipSegment = { ...segment, id: idOf(scene), start: cut };
    next.segments = next.segments.flatMap((other) => (other.id === segment.id ? [{ ...segment, start: shown.source_start, end: cut }, second] : [other]));
    tails.push({ kind: "segment", id: second.id });
  }
  const time = round(at);
  for (const { kind, item } of layers) {
    if (!inside(scene, { kind, id: item.id }, at)) continue;
    const { first, second } = KINDS[kind].cut(item, time);
    const head = { ...item, secs: round(time - item.start), ...first } as Timed;
    const tail = { ...item, id: idOf(scene), start: time, secs: round(item.start + item.secs - time), ...second } as Timed;
    const list = KINDS[kind].list;
    Object.assign(next, { [list]: (next[list] as Timed[]).flatMap((other) => (other.id === item.id ? [head, tail] : [other])) });
    tails.push({ kind, id: tail.id });
  }
  return tails.length ? { edits: next, pick: picked(...tails) } : null;
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

/**
 * The picked Text Layers and Overlays moved on the frame by (`dx`, `dy`) output pixels, together: no
 * further than keeps each one's middle in the frame.
 */
export function nudge(scene: PickContext, dx: number, dy: number): Outcome | null {
  const placed = pickedItems(scene).layers.filter(({ kind }) => kind !== "music") as { kind: "text" | "overlay"; item: TextLayer | Overlay }[];
  if (!placed.length) return null;
  const within = (by: number, values: number[], size: number) => Math.min(Math.max(by, -Math.min(...values)), size - Math.max(...values));
  const byX = within(dx, placed.map(({ item }) => item.x), FRAME.width);
  const byY = within(dy, placed.map(({ item }) => item.y), FRAME.height);
  const next = { ...scene.edits };
  for (const { kind, item } of placed) {
    const list = KINDS[kind].list;
    Object.assign(next, {
      [list]: (next[list] as (TextLayer | Overlay)[]).map((other) => (other.id === item.id ? { ...other, x: Math.round(other.x + byX), y: Math.round(other.y + byY) } : other)),
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

/** What can be done to the picked items from the toolbar, the timeline's bar and the keyboard. */
export interface ItemActions {
  remove: () => void;
  duplicate: () => void;
  // Whether a picked item can be split at `time`: when it is inside it.
  canSplit: (time: number) => boolean;
  // At the playhead; nothing when it can't be.
  split: () => void;
  // Onto the Clipboard; cut also removes them.
  copy: () => void;
  cut: () => void;
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
    duplicate: () => run(duplicate(scene)),
    canSplit: (time) => canSplit(scene, time),
    split: () => run(split(scene, now())),
    ...clip,
  };
}
