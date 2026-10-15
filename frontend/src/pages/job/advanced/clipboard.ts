import { useSyncExternalStore } from "react";
import type { ClipSegment, Transition } from "../../../api";
import { idOf, pickedItems, remove, type Outcome, type Scene, type Timed, type TimedKind } from "./actions";
import { ITEM_MIN_SECS, round } from "./edits";
import { LISTS, picked, type ItemRef } from "./pick";

// The Clipboard (GLOSSARY.md): the Advanced Edit's copied items, kept in memory while the browser tab
// is open, keeping their order and their times relative to one another.

/** A Candidate of a Job: where the Clipboard was copied from, or where it is pasted. */
export interface Place {
  job: string;
  candidate: string;
}

export interface Clipboard {
  from: Place;
  // In Main Track order, with the Transitions between those that were next to each other.
  segments: ClipSegment[];
  transitions: Transition[];
  // The Text Layers, Music Clips and Overlays, `at` seconds after the group's start: the first
  // Segment's, as played, when Segments were copied, else the first of them.
  layers: { kind: TimedKind; item: Timed; at: number }[];
}

/** The Pick's Segments, Text Layers, Music Clips and Overlays, as copied from `from`. */
export function copy(scene: Scene, from: Place): Clipboard | null {
  const { edits, played } = scene;
  const { segments, layers } = pickedItems(scene);
  if (!segments.length && !layers.length) return null;
  const start = segments.length ? (played[edits.segments.indexOf(segments[0])]?.start ?? 0) : Math.min(...layers.map(({ item }) => item.start));
  const copied = new Set(segments.map((segment) => segment.id));
  const transitions = edits.transitions.filter((transition) => {
    const index = edits.segments.findIndex((segment) => segment.id === transition.after);
    return copied.has(transition.after) && copied.has(edits.segments[index + 1]?.id);
  });
  return { from, segments, transitions, layers: layers.map(({ kind, item }) => ({ kind, item, at: round(item.start - start) })) };
}

/** The Pick copied, and removed in one change. */
export function cut(scene: Scene, from: Place): { clipboard: Clipboard; outcome: Outcome } | null {
  const clipboard = copy(scene, from);
  const outcome = remove(scene);
  return clipboard && outcome ? { clipboard, outcome } : null;
}

// How long a Transition of `secs` overlaps Segments `before` and `after` long (transition_overlap in
// backend/app/candidates.py): at most half the shorter.
const overlap = (secs: number, before: number, after: number) => Math.min(secs, Math.min(before, after) / 2);

const count = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/**
 * `clipboard` pasted into the Candidate `to` as one change, every item new, the pasted items picked.
 * Its Segments go in at the join nearest the playhead (`at`), with the Transitions between them, and
 * the Segments after them play later; its Text Layers, Music Clips and Overlays keep their times from
 * there (from the playhead when there are no Segments). Whatever would run past the Clip's end is cut
 * short there, or left out when it would start there or be too short, and the owner is told.
 */
export function paste(scene: Scene, clipboard: Clipboard, at: number, _to: Place): Outcome {
  const { edits, played } = scene;
  const ids = new Map<string, string>();
  const fresh = (id: string) => {
    const next = idOf(scene);
    ids.set(id, next);
    return next;
  };
  const next = { ...edits };
  const pasted: ItemRef[] = [];
  let anchor = at;
  let duration = scene.duration;
  const segments = clipboard.segments.map((segment) => ({ ...segment, id: fresh(segment.id) }));
  if (segments.length) {
    const joins = [0, ...played.map((shown) => shown.end)];
    const place = joins.reduce((best, join, i) => (Math.abs(join - at) < Math.abs(joins[best] - at) ? i : best), 0);
    anchor = joins[place];
    next.segments = [...edits.segments.slice(0, place), ...segments, ...edits.segments.slice(place)];
    const transitions = clipboard.transitions.map((transition) => ({ ...transition, after: ids.get(transition.after)! }));
    next.transitions = [...edits.transitions, ...transitions];
    const length = (segment: ClipSegment) => segment.end - segment.start;
    duration += segments.reduce((sum, segment) => sum + length(segment), 0);
    for (const transition of transitions) {
      const index = segments.findIndex((segment) => segment.id === transition.after);
      duration -= overlap(transition.secs, length(segments[index]), length(segments[index + 1]));
    }
    pasted.push(...segments.map((segment) => ({ kind: "segment" as const, id: segment.id })));
  }
  let trimmed = 0;
  let skipped = 0;
  for (const { kind, item, at: after } of clipboard.layers) {
    const start = round(anchor + after);
    if (start >= duration - 1e-6) {
      skipped += 1;
      continue;
    }
    let copy = { ...item, id: fresh(item.id), start } as Timed;
    if (start + item.secs > duration + 1e-6) {
      const secs = round(duration - start);
      if (secs < ITEM_MIN_SECS) {
        skipped += 1;
        continue;
      }
      copy = { ...copy, secs };
      trimmed += 1;
    }
    Object.assign(next, { [LISTS[kind]]: [...(next[LISTS[kind]] as Timed[]), copy] });
    pasted.push({ kind, id: copy.id });
  }
  const told = [trimmed && `${count(trimmed)} cut short at the clip's end`, skipped && `${count(skipped)} left out, starting past the clip's end`];
  const notice = told.filter(Boolean).join("; ");
  return { edits: next, pick: picked(...pasted), ...(notice ? { notice: `${notice}.` } : {}) };
}

let held: Clipboard | null = null;
const listeners = new Set<() => void>();

/** What is copied now: kept for the browser tab, across Candidates and Jobs. */
export function hold(clipboard: Clipboard) {
  held = clipboard;
  for (const listener of listeners) listener();
}

export function useClipboard(): Clipboard | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => held,
  );
}
