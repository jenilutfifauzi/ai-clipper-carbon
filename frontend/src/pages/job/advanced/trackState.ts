import type { CandidateChange, RenderPlan } from "../../../api";

// The Tracks of the Advanced Edit's Timeline (GLOSSARY.md), and what is hidden, muted or locked of
// them. Kept in the editor only: never saved, never undone, and the Clip renders as if none were set.

export type TrackKind = "text" | "overlay" | "video" | "captions" | "hook" | "music";

/** Each Track's name, and whether it can be hidden (it shows) and muted (it sounds). Every Track locks. */
export const TRACKS: Record<TrackKind, { label: string; hide: boolean; mute: boolean }> = {
  text: { label: "Text", hide: true, mute: false },
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

/** The plan as the preview draws it: without the hidden Tracks' Text Layers, Overlays, captions and hook. */
export function shownPlan(plan: RenderPlan, { hidden }: TrackState): RenderPlan {
  if (!hidden.length) return plan;
  return {
    ...plan,
    texts: hidden.includes("text") ? [] : plan.texts,
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
  if (muted.includes("overlay") && next.overlays) next.overlays = next.overlays.map((overlay) => ({ ...overlay, volume: 0 }));
  if (muted.includes("video")) {
    next.source_volume = 0;
    if (next.segments) next.segments = next.segments.map((segment) => ({ ...segment, volume: 0 }));
  }
  return next;
}
