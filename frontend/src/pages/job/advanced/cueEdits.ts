import { CUE_SHIFT_MAX_SECS, type Cue, type CueEdit, type CueKey, type PreviewWord, type RenderPlan } from "../../../api";
import { cueWords } from "../editor/cues";
import { lineWords, withWordEdit } from "../editor/wordEdits";
import type { Outcome, Splitter } from "./actions";
import type { AdvancedEdits } from "./edits";
import { sameCue } from "./pick";
import type { TrackKind } from "./trackState";

// A picked Cue retimed on the Captions Track, split, merged with the next or emptied: its Cue Edit
// (GLOSSARY.md) and Word Edits written as the planner applies them (_captions in
// backend/app/planner.py, which is the rule), so that what is dropped is what is planned.

// The shortest a retimed Cue is shown (CAPTION_MIN_SECS in backend/app/planner.py).
export const CUE_MIN_SECS = 0.2;
// How far from a Cue's key a Cue Edit names it, when written at another time in its first Word
// (WORD_EDIT_REACH_SECS in backend/app/planner.py).
const REACH_SECS = 0.25;

/** What the Cue actions are done in: the edits, the plan of them (and its Words), and the locked Tracks. */
export interface CueScene {
  edits: AdvancedEdits;
  plan: RenderPlan | null;
  // The Preview Plan's Words, which Split, Merge and Delete find a Cue's Words among.
  words?: PreviewWord[];
  locked?: TrackKind[];
}

/**
 * A Cue as the Captions Track shows it: from `start` to `end` (seconds into the Clip; its entries
 * either side of a Layout change taken as one), at its Segment's `speed`, and where it may be retimed
 * to, from `low` to `high`: its Segment (between the cuts either side of it, a Transition's at its
 * middle), after the Cue before ends and before the Cue after starts.
 */
export interface ShownCue {
  start: number;
  end: number;
  speed: number;
  low: number;
  high: number;
  edited: boolean;
}

/** The Cue of `plan` keyed `key`, as the Captions Track shows it; null when there is none. */
export function cueOf(plan: RenderPlan, key: CueKey): ShownCue | null {
  const cues = plan.captions;
  const first = cues.findIndex((cue) => sameCue(cue.key, key));
  if (first < 0) return null;
  let last = first;
  while (last + 1 < cues.length && sameCue(cues[last + 1].key, key)) last += 1;
  const { start } = cues[first];
  const { end } = cues[last];
  const duration = plan.segments.length ? plan.segments[plan.segments.length - 1].end : plan.end - plan.start;
  // The cuts: where a Segment ends and the next starts, or the middle of their Transition's overlap.
  const cuts = plan.segments.slice(1).map((next, i) => (Math.min(next.start, plan.segments[i].end) + plan.segments[i].end) / 2);
  const edges = [0, ...cuts, duration];
  const after = edges.findIndex((edge, i) => i > 0 && start < edge);
  const part = after < 0 ? edges.length - 2 : after - 1;
  const speed = plan.segments[part]?.speed ?? 1;
  const low = Math.max(edges[part], first > 0 ? cues[first - 1].end : 0);
  const high = Math.min(edges[part + 1] ?? duration, last + 1 < cues.length ? cues[last + 1].start : duration);
  return { start, end, speed, low, high, edited: cues[first].edited };
}

/** Each Cue of `plan` once (its first entry, of those either side of a Layout change), as the Captions Track shows it. */
export function shownCues(plan: RenderPlan): { cue: Cue; shown: ShownCue }[] {
  return plan.captions.flatMap((cue, i) => {
    if (i > 0 && sameCue(plan.captions[i - 1].key, cue.key)) return [];
    const shown = cueOf(plan, cue.key);
    return shown ? [{ cue, shown }] : [];
  });
}

/**
 * The Cue Edit of `edits` on the Cue keyed `key`, if it has one: on its timeline, the one nearest
 * its key of those whose nearest Cue it is (one written at another time in its first Word).
 */
export function cueEditOf(edits: CueEdit[], plan: RenderPlan, key: CueKey): CueEdit | null {
  const keys = plan.captions.map((cue) => cue.key).filter((other) => (other.media ?? null) === (key.media ?? null));
  let found: CueEdit | null = null;
  for (const edit of edits) {
    if ((edit.media ?? null) !== (key.media ?? null)) continue;
    const distance = Math.abs(edit.at - key.at);
    if (distance >= REACH_SECS || keys.some((other) => Math.abs(edit.at - other.at) < distance)) continue;
    if (!found || distance < Math.abs(found.at - key.at)) found = edit;
  }
  return found;
}

