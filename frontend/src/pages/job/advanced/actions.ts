import type { ClipSegment, MusicClip, Overlay, TextLayer } from "../../../api";
import type { PlayedSegment, Playback } from "../editor/playback";
import { ITEM_MIN_SECS, newId, round, type AdvancedEdits, type Picked } from "./edits";
import { SEGMENT_MIN_SECS } from "./MainTrack";

/** What can be done to the picked item from the toolbar, the timeline's bar and the keyboard. */
export interface ItemActions {
  remove: () => void;
  duplicate: () => void;
  // Whether the item can be split at `time`: when it is inside it.
  canSplit: (time: number) => boolean;
  // At the playhead; nothing when it can't be.
  split: () => void;
}

type Change = (next: Partial<AdvancedEdits>, group?: string) => void;
type Select = (picked: Picked) => void;
type Timed = TextLayer | MusicClip | Overlay;

/**
 * How each kind of timed item behaves: its list in the edits; where a copy goes when there is no
 * room after it (a text a little lower, so that both show); and, split in two, what each part keeps
 * (a song's or video's second part goes on from where the first stops in its file; a song has no
 * fades at the cut).
 */
const KINDS: {
  [K in "text" | "music" | "overlay"]: {
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

/**
 * What can be done to the picked item, when it is a Segment, a Text Layer, a Music Clip or an Overlay
 * (the hook can only be moved, a join only given a Transition): delete it, duplicate it (right after
 * it when there is room), and split it at the playhead. `played` is the Main Track as it plays, and
 * `gap` moves a time on the Source's timeline into the silence between Words nearest it.
 */
export function itemActions(
  edits: AdvancedEdits,
  picked: Picked,
  playback: Playback,
  played: PlayedSegment[],
  duration: number,
  gap: (time: number) => number,
  change: Change,
  select: Select,
): ItemActions | null {
  if (picked?.kind === "segment") return segmentActions(edits, picked.id, playback, played, gap, change, select);
  if (picked?.kind !== "text" && picked?.kind !== "music" && picked?.kind !== "overlay") return null;
  const kind = picked.kind;
  const behaviour = KINDS[kind];
  const list = edits[behaviour.list] as Timed[];
  const item = list.find((other) => other.id === picked.id);
  if (!item) return null;
  const put = (items: Timed[]) => change({ [behaviour.list]: items } as Partial<AdvancedEdits>);
  const canSplit = (time: number) => time > item.start + ITEM_MIN_SECS && time < item.start + item.secs - ITEM_MIN_SECS;
  return {
    remove() {
      put(list.filter((other) => other.id !== item.id));
      select(null);
    },
    duplicate() {
      const after = item.start + item.secs;
      const copy = { ...item, id: newId(), ...(after + item.secs <= duration + 1e-6 ? { start: after } : behaviour.aside(item)) } as Timed;
      put([...list, copy]);
      select({ kind, id: copy.id });
    },
    canSplit,
    split() {
      const at = round(playback.time);
      if (!canSplit(at)) return;
      const { first, second } = behaviour.cut(item, at);
      const head = { ...item, secs: round(at - item.start), ...first } as Timed;
      const tail = { ...item, id: newId(), start: at, secs: round(item.start + item.secs - at), ...second } as Timed;
      put(list.flatMap((other) => (other.id === item.id ? [head, tail] : [other])));
      select({ kind, id: tail.id });
    },
  };
}

/**
 * What can be done to a Segment of the Main Track: delete it (not the last one; the ones after it
 * close up), duplicate it right after itself, and split it at the playhead, where it is in the
 * Source (or its video) as played, Transitions and Word snapping included. A Segment of the Source
 * is cut in the silence between Words nearest the playhead: the backend snaps each part's edge to
 * the Words it holds, so a cut through a Word would give that Word to both.
 */
function segmentActions(
  edits: AdvancedEdits,
  id: string,
  playback: Playback,
  played: PlayedSegment[],
  gap: (time: number) => number,
  change: Change,
  select: Select,
): ItemActions | null {
  const index = edits.segments.findIndex((segment) => segment.id === id);
  const shown = played[index];
  if (index === -1 || !shown) return null;
  const segment = edits.segments[index];
  const canSplit = (time: number) => time > shown.start + SEGMENT_MIN_SECS && time < shown.end - SEGMENT_MIN_SECS;
  const put = (segments: ClipSegment[]) => change({ segments });
  return {
    remove() {
      if (edits.segments.length < 2) return;
      put(edits.segments.filter((other) => other.id !== id));
      select(null);
    },
    duplicate() {
      const copy = { ...segment, id: newId() };
      put([...edits.segments.slice(0, index + 1), copy, ...edits.segments.slice(index + 1)]);
      select({ kind: "segment", id: copy.id });
    },
    canSplit,
    split() {
      const at = playback.time;
      if (!canSplit(at)) return;
      const there = shown.source_start + at - shown.start;
      const cut = Math.round((segment.media ? there : gap(there)) * 1000) / 1000;
      const second = { ...segment, id: newId(), start: cut };
      put(edits.segments.flatMap((other) => (other.id === id ? [{ ...segment, start: shown.source_start, end: cut }, second] : [other])));
      select({ kind: "segment", id: second.id });
    },
  };
}
