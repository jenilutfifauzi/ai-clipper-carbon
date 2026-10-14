import { mainTrackOf, type Candidate } from "../../../api";
import type { StageId } from "../editor/ClipPreview";

/**
 * What the Advanced Edit changes of a Candidate, saved and undone together. Its Main Track is always
 * its Segments here, one for a Clip that isn't cut (the backend keeps that one as `start` and `end`).
 * The hook's words and the captions' (Word Edits), and their places and sizes (Style Overrides), are
 * changed on the preview.
 */
export type AdvancedEdits = Pick<
  Candidate,
  | "hook_start"
  | "hook_secs"
  | "hook_text"
  | "hook_kicker"
  | "style_overrides"
  | "word_edits"
  | "text_layers"
  | "music"
  | "source_volume"
  | "segments"
  | "overlays"
  | "transitions"
>;

export function editsOf(candidate: Candidate): AdvancedEdits {
  const { hook_start, hook_secs, hook_text, hook_kicker, style_overrides, word_edits, text_layers, music, source_volume, overlays, transitions } =
    candidate;
  return {
    hook_start,
    hook_secs,
    hook_text,
    hook_kicker,
    style_overrides,
    word_edits,
    text_layers,
    music,
    source_volume,
    overlays,
    transitions,
    segments: mainTrackOf(candidate),
  };
}

/**
 * The item picked on the timeline or the preview, which the inspector shows: the hook, the captions,
 * a Segment, a Text Layer, a Music Clip, an Overlay, or the join after a Segment (for its Transition).
 */
export type Picked =
  | { kind: "hook" }
  | { kind: "captions" }
  | { kind: "segment"; id: string }
  | { kind: "text"; id: string }
  | { kind: "music"; id: string }
  | { kind: "overlay"; id: string }
  | { kind: "join"; after: string }
  | null;

export const samePicked = (a: Picked, b: Picked) => JSON.stringify(a) === JSON.stringify(b);

// The shortest a Text Layer, a Music Clip or an Overlay lasts (TimelineSecs in backend/app/candidates.py).
export const ITEM_MIN_SECS = 0.1;

// Times in the editor, to the hundredth of a second.
export const round = (seconds: number) => Math.round(seconds * 100) / 100;

export const newId = () => crypto.randomUUID().slice(0, 8);

/**
 * Items of a track in lanes: each in the first lane where it overlaps none, so that each row of the
 * track holds items that follow one another.
 */
export function trackLanes<T extends { start: number; secs: number }>(items: T[]): T[][] {
  const lanes: T[][] = [];
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    const lane = lanes.find((others) => others.every((other) => other.start + other.secs <= item.start + 1e-6 || item.start + item.secs <= other.start + 1e-6));
    if (lane) lane.push(item);
    else lanes.push([item]);
  }
  return lanes;
}

/** The id on the preview's stage (StageControls) of the picked item, if it is on the stage. */
export function stageIdOf(picked: Picked): StageId | null {
  if (picked?.kind === "hook" || picked?.kind === "captions") return picked.kind;
  return picked?.kind === "text" ? `text:${picked.id}` : null;
}

/** The item a stage id names. */
export function pickedOf(stageId: StageId): Picked {
  if (stageId === "hook" || stageId === "captions") return { kind: stageId };
  return { kind: "text", id: stageId.slice("text:".length) };
}