// Seconds of a Cue Edit, to the millisecond, as far as it may go.
const secs = (value: number) => Math.round(Math.min(Math.max(value, -CUE_SHIFT_MAX_SECS), CUE_SHIFT_MAX_SECS) * 1000) / 1000;

// Whether a Cue Edit retimes its Cue, or places or sizes it (cuePlace.ts).
const timed = (edit: CueEdit) => edit.shift !== 0 || edit.start_delta !== 0 || edit.end_delta !== 0;
export const placed = (edit: CueEdit) => edit.x != null || edit.y != null || edit.scale != null;
// A Cue Edit that changes nothing of its Cue but where it starts one.
export const empty = (edit: CueEdit) => !timed(edit) && !placed(edit);

// A Cue Edit at `at` on `media`'s timeline (the Source's when null) that only starts a Cue there, or
// with `join` keeps it with the one before.
const bare = (at: number, media: string | null, join = false): CueEdit => ({ at, media, shift: 0, start_delta: 0, end_delta: 0, join });

/** `edits` with the Cue Edit `before` (or, when it is null, none) changed to `after` (or dropped, when it is null). */
export function withCueEdit(edits: AdvancedEdits, before: CueEdit | null, after: CueEdit | null): AdvancedEdits {
  const kept = edits.cue_edits.filter((edit) => edit !== before);
  return { ...edits, cue_edits: after ? [...kept, after].sort((a, b) => (a.media ?? "").localeCompare(b.media ?? "") || a.at - b.at) : kept };
}

/** Where a drag of a picked Cue began: its Cue Edit then, and where it was shown. */
export interface CueDragStart {
  edit: CueEdit | null;
  start: number;
  end: number;
}

/**
 * The picked Cue keyed `key` dragged by its body (`move`) or an edge to `range` (seconds into the
 * Clip), from where it was as the drag began (`from`; null: where the plan shows it now): its Cue
 * Edit's `shift`, `start_delta` or `end_delta` goes on from then by as far as it moved, kept as the
 * planner keeps it (between `low` and `high`, CUE_MIN_SECS long at least), times its Segment's Speed.
 * Null while the Captions Track is locked or the plan has no such Cue.
 */
export function retimeCue(
  scene: CueScene,
  key: CueKey,
  range: { start: number; end: number; edge: "move" | "start" | "end" },
  from: CueDragStart | null,
): Outcome | null {
  const { edits, plan } = scene;
  if (scene.locked?.includes("captions") || !plan) return null;
  const shown = cueOf(plan, key);
  if (!shown) return null;
  const current = cueEditOf(edits.cue_edits, plan, key);
  const origin = from ?? { edit: current, start: shown.start, end: shown.end };
  // A join that didn't take (its Cue doesn't fit the one before) starts its Cue: retimed, it is a start.
  const begun = origin.edit ? { ...origin.edit, join: false } : bare(key.at, key.media ?? null);
  const { low, high, speed } = shown;
  let next: CueEdit;
  if (range.edge === "move") {
    const length = origin.end - origin.start;
    const start = Math.max(low, Math.min(range.start, high - length));
    next = { ...begun, shift: secs(begun.shift + (start - origin.start) * speed) };
  } else if (range.edge === "start") {
    const start = Math.max(low, Math.min(range.start, origin.end - CUE_MIN_SECS));
    next = { ...begun, start_delta: secs(begun.start_delta + (start - origin.start) * speed) };
  } else {
    const end = Math.min(high, Math.max(range.end, origin.start + CUE_MIN_SECS));
    next = { ...begun, end_delta: secs(begun.end_delta + (end - origin.end) * speed) };
  }
  return { edits: withCueEdit(edits, current, next), pick: { kind: "cue", key } };
}

/**
 * Whether the Cue keyed `key` starts where it does only by its Cue Edit (as Split leaves it): it
 * would otherwise go on in the Cue before, which it fits (`joinable`) and which nothing else parts it
 * from (not `needs_join`). A break before its first Word may part them too; its Cue Edit then stays
 * all the same, which changes nothing.
 */
function startsByItsEdit(plan: RenderPlan, key: CueKey): boolean {
  const cue = plan.captions.find((other) => sameCue(other.key, key));
  return !!cue && cue.joinable && !cue.needs_join;
}

