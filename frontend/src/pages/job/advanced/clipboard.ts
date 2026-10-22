import { useSyncExternalStore } from "react";
import type { ClipSegment, CueEdit, LayoutOverride, MusicClip, Transition, WordEdit } from "../../../api";
import { trackLength } from "../editor/segmentTime";
import { rekeyed } from "./keyActions";
import { fadesHalved, idOf, pickedItems, remove, stillDetached, withJoins, type Outcome, type PickContext, type Timed, type TimedKind } from "./actions";
import { ITEM_MIN_SECS, keptOffset, round } from "./edits";
import { counted, listed, LISTS, picked, trackOf, type ItemKind, type ItemRef } from "./pick";
import { ripple } from "./ripple";
import { byKey, sameKey, segmentHolds, type TimelineKey } from "../editor/timelineKey";

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
  // The Text Layers, Shapes, Music Clips and Overlays, `at` seconds after the group's start: the first
  // Segment's, as played, when Segments were copied, else the first of them.
  layers: { kind: TimedKind; item: Timed; at: number }[];
  // The Word Edits and Layout Overrides in the ranges of the Segments of the Source, which come along
  // into another Candidate of the Job; and the Word Edits in the ranges of the videos' Segments, of
  // their videos (ADR 0020), which come along into any Candidate.
  word_edits: WordEdit[];
  layout_overrides: LayoutOverride[];
  // The Cue Edits in the ranges of the Segments, each on its own timeline (the Source's, or its item's):
  // the Source's come along into another Candidate of the Job, an item's into any Candidate.
  cue_edits: CueEdit[];
}

/** The Pick's Segments, Text Layers, Shapes, Music Clips and Overlays, as copied from `from`. */
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
  const shows = (key: TimelineKey) => segments.some((segment) => segmentHolds(segment, key));
  return {
    from,
    segments: segments.map((segment) => ({ segment, at: round((played[edits.segments.indexOf(segment)]?.start ?? 0) - start) })),
    transitions,
    layers: layers.map(({ kind, item }) => ({ kind, item, at: round(item.start - start) })),
    word_edits: edits.word_edits.filter(shows),
    layout_overrides: edits.layout_overrides.filter(shows),
    cue_edits: edits.cue_edits.filter(shows),
  };
}

/** The Pick copied, and removed in one change. */
export function cut(scene: PickContext, from: Place): { clipboard: Clipboard; outcome: Outcome } | null {
  const clipboard = copy(scene, from);
  const outcome = remove(scene);
  return clipboard && outcome ? { clipboard, outcome } : null;
}

const count = (n: number, one = "item", several = "items") => `${n} ${n === 1 ? one : several}`;

// Which of `words` holds `at` (on the Source's timeline), if one does.
const wordAt = (words: { start: number; end: number }[], at: number) => words.findIndex((word) => word.start <= at && at < word.end);

