import type { KeyProperty, Keys, Overlay, Transform } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { clearKeys, keysAround, moveKeysAt, PICTURE_KEYS, shownTransform, toggleKey, writeKey, writtenTransform } from "../editor/keyframes";
import { tidyTransform } from "../editor/stagePicture";
import type { Outcome } from "./actions";
import type { AdvancedEdits } from "./edits";
import { onlyItem, TRACK_OF, type Pick } from "./pick";
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

/**
 * Item `ref`'s ruler diamond at `from` dragged to `to` (both Timeline time): every Keyframe at that
 * instant moved there together (see moveKeysAt), on the Clip's frames at `fps`, with the time they
 * went to. The edits themselves when they stay where they are; null when there are none there, or
 * the item is gone or locked.
 */
export function moveItemKeys(scene: KeyScene, ref: KeyedRef, from: number, to: number, fps: number): (Outcome & { at: number }) | null {
  const item = refused(scene, ref) ? null : keyedItem(scene.edits, ref);
  const moved = item && moveKeysAt(item.keys, from - item.start, to - item.start, { secs: item.secs, fps, start: item.start });
  if (!item || !moved) return null;
  const at = Math.round((item.start + moved.at) * 1e6) / 1e6;
  if (moved.keys === item.keys) return { edits: scene.edits, pick: scene.pick, at };
  // Its constants stay as they are: the first keyed property's is put back as it was.
  const [prop] = Object.keys(moved.keys) as KeyProperty[];
  return { edits: withKeyed(scene.edits, ref, moved.keys, prop, item.constant(prop)), pick: scene.pick, at };
}

// The shortcuts (K, [ and ]) work on the one item picked, as the ruler's diamonds do.

/** The item the Pick is when it is one item that can have Keyframes, else null. */
export function pickedKeyed(pick: Pick): KeyedRef | null {
  const item = onlyItem(pick);
  return item && (item.kind === "overlay" || item.kind === "music") ? { kind: item.kind, id: item.id } : null;
}

/** A property of an item last touched: its field changed, its ‹ ◆ › pressed, its row in the Keyframes pane clicked. */
export interface TouchedRow {
  item: KeyedRef;
  property: KeyProperty;
}

// The order an item's properties are looked through for its first keyed one.
const KEY_ORDER: readonly KeyProperty[] = [...PICTURE_KEYS, "volume"];

/**
 * The row K keys on item `ref` (as keyed, `item`): its property last `touched`, else its first keyed
 * one, else Scale (Volume for a Music Clip, which has nothing else).
 */
export function activeRow(ref: KeyedRef, item: KeyedItem, touched: TouchedRow | null): KeyProperty {
  if (touched && touched.item.kind === ref.kind && touched.item.id === ref.id) return touched.property;
  return KEY_ORDER.find((prop) => item.keys[prop]?.length) ?? (ref.kind === "music" ? "volume" : "scale");
}

/**
 * Where [ (`direction` -1) or ] (1) takes the playhead from `time`: to `item`'s Keyframe of any
 * property before or after it (beyond half a frame), in Timeline time; null when there is none.
 */
export function keyAround(item: KeyedItem, time: number, direction: -1 | 1): number | null {
  const all = Object.values(item.keys)
    .flat()
    .sort((a, b) => a.at - b.at);
  const { before, after } = keysAround(all, time - item.start);
  const at = direction < 0 ? before : after;
  return at === null ? null : Math.round((item.start + at) * 1e6) / 1e6;
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