/**
 * The Cue Edit of the Cue keyed `key` once Reset timing or Reset position has cleared some of its
 * fields (`reset`): null (dropped) when nothing is left of it, unless it is what starts its Cue there
 * (startsByItsEdit: a Split's), when it stays as a bare start.
 */
export function afterReset(plan: RenderPlan, key: CueKey, reset: CueEdit): CueEdit | null {
  return empty(reset) && !startsByItsEdit(plan, key) ? null : reset;
}

/**
 * Reset timing on the picked Cue keyed `key`: its Cue Edit's `shift`, `start_delta` and
 * `end_delta` cleared, the Cue Edit kept as afterReset says. Null when it has no timing to reset, or
 * while the Captions Track is locked.
 */
export function resetCueTiming(scene: CueScene, key: CueKey): Outcome | null {
  const { edits, plan } = scene;
  if (scene.locked?.includes("captions") || !plan) return null;
  const current = cueEditOf(edits.cue_edits, plan, key);
  if (!current || !timed(current)) return null;
  const reset = { ...current, shift: 0, start_delta: 0, end_delta: 0 };
  return { edits: withCueEdit(edits, current, afterReset(plan, key, reset)), pick: { kind: "cue", key } };
}

// A Media Library item's Words say which item (ticket 06); the Source's say none.
const mediaOf = (word: PreviewWord) => (word as PreviewWord & { media?: string | null }).media ?? null;

/**
 * The Cue keyed `key`: its first entry in the plan, the entry the playhead `time` is in (of those
 * either side of a Layout change; else the first), and the Preview Plan's Words it shows, in order,
 * on its timeline (none when they can't be found). Null when the plan has no such Cue.
 */
function cueParts(scene: CueScene, key: CueKey, time?: number): { entry: Cue; words: PreviewWord[] } | null {
  const entries = scene.plan?.captions.filter((cue) => sameCue(cue.key, key)) ?? [];
  if (!entries.length) return null;
  const entry = (time !== undefined && entries.find((cue) => cue.start <= time && time < cue.end)) || entries[0];
  const own = (scene.words ?? []).filter((word) => mediaOf(word) === (key.media ?? null));
  return { entry, words: lineWords(entries[0], own) };
}

/**
 * The Word Split at the playhead (`time`) starts a Cue at, in the Cue keyed `key` while it is shown:
 * the first after its first highlighted from after `time`. Null when there is none.
 */
export function splitWord(scene: CueScene, key: CueKey, time: number): PreviewWord | null {
  const shown = scene.plan && cueOf(scene.plan, key);
  const parts = cueParts(scene, key, time);
  if (!shown || !parts || time < shown.start || time >= shown.end) return null;
  // Highlights are kept within their entry: in the one shown at `time`, one starts after it exactly when its Word does.
  const index = cueWords(parts.entry).findIndex((word, i) => i > 0 && word.start > time);
  return index > 0 ? (parts.words[index] ?? null) : null;
}

/**
 * Split (Cmd/Ctrl+B) on the picked Cue keyed `key` at the playhead (`time`): a Cue Edit at the first
 * of its Words after it (splitWord), which then starts a Cue; this one stays picked (the new one isn't in
 * the plan until it is planned again, and would drop out of the Pick). A join on that Word gives way
 * to it. Null when there is no such Word, or while the Captions Track is locked.
 */
export function splitCue(scene: CueScene, key: CueKey, time: number): Outcome | null {
  const { edits, plan } = scene;
  if (scene.locked?.includes("captions") || !plan) return null;
  const word = splitWord(scene, key, time);
  if (!word) return null;
  const media = key.media ?? null;
  const words = cueParts(scene, key)!.words;
  // Inside a Cue only a join can be on a Word: one within reach of it, nearer it than the Cue's other Words.
  const there = edits.cue_edits.find(
    (edit) =>
      (edit.media ?? null) === media &&
      Math.abs(edit.at - word.at) < REACH_SECS &&
      words.every((other) => Math.abs(edit.at - word.at) <= Math.abs(edit.at - other.at)),
  );
  return { edits: withCueEdit(edits, there ?? null, bare(word.at, media)), pick: { kind: "cue", key } };
}

