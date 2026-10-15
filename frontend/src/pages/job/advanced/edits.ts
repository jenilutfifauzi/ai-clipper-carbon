import { mainTrackOf, type Candidate } from "../../../api";
import { same } from "../editor/merge";

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
  | "layout_overrides"
  | "text_layers"
  | "music"
  | "source_volume"
  | "segments"
  | "overlays"
  | "transitions"
>;

export function editsOf(candidate: Candidate): AdvancedEdits {
  const {
    hook_start,
    hook_secs,
    hook_text,
    hook_kicker,
    style_overrides,
    word_edits,
    layout_overrides,
    text_layers,
    music,
    source_volume,
    overlays,
    transitions,
  } = candidate;
  return {
    hook_start,
    hook_secs,
    hook_text,
    hook_kicker,
    style_overrides,
    word_edits,
    layout_overrides,
    text_layers,
    music,
    source_volume,
    overlays,
    transitions,
    segments: mainTrackOf(candidate),
  };
}

/**
 * The items of `next` that aren't in `old` as they are: Segments, Text Layers, Music Clips and
 * Overlays by id, and "hook" when its timing or words changed. What the Timeline shows as changed.
 */
export function changedItems(old: AdvancedEdits, next: AdvancedEdits): Set<string> {
  const changed = new Set<string>();
  for (const field of ["segments", "text_layers", "music", "overlays"] as const) {
    const before = new Map<string, unknown>(old[field].map((item) => [item.id, item]));
    for (const item of next[field]) if (!same(before.get(item.id), item)) changed.add(item.id);
  }
  const hook = (edits: AdvancedEdits) => [edits.hook_text, edits.hook_kicker, edits.hook_start, edits.hook_secs];
  if (!same(hook(old), hook(next))) changed.add("hook");
  return changed;
}

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
