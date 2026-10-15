import { useSyncExternalStore } from "react";
import type { ClipSegment, LayoutOverride, Transition, WordEdit } from "../../../api";
import { idOf, pickedItems, remove, type Outcome, type PickContext, type Timed, type TimedKind } from "./actions";
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
  // In Main Track order, each `at` seconds after the group's start as played, with the Transitions
  // between those that were next to each other.
  segments: { segment: ClipSegment; at: number }[];
  transitions: Transition[];
  // The Text Layers, Music Clips and Overlays, `at` seconds after the group's start: the first
  // Segment's, as played, when Segments were copied, else the first of them.
  layers: { kind: TimedKind; item: Timed; at: number }[];
  // The Word Edits and Layout Overrides in the ranges of the Segments of the Source, which come along
  // into another Candidate of the Job.
  word_edits: WordEdit[];
  layout_overrides: LayoutOverride[];
}

/** The Pick's Segments, Text Layers, Music Clips and Overlays, as copied from `from`. */
export function copy(scene: PickContext, from: Place): Clipboard | null {
  const { edits, played } = scene;
  const { segments, layers } = pickedItems(scene);
  if (!segments.length && !layers.length) return null;
  const start = segments.length ? (played[edits.segments.indexOf(segments[0])]?.start ?? 0) : Math.min(...layers.map(({ item }) => item.start));
  const copied = new Set(segments.map((segment) => segment.id));
  const transitions = edits.transitions.filter((transition) => {
    const index = edits.segments.findIndex((segment) => segment.id === transition.after);
    return copied.has(transition.after) && copied.has(edits.segments[index + 1]?.id);
  });
  const shows = (at: number) => segments.some((segment) => !segment.media && segment.start <= at && at <= segment.end);
  return {
    from,
    segments: segments.map((segment) => ({ segment, at: round((played[edits.segments.indexOf(segment)]?.start ?? 0) - start) })),
    transitions,
    layers: layers.map(({ kind, item }) => ({ kind, item, at: round(item.start - start) })),
    word_edits: edits.word_edits.filter((edit) => shows(edit.at)),
    layout_overrides: edits.layout_overrides.filter((override) => shows(override.at)),
  };
}

/** The Pick copied, and removed in one change. */
export function cut(scene: PickContext, from: Place): { clipboard: Clipboard; outcome: Outcome } | null {
  const clipboard = copy(scene, from);
  const outcome = remove(scene);
  return clipboard && outcome ? { clipboard, outcome } : null;
}

// How long a Transition of `secs` overlaps Segments `before` and `after` long (transition_overlap in
// backend/app/candidates.py): at most half the shorter.
const overlap = (secs: number, before: number, after: number) => Math.min(secs, Math.min(before, after) / 2);

const count = (n: number, one = "item", several = "items") => `${n} ${n === 1 ? one : several}`;

// Which of `words` holds `at` (on the Source's timeline), if one does.
const wordAt = (words: { start: number; end: number }[], at: number) => words.findIndex((word) => word.start <= at && at < word.end);

/**
 * `clipboard` pasted into the Candidate `to` as one change, every item new, the pasted items picked.
 * Its Segments go in at the join nearest the playhead (`at`), with the Transitions between them, and
 * the Segments after them play later; its Text Layers, Music Clips and Overlays keep their times from
 * there (from the playhead when there are no Segments). Whatever would run past the Clip's end is cut
 * short there, or left out when it would start there or be too short, and the owner is told.
 *
 * Into another Candidate of the Job, Segments of the Source bring the Word Edits and Layout Overrides
 * of their ranges, but where it has its own: a Word Edit of the same Word (by the Source's `words`)
 * or a Layout Override in that range. Into another Job, they are left out, with their Transitions.
 */