/** Split at the playhead (`now`) on the picked Cue keyed `key`, from the Timeline's bar, the phone's toolbar and Cmd/Ctrl+B. */
export function cueSplitter(scene: CueScene, key: CueKey, now: () => number, apply: (outcome: Outcome) => void): Splitter {
  return {
    canSplit: (time) => !scene.locked?.includes("captions") && !!splitWord(scene, key, time),
    split: () => {
      const outcome = splitCue(scene, key, now());
      if (outcome) apply(outcome);
    },
  };
}

/** The Cue shown after the one keyed `key`, if there is one. */
export function nextCue(plan: RenderPlan, key: CueKey): Cue | null {
  const last = plan.captions.findLastIndex((cue) => sameCue(cue.key, key));
  return last < 0 ? null : (plan.captions[last + 1] ?? null);
}

/**
 * Merge with next on the picked Cue keyed `key`: the next Cue's own Cue Edit goes, as does the
 * break before its first Word, and where a pause, a sentence's end or the longest-Cue limit would
 * still part them (`needs_join`) a `join` Cue Edit keeps it with this one. Null when the next Cue
 * doesn't fit (isn't `joinable`), or while the Captions Track is locked.
 */
export function mergeCue(scene: CueScene, key: CueKey): Outcome | null {
  const { edits, plan } = scene;
  if (scene.locked?.includes("captions") || !plan) return null;
  const next = nextCue(plan, key);
  if (!next?.joinable) return null;
  const join = next.needs_join ? bare(next.key.at, next.key.media ?? null, true) : null;
  let merged = withCueEdit(edits, cueEditOf(edits.cue_edits, plan, next.key), join);
  const first = cueParts(scene, next.key)?.words[0];
  if (first?.edit?.break_before) merged = { ...merged, word_edits: withWordEdit(merged.word_edits, first, { break_before: false }) };
  return { edits: merged, pick: { kind: "cue", key } };
}

/**
 * Delete on the picked Cue keyed `key`: each of its Words removed by an empty-text Word Edit, as one
 * change (the sound is untouched), and nothing picked. Null when its Words can't be found, or while
 * the Captions Track is locked.
 */
export function deleteCue(scene: CueScene, key: CueKey): Outcome | null {
  const { edits, plan } = scene;
  if (scene.locked?.includes("captions") || !plan) return null;
  const words = cueParts(scene, key)?.words ?? [];
  if (!words.length) return null;
  return { edits: { ...edits, word_edits: words.reduce((next, word) => withWordEdit(next, word, { text: "" }), edits.word_edits) }, pick: null };
}

/** The Preview Plan's Words the Cue keyed `key` shows, in order: its chips. None when they can't be found. */
export function wordsOfCue(scene: CueScene, key: CueKey): PreviewWord[] {
  return cueParts(scene, key)?.words ?? [];
}

/**
 * The picked Cue keyed `key` retyped from its chips (the clip editor's caption text editor): the
 * Candidate's Word Edits become `wordEdits`, the Cue still picked. Null while the Captions Track is locked.
 */
export function retypeCue(scene: CueScene, key: CueKey, wordEdits: AdvancedEdits["word_edits"]): Outcome | null {
  if (scene.locked?.includes("captions")) return null;
  return { edits: { ...scene.edits, word_edits: wordEdits }, pick: { kind: "cue", key } };
}

/**
 * The inspector's start and end fields of a picked Cue: each value set moves that edge there (as an
 * edge drag on the Captions Track does, retimeCue). A run of sets on one edge, each writing on the last
 * one's Cue Edit, goes on from where the Cue was shown as the run began, so that a plan not yet
 * planned again for the last set doesn't count it twice.
 */
export function cueTimeGesture() {
  let last: { edge: "start" | "end"; key: CueKey; made: CueEdit | null; origin: CueDragStart } | null = null;
  return (scene: CueScene, key: CueKey, edge: "start" | "end", time: number): Outcome | null => {
    const shown = scene.plan && cueOf(scene.plan, key);
    if (!shown || !scene.plan) return null;
    const current = cueEditOf(scene.edits.cue_edits, scene.plan, key);
    const going = last && last.edge === edge && sameCue(last.key, key) && last.made === current;
    const origin = going ? last!.origin : { edit: current, start: shown.start, end: shown.end };
    const outcome = retimeCue(scene, key, { start: time, end: time, edge }, origin);
    if (outcome) last = { edge, key, made: cueEditOf(outcome.edits.cue_edits, scene.plan, key), origin };
    return outcome;
  };
}