/**
 * `clipboard` pasted into the Candidate `to` as one change, every item new, the pasted items picked.
 * Its Segments go in at the join nearest the playhead (`at`), with the Transitions between them, and
 * the Segments after them play later (on the Magnetic timeline, the layers after them too); its Text
 * Layers, Shapes, Music Clips and Overlays keep their times from there (from the playhead when there are no
 * Segments). Whatever would run past the Clip's end is cut
 * short there, or left out when it would start there or be too short, and the owner is told.
 *
 * Into another Candidate of the Job, Segments of the Source bring the Word Edits, Cue Edits and Layout
 * Overrides of their ranges, but where it has its own: a Word Edit or Cue Edit of the same Word (by the
 * Source's `words`) or a Layout Override in that range. Into another Job, they are left out, with their
 * Transitions, and so are Music Clips of the Source's sound. Into another Candidate, a Music Clip is no
 * longer Detached from a Segment (GLOSSARY.md, Detach). Segments of a video bring its Word Edits and
 * Cue Edits of their ranges of it (ADR 0020) into any Candidate, but where it has its own at that key
 * (`sameKey`).
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
  const locked = scene.locked ?? [];
  // What the locked Tracks don't take, by kind.
  const refused = new Map<ItemKind, number>();
  const refuse = (kind: ItemKind) => refused.set(kind, (refused.get(kind) ?? 0) + 1);
  const unlocked = locked.includes("video") ? [] : clipboard.segments;
  if (clipboard.segments.length > unlocked.length) refused.set("segment", clipboard.segments.length);
  const kept = unlocked.filter(({ segment }) => sameJob || segment.media);
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
    duration += trackLength(
      segments,
      segments.map((segment) => transitions.find((transition) => transition.after === segment.id)?.secs ?? null),
    );
    pasted.push(...segments.map((segment) => ({ kind: "segment" as const, id: segment.id })));
    // On the Magnetic timeline, the layers already there after the join play later.
    if (scene.magnetic) Object.assign(next, ripple(next, [{ kind: "inserted", at: joins[place], secs: duration - scene.duration }]).edits);
  }
  // The Word Edits or Cue Edits the pasted Segments bring: those each shows of its timeline, an item's
  // into any Candidate, the Source's only into another Candidate of the Job (in its own they are there
  // already); not where the Candidate has its own, of that key (an item's) or that Word (the Source's).
  const into = sameJob && to.candidate !== clipboard.from.candidate;
  const sameWord = (a: number, b: number) => {
    const word = wordAt(words, a);
    return word === -1 ? a === b : word === wordAt(words, b);
  };
  const brought = <E extends { at: number; media?: string | null }>(copied: E[], own: E[]) =>
    copied.filter(
      (edit) =>
        (edit.media || into) &&
        kept.some(({ segment }) => segmentHolds(segment, edit)) &&
        !own.some((mine) => (edit.media ? sameKey(mine, edit) : !mine.media && sameWord(mine.at, edit.at))),
    );
  const wordEdits = brought(clipboard.word_edits, edits.word_edits);
  if (wordEdits.length) next.word_edits = [...edits.word_edits, ...wordEdits].sort(byKey);
  const cueEdits = brought(clipboard.cue_edits ?? [], edits.cue_edits);
  if (cueEdits.length) next.cue_edits = [...edits.cue_edits, ...cueEdits];
  if (into && segments.length) {
    const pastedRanges = kept.filter(({ segment }) => !segment.media).map(({ segment }) => segment);
    const theirs = pastedRanges.filter((segment) => !edits.layout_overrides.some((own) => segment.start <= own.at && own.at <= segment.end));
    const overrides = clipboard.layout_overrides.filter((override) => theirs.some((segment) => segment.start <= override.at && override.at <= segment.end));
    if (overrides.length) next.layout_overrides = [...edits.layout_overrides, ...overrides];
  }
  let trimmed = 0;
  let skipped = 0;
  // Music Clips of the Source's sound, which another Job's clips can't play.
  let unheard = 0;
  for (const { kind, item, at: after } of clipboard.layers) {
    if (locked.includes(trackOf(kind, item as { behind?: boolean }))) {
      refuse(kind);
      continue;
    }
    if (kind === "music" && (item as MusicClip).media === null && !sameJob) {
      unheard += 1;
      continue;
    }
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
    // A song or video goes on from where it is at its new start (an Overlay in Reverse, at its new end).
    const offset = "offset" in item ? { offset: keptOffset(item, start - from, end - from) } : {};
    // Its Keyframes come as they are, but for the part cut off (keyActions.ts' rekeyed). A Detached
    // sound stays Detached from its Segment only in its own Candidate, while the Segment is there.
    // An Adjustment Layer cut short keeps its fades within half of it.
    const copy = stillDetached(
      fadesHalved(rekeyed({ ...item, ...offset, id: fresh(item.id), start, secs: round(end - start) } as Timed, start - from, end - from)),
      sameJob && to.candidate === clipboard.from.candidate ? next.segments : [],
    );
    Object.assign(next, { [LISTS[kind]]: [...((next[LISTS[kind]] ?? []) as Timed[]), copy] });
    pasted.push({ kind, id: copy.id });
  }
  const left = unlocked.length - kept.length;
  const told: string[] = [];
  if (left) told.push(`${count(left, "Segment", "Segments")} of this episode left out: another Job's clips can't show ${left === 1 ? "it" : "them"}.`);
  if (unheard) told.push(`${count(unheard, "Music Clip", "Music Clips")} of this episode's sound left out: another Job's clips can't play ${unheard === 1 ? "it" : "them"}.`);
  const fitted = [trimmed && `${count(trimmed)} cut short to fit`, skipped && `${count(skipped)} left out, falling outside the clip`];
  if (trimmed || skipped) told.push(`${fitted.filter(Boolean).join("; ")}.`);
  if (refused.size) {
    told.push(`${listed([...refused].map(([kind, n]) => counted(n, kind)))} left out: their Tracks are locked.`);
  }
  const notice = told.join(" ");
  return withJoins(scene, { edits: next, pick: picked(...pasted), ...(notice ? { notice } : {}) });
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
