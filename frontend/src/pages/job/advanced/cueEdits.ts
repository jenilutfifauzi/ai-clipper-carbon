import { CUE_SHIFT_MAX_SECS, type Cue, type CueEdit, type CueKey, type PreviewWord, type RenderPlan } from "../../../api";
import { cueWords } from "../editor/cues";
import { byKey, sameKey, sameTimeline, timelineOf } from "../editor/timelineKey";
import { cueWordsOf, withWordEdit } from "../editor/wordEdits";
import type { Outcome, Splitter } from "./actions";
import type { AdvancedEdits } from "./edits";
import type { TrackKind } from "./trackState";

// A picked Cue retimed on the Captions Track, split, merged with the next or emptied: its Cue Edit
// (GLOSSARY.md) and Word Edits written as the planner applies them (_captions in
// backend/app/planner.py, which is the rule), so that what is dropped is what is planned. Which
// Cue Edits a Cue has, its Words' keys and where it may be retimed to are read from the plan's Cue,
// never worked out here (docs/adr/0001-backend-plans-frontend-draws.md).

/** What the Cue actions are done in: the edits, the plan of them (and its Words), and the locked Tracks. */
export interface CueScene {
  edits: AdvancedEdits;
  plan: RenderPlan | null;
  // The Preview Plan's Words, which Merge, Delete and the chips find a Cue's Words among.
  words?: PreviewWord[];
  locked?: TrackKind[];
}

/**
 * A Cue as the Captions Track shows it: from `start` to `end` (seconds into the Clip; its entries
 * either side of a Layout change taken as one), at its Segment's `speed`, where the planner keeps it
 * retimed, from `low` to `high`, and `minSecs` long at least where it has room (all the plan's).
 */
export interface ShownCue {
  start: number;
  end: number;
  speed: number;
  low: number;
  high: number;
  minSecs: number;
  edited: boolean;
}

/** The Cue of `plan` keyed `key`, as the Captions Track shows it; null when there is none. */
export function cueOf(plan: RenderPlan, key: CueKey): ShownCue | null {
  const entries = plan.captions.filter((cue) => sameKey(cue.key, key));
  if (!entries.length) return null;
  const [first] = entries;
  const { speed, low, high, edited } = first;
  return { start: first.start, end: entries[entries.length - 1].end, speed, low, high, minSecs: plan.cue_min_secs, edited };
}

/** Each Cue of `plan` once (its first entry, of those either side of a Layout change), as the Captions Track shows it. */
export function shownCues(plan: RenderPlan): { cue: Cue; shown: ShownCue }[] {
  return plan.captions.flatMap((cue, i) => {
    if (i > 0 && sameKey(plan.captions[i - 1].key, cue.key)) return [];
    const shown = cueOf(plan, cue.key);
    return shown ? [{ cue, shown }] : [];
  });
}

// The Cue Edit of `edits` at `at` on `media`'s timeline (of two, the later, as the planner takes it).
function editAt(edits: CueEdit[], media: string | null, at: number | null | undefined): CueEdit | null {
  if (at == null) return null;
  return edits.findLast((edit) => sameKey(edit, { at, media })) ?? null;
}

/**
 * The Cue Edit of `edits` on the Cue keyed `key`, if it has one: the one the plan matched to its
 * first Word (`cue_edit_ats`), which may be written at any time in it; or, while the plan names
 * none, one written at its key, as a drag writes it before it is planned again.
 */
export function cueEditOf(edits: CueEdit[], plan: RenderPlan, key: CueKey): CueEdit | null {
  const media = timelineOf(key);
  const cue = plan.captions.find((other) => sameKey(other.key, key));
  return editAt(edits, media, cue?.cue_edit_ats[0]) ?? editAt(edits, media, key.at);
}

// Seconds of a Cue Edit, to the millisecond, as far as it may go.
const secs = (value: number) => Math.round(Math.min(Math.max(value, -CUE_SHIFT_MAX_SECS), CUE_SHIFT_MAX_SECS) * 1000) / 1000;

