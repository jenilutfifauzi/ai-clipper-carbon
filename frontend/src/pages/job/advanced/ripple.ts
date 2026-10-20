import type { AdjustmentLayer, MusicClip, Overlay, Shape, TextLayer } from "../../../api";
import { rekeyed } from "./keyActions";
import { fadesWithin, ITEM_MIN_SECS, keptOffset, round, type AdvancedEdits } from "./edits";
import { counted, listed, LISTS } from "./pick";

// The Magnetic timeline (GLOSSARY.md, docs/adr/0004-layers-ripple-with-the-main-track.md): the Text
// Layers, Shapes, Music Clips, Overlays, Adjustment Layers and the hook following the Main Track when it gets shorter or
// longer at a point.

/**
 * A change of the Main Track's length at one point, in Timeline time: the stretch from `at` to
 * `at + secs` cut out of it, or `secs` put in at `at`.
 */
export type TrackChange = { kind: "removed" | "inserted"; at: number; secs: number };

type Layer = TextLayer | Shape | MusicClip | Overlay | AdjustmentLayer;
type LayerKind = "text" | "shape" | "music" | "overlay" | "adjust";
const LAYER_KINDS: LayerKind[] = ["text", "shape", "music", "overlay", "adjust"];

/** What a ripple moves: the Text Layers, Shapes, Music Clips, Overlays, Adjustment Layers and the hook. */
export type Layers = Pick<AdvancedEdits, "text_layers" | "shapes" | "music" | "overlays" | "adjustment_layers" | "hook_start" | "hook_secs">;

/** How many layers of each kind a ripple removed. */
export type Removed = Record<LayerKind, number>;

// The hook's shortest time (hook_secs in backend/app/api.py).
export const HOOK_MIN_SECS = 0.5;

/**
 * Where an item from `start`, `secs` long, goes when the stretch from `a` to `b` is cut: unchanged
 * before it, moved up after it, cut where it is across an edge (`skipped` is how much of its start
 * was cut, so that a song or video goes on from where it was), or nothing when it was wholly inside.
 */
function cutOut(start: number, secs: number, a: number, b: number): { start: number; secs: number; skipped: number } | null {
  const end = start + secs;
  if (end <= a + 1e-6) return { start, secs, skipped: 0 };
  if (start >= b - 1e-6) return { start: start - (b - a), secs, skipped: 0 };
  if (start < a) return { start, secs: secs - (Math.min(end, b) - a), skipped: 0 };
  if (end > b + 1e-6) return { start: a, secs: end - b, skipped: b - start };
  return null;
}

/**
 * The layers and the hook after the Main Track `changes`, applied from the latest to the earliest so
 * that the earlier ones' times still hold. Cut out, a layer wholly inside the stretch, or left
 * shorter than the shortest a layer lasts, is removed; `removed` counts them by kind. The hook is
 * never removed: wholly inside, it moves to where the stretch was, as long as it was, or (where that
 * is the Clip's end, which `duration`, the Clip's length before, tells) to end there.
 */
export function ripple<T extends Layers>(edits: T, changes: TrackChange[], duration = Infinity): { edits: T; removed: Removed } {
  const removed: Removed = { text: 0, shape: 0, music: 0, overlay: 0, adjust: 0 };
  let next = edits;
  // Whether the hook was wholly inside a stretch cut out, and moved to where it was.
  let rehomed = false;
  for (const change of [...changes].sort((x, y) => y.at - x.at)) {
    const lists = {} as Partial<Layers>;
    for (const kind of LAYER_KINDS) {
      const list = LISTS[kind];
      // None of a list a Candidate from before it lacks (Adjustment Layers): left as it is.
      if (!next[list]) continue;
      const items = (next[list] as Layer[]).flatMap((item): Layer[] => {
        const moved = moveItem(item.start, item.secs, change);
        if (!moved || moved.secs < ITEM_MIN_SECS - 1e-6) {
          removed[kind] += 1;
          return [];
        }
        if (moved.start === item.start && moved.secs === item.secs) return [item];
        const secs = round(moved.secs);
        // A song or video goes on from as far into it as its start was cut (a video Overlay's, at its
        // Speed; in Reverse, as far as its end was).
        const offset = "offset" in item ? { offset: keptOffset(item, moved.skipped, moved.skipped + moved.secs) } : {};
        // A Music Clip cut shorter than its fades has them shortened with it.
        // An Adjustment Layer's are each held to half of it.
        const fades = kind === "music" ? fadesWithin(item as MusicClip, secs) : kind === "adjust" ? halved(item as AdjustmentLayer, secs) : {};
        // Its Keyframes of the part it still plays, from `skipped` of it (keyActions.ts' rekeyed).
        return [rekeyed({ ...item, start: round(moved.start), secs, ...offset, ...fades }, moved.skipped, moved.skipped + secs)];
      });
      Object.assign(lists, { [list]: items });
    }
    const moved = moveItem(next.hook_start, next.hook_secs, change);
    if (!moved) rehomed = true;
    const hook = moved ?? { start: change.at, secs: next.hook_secs };
    next = { ...next, ...lists, hook_start: round(hook.start), hook_secs: round(Math.max(hook.secs, HOOK_MIN_SECS)) };
  }
  const end = changes.reduce((length, change) => length + (change.kind === "inserted" ? change.secs : -change.secs), duration);
  if (rehomed && next.hook_start + next.hook_secs > end + 1e-6) next = { ...next, hook_start: round(Math.max(0, end - next.hook_secs)) };
  return { edits: next, removed };
}

// An Adjustment Layer's fades in `secs` of it: each at most half of it (ADR 0013).
function halved({ fade_in, fade_out }: AdjustmentLayer, secs: number): { fade_in: number; fade_out: number } {
  const half = Math.floor((secs / 2) * 100) / 100;
  return { fade_in: Math.min(fade_in, half), fade_out: Math.min(fade_out, half) };
}

function moveItem(start: number, secs: number, change: TrackChange): { start: number; secs: number; skipped: number } | null {
  if (change.kind === "removed") return cutOut(start, secs, change.at, change.at + change.secs);
  return start >= change.at - 1e-6 ? { start: start + change.secs, secs, skipped: 0 } : { start, secs, skipped: 0 };
}

/** What to tell of the layers a ripple removed, if any: "2 Text Layers and 1 Overlay inside the cut were removed." */
export function removedNotice(removed: Removed): string | undefined {
  const parts = LAYER_KINDS.filter((kind) => removed[kind] > 0).map((kind) => counted(removed[kind], kind));
  if (!parts.length) return undefined;
  const total = Object.values(removed).reduce((sum, count) => sum + count, 0);
  return `${listed(parts)} inside the cut ${total === 1 ? "was" : "were"} removed.`;
}
