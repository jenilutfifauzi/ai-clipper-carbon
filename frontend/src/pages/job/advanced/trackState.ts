import type { CandidateChange, Keys, RenderPlan } from "../../../api";
import type { PlayedSegment } from "../editor/playback";

// The Tracks of the Advanced Edit's Timeline (GLOSSARY.md), and what is hidden, muted or locked of
// them. Kept in the editor only: never saved, never undone, and the Clip renders as if none were set.

export type TrackKind = "text" | "shape" | "adjust" | "overlay" | "video" | "captions" | "hook" | "music";

/** Each Track's name, and whether it can be hidden (it shows) and muted (it sounds). Every Track locks. */
export const TRACKS: Record<TrackKind, { label: string; hide: boolean; mute: boolean }> = {
  text: { label: "Text", hide: true, mute: false },
  shape: { label: "Shape", hide: true, mute: false },
  // Hidden, its Adjustment Layers are left out of the preview only (ADR 0013).
  adjust: { label: "Adjust", hide: true, mute: false },
  overlay: { label: "Overlay", hide: true, mute: true },
  video: { label: "Video", hide: true, mute: true },
  captions: { label: "Captions", hide: true, mute: false },
  hook: { label: "Hook", hide: true, mute: false },
  music: { label: "Music", hide: false, mute: true },
};

export type TrackControl = "hidden" | "muted" | "locked";

export type TrackState = Record<TrackControl, TrackKind[]>;

/** Nothing hidden, muted or locked: how the editor opens. */
export const UNTOUCHED: TrackState = { hidden: [], muted: [], locked: [] };

/** `state` with `kind`'s `control` turned on, or off when it was on. */
export function toggledTrack(state: TrackState, control: TrackControl, kind: TrackKind): TrackState {
  const now = state[control];
  return { ...state, [control]: now.includes(kind) ? now.filter((other) => other !== kind) : [...now, kind] };
}

/** The plan as the preview draws it: without the hidden Tracks' Text Layers, Shapes, Adjustment Layers, Overlays, captions and hook. */
export function shownPlan(plan: RenderPlan, { hidden }: TrackState): RenderPlan {
  if (!hidden.length) return plan;
  return {
    ...plan,
    texts: hidden.includes("text") ? [] : plan.texts,
    shapes: hidden.includes("shape") ? [] : plan.shapes,
    adjustments: hidden.includes("adjust") ? [] : plan.adjustments,
    overlays: hidden.includes("overlay") ? [] : plan.overlays,
    captions: hidden.includes("captions") ? [] : plan.captions,
    hook: hidden.includes("hook") ? null : plan.hook,
  };
}

/**
 * The draft as the preview plans it, to be heard: without the muted Tracks' sound (the songs, the
 * Overlays' videos' sound, the Clip's own sound). The backend plans what is heard, as it plans the
 * rest (docs/adr/0001-backend-plans-frontend-draws.md); nothing else of the plan changes.
 */
export function heardDraft<T extends CandidateChange>(draft: T, { muted }: TrackState): T {
  if (!muted.length) return draft;
  const next = { ...draft };
  if (muted.includes("music")) next.music = [];
  if (muted.includes("overlay") && next.overlays) next.overlays = next.overlays.map(silenced);
  if (muted.includes("video")) {
    // Each Segment silenced, not `source_volume`: that also scales a Detached sound of the Source,
    // which is on the Music Track. A draft without Segments is the Clip as filmed, all one sound.
    if (next.segments) next.segments = next.segments.map(silenced);
    else next.source_volume = 0;
  }
  return next;
}

/**
 * The Main Track as the preview plays it, to be heard as the heard draft is (heardDraft): each
 * Segment silent while the Video Track is muted. The plan's Segments are heard already, but a Main
 * Track made from the edits (a lone Segment, or a plan not yet caught up) isn't.
 */
export function heardTrack(segments: PlayedSegment[], { muted }: TrackState): PlayedSegment[] {
  if (!muted.includes("video")) return segments;
  return segments.map(({ gain: _, ...segment }) => ({ ...segment, volume: 0 }));
}

// An item at volume 0, its volume Keyframes (which would stand in for `volume`) dropped.
function silenced<I extends { volume?: number; keys?: Keys }>(item: I): I {
  if (!item.keys?.volume) return { ...item, volume: 0 };
  const { volume: _, ...keys } = item.keys;
  return { ...item, volume: 0, keys };
}
