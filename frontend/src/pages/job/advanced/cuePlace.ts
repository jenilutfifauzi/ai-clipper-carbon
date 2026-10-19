import { CUE_MAX_SCALE, CUE_MIN_SCALE, type CueEdit, type CueKey } from "../../../api";
import { FRAME } from "../editor/picture";
import { placedOverrides, type Place } from "../editor/placing";
import type { Outcome } from "./actions";
import { afterReset, cueEditOf, cueOf, placed, withCueEdit, type CueScene } from "./cueEdits";
import type { Pick } from "./pick";

// A picked Cue moved and scaled on its own on the preview: its Cue Edit's `x`, `y` and `scale`
// (GLOSSARY.md), which the planner applies (_captions in backend/app/planner.py) over the Caption
// Style's position and size.

// A scale, to the hundredth, as far as it may go.
const scaled = (value: number) => Math.round(Math.min(Math.max(value, CUE_MIN_SCALE), CUE_MAX_SCALE) * 100) / 100;

/**
 * What is picked (the captions, or a Cue) put at `place` by its Grips on the preview: the captions'
 * Style Override (their custom position, and their size when a corner set it), or the Cue's Cue
 * Edit's `x` and `y` and, from a corner, its `scale` (`place.size` over the Caption Style's size).
 * Null while the Captions Track is locked, or for any other Pick.
 */
export function placedCaptions(scene: CueScene, pick: Pick, place: Place): Outcome | null {
  const { edits, plan } = scene;
  if (scene.locked?.includes("captions")) return null;
  if (pick?.kind === "captions") return { edits: { ...edits, style_overrides: placedOverrides(edits.style_overrides, "caption", place) }, pick };
  if (pick?.kind !== "cue" || !plan) return null;
  const size = place.size === null ? {} : { scale: place.size / plan.caption_style.size };
  return placeCue(scene, pick.key, { x: place.x, y: place.y, ...size });
}

/**
 * The Cue keyed `key` given its own place or size (`fields`, as the inspector sets them, each one
 * kept within its bounds): its Cue Edit changed, or one made at its key. Null while the Captions
 * Track is locked or the plan has no such Cue.
 */
export function placeCue(scene: CueScene, key: CueKey, fields: { x?: number; y?: number; scale?: number }): Outcome | null {
  const { edits, plan } = scene;
  if (scene.locked?.includes("captions") || !plan || !cueOf(plan, key)) return null;
  const current = cueEditOf(edits.cue_edits, plan, key);
  // A join that didn't take starts its Cue: placed, it is a start.
  const next: CueEdit = { ...(current ?? { at: key.at, media: key.media ?? null, shift: 0, start_delta: 0, end_delta: 0 }), join: false };
  if (fields.x !== undefined) next.x = Math.round(Math.min(Math.max(fields.x, 0), FRAME.width));
  if (fields.y !== undefined) next.y = Math.round(Math.min(Math.max(fields.y, 0), FRAME.height));
  if (fields.scale !== undefined) next.scale = scaled(fields.scale);
  return { edits: withCueEdit(edits, current, next), pick: { kind: "cue", key } };
}

/**
 * Reset position on the picked Cue keyed `key`: its Cue Edit's `x`, `y` and `scale` cleared, the Cue
 * Edit kept as cueEdits.ts' afterReset says. Null when it has none to reset, or while the Captions
 * Track is locked.
 */
export function resetCuePosition(scene: CueScene, key: CueKey): Outcome | null {
  const { edits, plan } = scene;
  if (scene.locked?.includes("captions") || !plan) return null;
  const current = cueEditOf(edits.cue_edits, plan, key);
  if (!current || !placed(current)) return null;
  const reset = { ...current, x: null, y: null, scale: null };
  return { edits: withCueEdit(edits, current, afterReset(plan, key, reset)), pick: { kind: "cue", key } };
}
