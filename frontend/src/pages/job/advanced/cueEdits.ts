import { CUE_SHIFT_MAX_SECS, type Cue, type CueEdit, type CueKey, type RenderPlan } from "../../../api";
import type { Outcome } from "./actions";
import type { AdvancedEdits } from "./edits";
import { sameCue } from "./pick";
import type { TrackKind } from "./trackState";

// A picked Cue retimed on the Captions Track: its Cue Edit (GLOSSARY.md) written as the planner
// applies it (_captions in backend/app/planner.py, which is the rule), so that what is dropped is
// what is planned.

// The shortest a retimed Cue is shown (CAPTION_MIN_SECS in backend/app/planner.py).
export const CUE_MIN_SECS = 0.2;
// How far from a Cue's key a Cue Edit names it, when written at another time in its first Word
// (WORD_EDIT_REACH_SECS in backend/app/planner.py).
const REACH_SECS = 0.25;

/** What the Cue actions are done in: the edits, the plan of them, and the locked Tracks. */
export interface CueScene {
  edits: AdvancedEdits;
  plan: RenderPlan | null;
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
// A Cue Edit that changes nothing of its Cue: what is left once its fields are reset.
export const empty = (edit: CueEdit) => !timed(edit) && !placed(edit);

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
  const begun = origin.edit ?? { at: key.at, media: key.media ?? null, shift: 0, start_delta: 0, end_delta: 0 };
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
 * Reset timing on the picked Cue keyed `key`: its Cue Edit's `shift`, `start_delta` and
 * `end_delta` cleared, the Cue Edit dropped when nothing is left of it. Null when it has none to
 * reset, or while the Captions Track is locked.
 */
export function resetCueTiming(scene: CueScene, key: CueKey): Outcome | null {
  const { edits, plan } = scene;
  if (scene.locked?.includes("captions") || !plan) return null;
  const current = cueEditOf(edits.cue_edits, plan, key);
  if (!current || !timed(current)) return null;
  const reset ={ ...current, shift: 0, start_delta: 0, end_delta: 0 };
  return { edits: withCueEdit(edits, current, empty(reset) ? null : reset), pick: { kind: "cue", key } };
}