export function paste(scene: PickContext, clipboard: Clipboard, at: number, to: Place, words: { start: number; end: number }[] = []): Outcome {
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
  const sameJob = clipboard.from.job === to.job;
  const kept = clipboard.segments.filter(({ segment }) => sameJob || segment.media);
  const segments = kept.map(({ segment }) => ({ ...segment, id: fresh(segment.id) }));
  if (segments.length) {
    const joins = [0, ...played.map((shown) => shown.end)];
    const place = joins.reduce((best, join, i) => (Math.abs(join - at) < Math.abs(joins[best] - at) ? i : best), 0);
    // The group's start, where the first Segment pasted lands as far into it as it was.
    anchor = joins[place] - kept[0].at;
    next.segments = [...edits.segments.slice(0, place), ...segments, ...edits.segments.slice(place)];
    // Those between two Segments both pasted, next to each other as they were.
    const order = clipboard.segments.map(({ segment }) => segment.id);
    const transitions = clipboard.transitions
      .filter((transition) => ids.has(transition.after) && ids.has(order[order.indexOf(transition.after) + 1]))
      .map((transition) => ({ ...transition, after: ids.get(transition.after)! }));
    next.transitions = [...edits.transitions, ...transitions];
    const length = (segment: ClipSegment) => segment.end - segment.start;
    duration += segments.reduce((sum, segment) => sum + length(segment), 0);
    for (const transition of transitions) {
      const index = segments.findIndex((segment) => segment.id === transition.after);
      duration -= overlap(transition.secs, length(segments[index]), length(segments[index + 1]));
    }
    pasted.push(...segments.map((segment) => ({ kind: "segment" as const, id: segment.id })));
  }
  if (sameJob && to.candidate !== clipboard.from.candidate && segments.length) {
    const pastedRanges = kept.filter(({ segment }) => !segment.media).map(({ segment }) => segment);
    const inRange = (at: number) => pastedRanges.some((segment) => segment.start <= at && at <= segment.end);
    const sameWord = (a: number, b: number) => {
      const word = wordAt(words, a);
      return word === -1 ? a === b : word === wordAt(words, b);
    };
    const wordEdits = clipboard.word_edits.filter((edit) => inRange(edit.at) && !edits.word_edits.some((own) => sameWord(own.at, edit.at)));
    if (wordEdits.length) next.word_edits = [...edits.word_edits, ...wordEdits];
    const theirs = pastedRanges.filter((segment) => !edits.layout_overrides.some((own) => segment.start <= own.at && own.at <= segment.end));
    const overrides = clipboard.layout_overrides.filter((override) => theirs.some((segment) => segment.start <= override.at && override.at <= segment.end));
    if (overrides.length) next.layout_overrides = [...edits.layout_overrides, ...overrides];
  }
  let trimmed = 0;
  let skipped = 0;
  for (const { kind, item, at: after } of clipboard.layers) {
    // Kept inside the Clip: one that would start before it (it was before the first Segment pasted)
    // starts at its start, a song or video going on from as far into it.
    const from = round(anchor + after);
    const start = Math.max(from, 0);
    const end = Math.min(from + item.secs, duration);
    if (round(end - start) < ITEM_MIN_SECS) {
      skipped += 1;
      continue;
    }
    if (start > from || end < from + item.secs - 1e-6) trimmed += 1;
    const offset = start > from && "offset" in item ? { offset: round(item.offset + start - from) } : {};
    const copy = { ...item, ...offset, id: fresh(item.id), start, secs: round(end - start) } as Timed;
    Object.assign(next, { [LISTS[kind]]: [...(next[LISTS[kind]] as Timed[]), copy] });
    pasted.push({ kind, id: copy.id });
  }
  const left = clipboard.segments.length - kept.length;
  const told: string[] = [];
  if (left) told.push(`${count(left, "Segment", "Segments")} of this episode left out: another Job's clips can't show ${left === 1 ? "it" : "them"}.`);
  const fitted = [trimmed && `${count(trimmed)} cut short to fit`, skipped && `${count(skipped)} left out, falling outside the clip`];
  if (trimmed || skipped) told.push(`${fitted.filter(Boolean).join("; ")}.`);
  const notice = told.join(" ");
  return { edits: next, pick: picked(...pasted), ...(notice ? { notice } : {}) };
}

let current: Clipboard | null = null;
const listeners = new Set<() => void>();

/** What is copied now: kept for the browser tab, across Candidates and Jobs. */
export function setClipboard(clipboard: Clipboard) {
  current = clipboard;
  for (const listener of listeners) listener();
}

export function useClipboard(): Clipboard | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => current,
  );
}