// Whether a Cue Edit retimes its Cue, or places or sizes it (cuePlace.ts).
const timed = (edit: CueEdit) => edit.shift !== 0 || edit.start_delta !== 0 || edit.end_delta !== 0;
export const placed = (edit: CueEdit) => edit.x != null || edit.y != null || edit.scale != null;
// A Cue Edit that changes nothing of its Cue but where it starts one.
export const empty = (edit: CueEdit) => !timed(edit) && !placed(edit);

/**
 * A Cue Edit at `at` on `media`'s timeline (the Source's when null) that only starts a Cue there, or
 * with `join` keeps it with the one before.
 */
export const bare = (at: number, media: string | null, join = false): CueEdit => ({ at, media, shift: 0, start_delta: 0, end_delta: 0, join });

/** Whether the Cue actions are refused: while the Captions Track is locked. */
export const captionsLocked = (scene: CueScene) => !!scene.locked?.includes("captions");

/** The plan the Cue actions edit the Cues of: none while the Captions Track is locked (captionsLocked). */
export const editablePlan = (scene: CueScene): RenderPlan | null => (captionsLocked(scene) ? null : scene.plan);

/** `edits` with the Cue Edit `before` (or, when it is null, none) changed to `after` (or dropped, when it is null). */
export function withCueEdit(edits: AdvancedEdits, before: CueEdit | null, after: CueEdit | null): AdvancedEdits {
  const kept = edits.cue_edits.filter((edit) => edit !== before);
  return { ...edits, cue_edits: after ? [...kept, after].sort(byKey) : kept };
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
 * planner keeps it (between `low` and `high`, `minSecs` long at least), times its Segment's Speed.
 * Null while the Captions Track is locked or the plan has no such Cue.
 */
export function retimeCue(
  scene: CueScene,
  key: CueKey,
  range: { start: number; end: number; edge: "move" | "start" | "end" },
  from: CueDragStart | null,
): Outcome | null {
  const { edits } = scene;
  const plan = editablePlan(scene);
  if (!plan) return null;
  const shown = cueOf(plan, key);
  if (!shown) return null;
  const current = cueEditOf(edits.cue_edits, plan, key);
  const origin = from ?? { edit: current, start: shown.start, end: shown.end };
  // A join that didn't take (its Cue doesn't fit the one before) starts its Cue: retimed, it is a start.
  const begun = origin.edit ? { ...origin.edit, join: false } : bare(key.at, timelineOf(key));
  const { low, high, speed, minSecs } = shown;
  let next: CueEdit;
  if (range.edge === "move") {
    const length = origin.end - origin.start;
    const start = Math.max(low, Math.min(range.start, high - length));
    next = { ...begun, shift: secs(begun.shift + (start - origin.start) * speed) };
  } else if (range.edge === "start") {
    const start = Math.max(low, Math.min(range.start, origin.end - minSecs));
    next = { ...begun, start_delta: secs(begun.start_delta + (start - origin.start) * speed) };
  } else {
    const end = Math.min(high, Math.max(range.end, origin.start + minSecs));
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
  const cue = plan.captions.find((other) => sameKey(other.key, key));
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
  const { edits } = scene;
  const plan = editablePlan(scene);
  if (!plan) return null;
  const current = cueEditOf(edits.cue_edits, plan, key);
  if (!current || !timed(current)) return null;
  const reset = { ...current, shift: 0, start_delta: 0, end_delta: 0 };
  return { edits: withCueEdit(edits, current, afterReset(plan, key, reset)), pick: { kind: "cue", key } };
}

/**
 * The Preview Plan's Words the Cue keyed `key` shows, in order, on its timeline (none when they
 * can't be found). Null when the plan has no such Cue.
 */
function cueParts(scene: CueScene, key: CueKey): { words: PreviewWord[] } | null {
  const entry = scene.plan?.captions.find((cue) => sameKey(cue.key, key));
  if (!entry) return null;
  const own = (scene.words ?? []).filter((word) => sameTimeline(word, key));
  return { words: cueWordsOf(entry, own) };
}

/**
 * Where Split at the playhead (`time`) starts a Cue, in the Cue keyed `key` while it is shown: at
 * the first of its Words after its first highlighted from after `time`, by its key (`word_ats`), and
 * the `at` of the Cue Edit the plan matched to that Word (`cue_edit_ats`: inside a Cue, a join).
 * Null when there is none.
 */
export function splitPoint(scene: CueScene, key: CueKey, time: number): { at: number; edit: number | null } | null {
  const entries = scene.plan?.captions.filter((cue) => sameKey(cue.key, key)) ?? [];
  const entry = entries.find((cue) => cue.start <= time && time < cue.end);
  if (!entry) return null;
  // Highlights are kept within their entry: in the one shown at `time`, one starts after it exactly when its Word does.
  const index = cueWords(entry).findIndex((word, i) => i > 0 && word.start > time);
  const at = index > 0 ? entry.word_ats[index] : undefined;
  return at === undefined ? null : { at, edit: entry.cue_edit_ats[index] ?? null };
}

/**
 * Split (Cmd/Ctrl+B) on the picked Cue keyed `key` at the playhead (`time`): a Cue Edit at the first
 * of its Words after it (splitPoint), which then starts a Cue; this one stays picked (the new one isn't in
 * the plan until it is planned again, and would drop out of the Pick). A join on that Word gives way
 * to it. Null when there is no such Word, or while the Captions Track is locked.
 */
export function splitCue(scene: CueScene, key: CueKey, time: number): Outcome | null {
  const { edits } = scene;
  const plan = editablePlan(scene);
  if (!plan) return null;
  const point = splitPoint(scene, key, time);
  if (!point) return null;
  const media = timelineOf(key);
  return { edits: withCueEdit(edits, editAt(edits.cue_edits, media, point.edit), bare(point.at, media)), pick: { kind: "cue", key } };
}

/** Split at the playhead (`now`) on the picked Cue keyed `key`, from the Timeline's bar, the phone's toolbar and Cmd/Ctrl+B. */
export function cueSplitter(scene: CueScene, key: CueKey, now: () => number, apply: (outcome: Outcome) => void): Splitter {
  return {
    canSplit: (time) => !captionsLocked(scene) && !!splitPoint(scene, key, time),
    split: () => {
      const outcome = splitCue(scene, key, now());
      if (outcome) apply(outcome);
    },
  };
}

/** The Cue shown after the one keyed `key`, if there is one. */
export function nextCue(plan: RenderPlan, key: CueKey): Cue | null {
  const last = plan.captions.findLastIndex((cue) => sameKey(cue.key, key));
  return last < 0 ? null : (plan.captions[last + 1] ?? null);
}

/**
 * Merge with next on the picked Cue keyed `key`: the next Cue's own Cue Edit goes, as does the
 * break before its first Word, and where a pause, a sentence's end or the longest-Cue limit would
 * still part them (`needs_join`) a `join` Cue Edit keeps it with this one. Null when the next Cue
 * doesn't fit (isn't `joinable`), or while the Captions Track is locked.
 */
export function mergeCue(scene: CueScene, key: CueKey): Outcome | null {
  const { edits } = scene;
  const plan = editablePlan(scene);
  if (!plan) return null;
  const next = nextCue(plan, key);
  if (!next?.joinable) return null;
  const join = next.needs_join ? bare(next.key.at, timelineOf(next.key), true) : null;
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
  const { edits } = scene;
  const plan = editablePlan(scene);
  if (!plan) return null;
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
  if (captionsLocked(scene)) return null;
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
    const going = last && last.edge === edge && sameKey(last.key, key) && last.made === current;
    const origin = going ? last!.origin : { edit: current, start: shown.start, end: shown.end };
    const outcome = retimeCue(scene, key, { start: time, end: time, edge }, origin);
    if (outcome) last = { edge, key, made: cueEditOf(outcome.edits.cue_edits, scene.plan, key), origin };
    return outcome;
  };
}
