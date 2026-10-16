import type { KeyProperty, Keys, Overlay, Transform } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { clearKeys, PICTURE_KEYS, shownTransform, toggleKey, writeKey, writtenTransform } from "../editor/keyframes";
import { tidyTransform } from "../editor/stagePicture";
import type { Outcome } from "./actions";
import type { AdvancedEdits } from "./edits";
import { TRACK_OF, type Pick } from "./pick";
import type { TrackKind } from "./trackState";

/**
 * Keyframe edits on the items of the edits (ADR 0008): the pure Keyframe actions of
 * ../editor/keyframes.ts done to an Overlay or a Music Clip at the playhead, each one change of the
 * edits, so one step of undo. A Keyframe is set at the playhead minus the item's start, and only
 * with the playhead inside the item; a locked Track refuses them.
 */

/** An item that can have Keyframes. (Media Segments and Manual Scenes come with their own kinds.) */
export interface KeyedRef {
  kind: "overlay" | "music";
  id: string;
}

/** What Keyframe edits are done in: the edits, the Pick (kept) and the locked Tracks. */
export interface KeyScene {
  edits: AdvancedEdits;
  pick: Pick;
  locked?: TrackKind[];
}

/** An item as keyed: its span in Timeline time, its Keyframes, and the constant each property has without them. */
export interface KeyedItem {
  start: number;
  secs: number;
  keys: Keys;
  constant: (prop: KeyProperty) => number;
}

/** The item `ref` names, as keyed; null when the edits don't have it. */
export function keyedItem(edits: AdvancedEdits, ref: KeyedRef): KeyedItem | null {
  if (ref.kind === "overlay") {
    const overlay = edits.overlays.find((other) => other.id === ref.id);
    return overlay ? { ...overlay, constant: (prop) => (prop === "volume" ? overlay.volume : overlay.transform[prop]) } : null;
  }
  const clip = edits.music.find((other) => other.id === ref.id);
  return clip ? { ...clip, constant: () => clip.volume } : null;
}

// `edits` with item `ref`'s Keyframes `keys`, and `prop`'s constant `constant`.
function withKeyed(edits: AdvancedEdits, ref: KeyedRef, keys: Keys, prop: KeyProperty, constant: number): AdvancedEdits {
  if (ref.kind === "music") {
    return { ...edits, music: edits.music.map((clip) => (clip.id === ref.id ? { ...clip, keys, volume: constant } : clip)) };
  }
  return {
    ...edits,
    overlays: edits.overlays.map((overlay) => {
      if (overlay.id !== ref.id) return overlay;
      if (prop === "volume") return { ...overlay, keys, volume: constant };
      return { ...overlay, keys, transform: { ...overlay.transform, [prop]: constant } };
    }),
  };
}

/** The playhead at `time` (Timeline time) in `item`'s own seconds, to the millisecond; null outside it. */
export function keyTime(item: { start: number; secs: number }, time: number): number | null {
  const at = Math.round((time - item.start) * 1000) / 1000;
  return at >= 0 && at <= item.secs ? at : null;
}

const refused = (scene: KeyScene, ref: KeyedRef) => (scene.locked ?? []).includes(TRACK_OF[ref.kind]);

// The item to edit and the playhead in it; null when it can't be (gone, or on a locked Track).
function editable(scene: KeyScene, ref: KeyedRef, time: number) {
  const item = refused(scene, ref) ? null : keyedItem(scene.edits, ref);
  return item && { item, at: keyTime(item, time) };
}

/** The diamond of `prop` of item `ref` clicked with the playhead at `time`: see toggleKey. Null outside the item. */
export function toggleItemKey(scene: KeyScene, ref: KeyedRef, prop: KeyProperty, time: number): Outcome | null {
  const found = editable(scene, ref, time);
  if (!found || found.at === null) return null;
  const { keys, constant } = toggleKey(found.item.keys, prop, found.at, found.item.constant(prop));
  return { edits: withKeyed(scene.edits, ref, keys, prop, constant), pick: scene.pick };
}

/**
 * `prop` of item `ref` set to `value` with the playhead at `time` (auto-key, see writeKey): a keyed
 * property is written only with the playhead inside the item, else null.
 */
export function writeItemKey(scene: KeyScene, ref: KeyedRef, prop: KeyProperty, value: number, time: number): Outcome | null {
  const found = editable(scene, ref, time);
  if (!found) return null;
  const keyed = !!found.item.keys[prop]?.length;
  if (keyed && found.at === null) return null;
  const { keys, constant } = writeKey(found.item.keys, prop, found.at ?? 0, value, found.item.constant(prop));
  return { edits: withKeyed(scene.edits, ref, keys, prop, constant), pick: scene.pick };
}

/**
 * Overlay `id`'s Transform changed to `next` with the playhead at `time`, from what was `shown` there
 * (see writtenTransform): on the stage, by its Grips. Null for one that isn't there or is locked.
 */
export function writeItemTransform(scene: KeyScene, id: string, next: Transform, time: number, shown?: Transform): Outcome | null {
  const ref = { kind: "overlay", id } as const;
  const found = editable(scene, ref, time);
  const overlay = scene.edits.overlays.find((other) => other.id === id);
  if (!found || !overlay) return null;
  const written = writtenTransform(overlay.transform, overlay.keys, next, found.at, shown);
  return { edits: { ...scene.edits, overlays: scene.edits.overlays.map((other) => (other.id === id ? { ...other, ...written } : other)) }, pick: scene.pick };
}

/** `overlay` Reset: its Transform at `defaults`, no Crop, and none of the Transform's Keyframes (its sound's kept). */
export const resetOverlay = (overlay: Overlay, defaults: Transform): Overlay => ({
  ...overlay,
  transform: defaults,
  crop: NO_CROP,
  keys: clearKeys(overlay.keys, PICTURE_KEYS),
});

/**
 * `overlay`'s Transform as the stage's Grips hold it at `time` (Timeline time): its keyed fields at
 * the playhead (held at its ends outside it), tidied as the stage tidies what it puts.
 */
export function stageTransform(overlay: Overlay, time: number): Transform {
  if (!PICTURE_KEYS.some((prop) => overlay.keys[prop]?.length)) return overlay.transform;
  const at = Math.min(Math.max(time - overlay.start, 0), overlay.secs);
  return tidyTransform(shownTransform(overlay.transform, overlay.keys, at));
}
