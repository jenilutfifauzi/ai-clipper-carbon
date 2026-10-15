import type { ClipSegment, MusicClip, Overlay, TextLayer } from "../../../api";
import type { PlayedSegment } from "../editor/playback";
import { ITEM_MIN_SECS, newId, round, type AdvancedEdits } from "./edits";
import { SEGMENT_MIN_SECS } from "./MainTrack";
import { isPicked, itemsOf, LISTS, onlyItem, picked, type ItemKind, type Pick } from "./pick";

/**
 * What the actions on a Pick are done in: the edits and the Pick, the Main Track as it plays, the
 * Clip's length, `gap` (which moves a time on the Source's timeline into the silence between Words
 * nearest it) and `ids` (new items' ids).
 */
export interface Scene {
  edits: AdvancedEdits;
  pick: Pick;
  played: PlayedSegment[];
  duration: number;
  gap: (time: number) => number;
  ids?: () => string;
}

/** An action's result: the edits after it (one change, so one step of undo), what is picked then, and what to tell. */
export interface Outcome {
  edits: AdvancedEdits;
  pick: Pick;
  notice?: string;
}

type Timed = TextLayer | MusicClip | Overlay;
type TimedKind = "text" | "music" | "overlay";

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

const idOf = (scene: Scene) => (scene.ids ?? newId)();

// The picked timed item of `kind` named `id`, and its list.
function timed(scene: Scene, kind: TimedKind, id: string) {
  const list = scene.edits[KINDS[kind].list] as Timed[];
  return { list, item: list.find((other) => other.id === id) };
}

/**
 * The picked items removed. The Main Track is never left empty: with every Segment picked, the first
 * stays, picked, and the owner is told.
 */
export function remove(scene: Scene): Outcome | null {
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
  if (next.segments.length) return { edits: next, pick: null };
  const first = edits.segments[0];
  const outcome = { pick: picked({ kind: "segment", id: first.id }), notice: "The first Segment stays: a clip needs at least one." };
  // Nothing but the Segments picked: nothing changes.
  if (itemsOf(pick).every((item) => item.kind === "segment")) return { edits, ...outcome };
  return { edits: { ...next, segments: [first] }, ...outcome };
}

/** Every Segment, Text Layer, Music Clip and Overlay picked (not the hook, the captions or a join). */
export function selectAll(edits: AdvancedEdits): Pick {
  const refs = (kind: ItemKind) => edits[LISTS[kind]].map((item) => ({ kind, id: item.id }));
  return picked(...refs("segment"), ...refs("text"), ...refs("music"), ...refs("overlay"));
}

/**
 * The Pick duplicated, the copy picked: a Segment right after itself; a Text Layer, Music Clip or
 * Overlay right after itself when there is room, else where its kind puts it aside.
 */
export function duplicate(scene: Scene): Outcome | null {
  const { edits, duration } = scene;
  const ref = onlyItem(scene.pick);
  if (!ref) return null;
  if (ref.kind === "segment") {
    const index = edits.segments.findIndex((segment) => segment.id === ref.id);
    if (index === -1) return null;
    const copy = { ...edits.segments[index], id: idOf(scene) };
    return {
      edits: { ...edits, segments: [...edits.segments.slice(0, index + 1), copy, ...edits.segments.slice(index + 1)] },
      pick: picked({ kind: "segment", id: copy.id }),
    };
  }
  const { list, item } = timed(scene, ref.kind, ref.id);
  if (!item) return null;
  const after = item.start + item.secs;
  const room = after + item.secs <= duration + 1e-6;
  const copy = { ...item, id: idOf(scene), ...(room ? { start: after } : KINDS[ref.kind].aside(item)) } as Timed;
  return { edits: { ...edits, [KINDS[ref.kind].list]: [...list, copy] }, pick: picked({ kind: ref.kind, id: copy.id }) };
}

/** Whether a picked item can be split at `time`: when it is inside it. */
export function canSplit(scene: Scene, time: number): boolean {
  return itemsOf(scene.pick).some((item) => {
    if (item.kind === "segment") {
      const shown = scene.played[scene.edits.segments.findIndex((segment) => segment.id === item.id)];
      return !!shown && time > shown.start + SEGMENT_MIN_SECS && time < shown.end - SEGMENT_MIN_SECS;
    }
    const found = timed(scene, item.kind, item.id).item;
    return !!found && time > found.start + ITEM_MIN_SECS && time < found.start + found.secs - ITEM_MIN_SECS;
  });
}

/**
 * The Pick split at the playhead (`at`), the second part picked. A Segment is cut where it is in the
 * Source (or its video) as played, Transitions and Word snapping included; one of the Source in the
 * silence between Words nearest the playhead, since the backend snaps each part's edge to the Words
 * it holds and a cut through a Word would give that Word to both.
 */
export function split(scene: Scene, at: number): Outcome | null {
  const { edits } = scene;
  const ref = onlyItem(scene.pick);
  if (!ref || !canSplit(scene, at)) return null;
  if (ref.kind === "segment") {
    const index = edits.segments.findIndex((segment) => segment.id === ref.id);
    const segment = edits.segments[index];
    const shown = scene.played[index];
    const there = shown.source_start + at - shown.start;
    const cut = Math.round((segment.media ? there : scene.gap(there)) * 1000) / 1000;
    const second: ClipSegment = { ...segment, id: idOf(scene), start: cut };
    const segments = edits.segments.flatMap((other) => (other.id === ref.id ? [{ ...segment, start: shown.source_start, end: cut }, second] : [other]));
    return { edits: { ...edits, segments }, pick: picked({ kind: "segment", id: second.id }) };
  }
  const { list, item } = timed(scene, ref.kind, ref.id);
  if (!item) return null;
  const time = round(at);
  const { first, second } = KINDS[ref.kind].cut(item, time);
  const head = { ...item, secs: round(time - item.start), ...first } as Timed;
  const tail = { ...item, id: idOf(scene), start: time, secs: round(item.start + item.secs - time), ...second } as Timed;
  return {
    edits: { ...edits, [KINDS[ref.kind].list]: list.flatMap((other) => (other.id === item.id ? [head, tail] : [other])) },
    pick: picked({ kind: ref.kind, id: tail.id }),
  };
}

/** What can be done to the picked items from the toolbar, the timeline's bar and the keyboard. */
export interface ItemActions {
  remove: () => void;
  duplicate: () => void;
  // Whether a picked item can be split at `time`: when it is inside it.
  canSplit: (time: number) => boolean;
  // At the playhead; nothing when it can't be.
  split: () => void;
}

/**
 * The actions on the picked items, when some are, each applied (`apply`) as one change: `now` is the
 * playhead's time.
 */
export function itemActions(scene: Scene, now: () => number, apply: (outcome: Outcome) => void): ItemActions | null {
  if (!itemsOf(scene.pick).length) return null;
  const run = (outcome: Outcome | null) => outcome && apply(outcome);
  return {
    remove: () => run(remove(scene)),
    duplicate: () => run(duplicate(scene)),
    canSplit: (time) => canSplit(scene, time),
    split: () => run(split(scene, now())),
  };
}
