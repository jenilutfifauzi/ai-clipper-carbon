import { mainTrackOf, type Candidate } from "../../../api";
import { overlayTime, sourceAt, type OverlayPlay } from "../editor/segmentTime";
import { same } from "../editor/merge";

/**
 * What the Advanced Edit changes of a Candidate, saved and undone together. Its Main Track is always
 * its Segments here, one for a Clip that isn't cut (the backend keeps that one as `start` and `end`).
 * The hook's words and the captions' (Word Edits), and their places and sizes (Style Overrides), are
 * changed on the preview; the Layouts (the clip's, and its Scenes' Layout Overrides) in the inspector.
 */
export type AdvancedEdits = Pick<
  Candidate,
  | "hook_start"
  | "hook_secs"
  | "hook_text"
  | "hook_kicker"
  | "style_overrides"
  | "word_edits"
  | "layout"
  | "framing"
  | "layout_overrides"
  | "text_layers"
  | "shapes"
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
    layout,
    framing,
    layout_overrides,
    text_layers,
    shapes,
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
    layout,
    framing,
    layout_overrides,
    text_layers,
    shapes,
    music,
    source_volume,
    overlays,
    transitions,
    segments: mainTrackOf(candidate),
  };
}

/**
 * The items of `next` that aren't in `old` as they are: Segments, Text Layers, Shapes, Music Clips
 * and Overlays by id, and "hook" when its timing or words changed. What the Timeline shows as changed.
 */
export function changedItems(old: AdvancedEdits, next: AdvancedEdits): Set<string> {
  const changed = new Set<string>();
  for (const field of ["segments", "text_layers", "shapes", "music", "overlays"] as const) {
    const before = new Map<string, unknown>(old[field].map((item) => [item.id, item]));
    for (const item of next[field]) if (!same(before.get(item.id), item)) changed.add(item.id);
  }
  const hook = (edits: AdvancedEdits) => [edits.hook_text, edits.hook_kicker, edits.hook_start, edits.hook_secs];
  if (!same(hook(old), hook(next))) changed.add("hook");
  return changed;
}

// The shortest a Text Layer, a Shape, a Music Clip or an Overlay lasts (TimelineSecs in backend/app/candidates.py).
export const ITEM_MIN_SECS = 0.1;

// How far a Music Clip ducks under speech, in dB (GLOSSARY.md, Ducking; MusicClip.duck in
// backend/app/candidates.py): the editor's new ones at DEFAULT_DUCK, set from DUCK_MIN to DUCK_MAX.
export const DEFAULT_DUCK = -12;
export const DUCK_MIN = -30;
export const DUCK_MAX = -1;

// Times in the editor, to the hundredth of a second.
export const round = (seconds: number) => Math.round(seconds * 100) / 100;

export const newId = () => crypto.randomUUID().slice(0, 8);

// A new Text Layer or Shape stays this long, or to the Clip's end.
export const NEW_LAYER_SECS = 3;

/**
 * When a new Text Layer or Shape added at `at` (the playhead, or where it was dropped) shows in a
 * Clip `duration` long: for NEW_LAYER_SECS, from early enough to end with the Clip near its end, or the
 * whole of a shorter Clip.
 */
export function newTiming(at: number, duration: number): { start: number; secs: number } {
  const start = Math.max(0, Math.min(at, duration - Math.min(NEW_LAYER_SECS, duration)));
  return { start: round(start), secs: round(Math.min(NEW_LAYER_SECS, duration - start)) };
}

/**
 * Where in its file a song or video Overlay that keeps `from` to `to` seconds of its span (from its
 * start on the Timeline; either may reach outside it) starts, its `offset`: the start of the part of
 * its file it shows between them (`overlayTime`). So its offset goes as much further as its start
 * moves, times its Speed; in Reverse, which shows its part of its video from the end, as much
 * further as its end moves in (ADR 0009). Never before its file's start; as it was when it doesn't
 * move.
 */
export function keptOffset(item: OverlayPlay, from: number, to: number): number {
  const time = overlayTime(item);
  const kept = Math.min(sourceAt(time, from), sourceAt(time, to));
  return Math.abs(kept - item.offset) < 1e-9 ? item.offset : round(Math.max(0, kept));
}

// A Music Clip's or Segment's longest fade (Fade in backend/app/candidates.py).
export const FADE_MAX_SECS = 10;

/**
 * A Music Clip's or Segment's fades within `secs` of it, as the planner hears them (fades_within in
 * backend/app/planner.py, which is the rule; both are tested on the cases in
 * backend/tests/fixtures/gain_vectors.json): each 10 s at most, and when together they are longer
 * than it, both shortened by the same share to fit. To a hundredth, as edits are kept; the planner
 * rounds to the millisecond.
 */
export function fadesWithin({ fade_in, fade_out }: { fade_in: number; fade_out: number }, secs: number): { fade_in: number; fade_out: number } {
  const fadeIn = Math.min(Math.max(fade_in, 0), FADE_MAX_SECS);
  const fadeOut = Math.min(Math.max(fade_out, 0), FADE_MAX_SECS);
  const share = Math.min(1, Math.max(secs, 0) / (fadeIn + fadeOut || 1));
  if (share === 1) return { fade_in: fadeIn, fade_out: fadeOut };
  const shortIn = round(fadeIn * share);
  return { fade_in: shortIn, fade_out: Math.min(round(fadeOut * share), round(secs - shortIn)) };
}

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
