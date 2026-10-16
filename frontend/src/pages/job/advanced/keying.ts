import type { ClipSegment, Framing, Keyframe, KeyProperty, Keys, LayoutOverride, MediaItem, Overlay, RenderPlan, Transform } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { clearKeys, keysAround, moveKeysAt, PICTURE_KEYS, shownTransform, toggleKey, valueAt, writeKey, writtenTransform } from "../editor/keyframes";
import { playedFrom, type PlayedSegment } from "../editor/playback";
import { sourceSceneAt, type LayoutEdits } from "../editor/manual";
import { sceneOverride } from "../editor/ScenesTrack";
import { tidyTransform } from "../editor/stagePicture";
import type { Outcome } from "./actions";
import type { AdvancedEdits } from "./edits";
import { onlyItem, TRACK_OF, type Pick } from "./pick";
import type { TrackKind } from "./trackState";

/**
 * Keyframe edits on the items of the edits (ADR 0008): the pure Keyframe actions of
 * ../editor/keyframes.ts done to an Overlay, a Music Clip, a video's Segment or a Manual Scene at
 * the playhead, each one change of the edits, so one step of undo. A Keyframe is set at the playhead
 * minus the item's start on the Timeline (a Manual Scene's: the playhead's Source time minus its
 * Scene's start, which the plan gives as `keys_from`), and only with the playhead inside the item;
 * a locked Track refuses them.
 */

/**
 * An item that can have Keyframes: an Overlay, a Music Clip, a video's Segment, or a Manual Scene of
 * a Layout Override's (`id` its place among the plan's Scenes, `sceneRef`: that Segment's showing of it).
 */
export interface KeyedRef {
  kind: "overlay" | "music" | "segment" | "scene";
  id: string;
}

/** The Manual Scene that is the plan's Scene `index`, as a KeyedRef. */
export const sceneRef = (index: number): KeyedRef => ({ kind: "scene", id: String(index) });

/**
 * What Keyframe edits are done in: the edits, the Pick (kept) and the locked Tracks, and the Main
 * Track as planned (`track`: where each Segment starts on the Timeline, Transitions and Word
 * snapping included), without which the Segments are taken as played back to back; and the plan,
 * which places Manual Scenes (none without it).
 */
export interface KeyScene {
  edits: AdvancedEdits;
  pick: Pick;
  locked?: TrackKind[];
  track?: PlayedSegment[];
  plan?: RenderPlan | null;
}

/**
 * An item as keyed: its span in Timeline time (where its Keyframes count from, for `secs`), its
 * Keyframes, and the constant each property has without them. A Manual Scene shown from part way
 * into its shot is on the Timeline from `first` seconds in (0 for every other item).
 */
export interface KeyedItem {
  start: number;
  secs: number;
  first?: number;
  keys: Keys;
  constant: (prop: KeyProperty) => number;
}

/**
 * Where Segment `id` plays on the Timeline: from where it starts on the Main Track as planned
 * (`track`), for as long as its range; null when there is no such Segment.
 */
export function segmentSpan(segments: ClipSegment[], id: string, track?: PlayedSegment[]): { start: number; secs: number } | null {
  const index = segments.findIndex((segment) => segment.id === id);
  if (index === -1) return null;
  const planned = track?.length === segments.length ? track : playedFrom(segments);
  const { start, end } = segments[index];
  return { start: planned[index].start, secs: Math.round((end - start) * 1e6) / 1e6 };
}

/**
 * Manual Scene `index` of `plan` framed by its own Layout Override (of `overrides`), as keyed: from
 * the plan's `keys_from` (where its Scene starts, on the Timeline of this showing of it) to its end,
 * on the Timeline from its own start; with its override. Null for any other Scene, one the Candidate's
 * own Manual Framing frames (which has no Keyframes), or while the plan isn't of the override yet.
 */
export function manualScene(
  overrides: LayoutOverride[],
  plan: RenderPlan,
  index: number,
): (KeyedItem & { first: number; override: LayoutOverride; framing: Framing }) | null {
  const scene = plan.scenes[index];
  const own = scene && sceneOverride(overrides, plan, index);
  const from = scene?.keys_from;
  if (!own || own.layout !== "manual" || !own.framing || from == null) return null;
  const { framing } = own;
  const micro = (seconds: number) => Math.round(seconds * 1e6) / 1e6;
  return {
    start: from,
    first: micro(scene.start - from),
    secs: micro(scene.end - from),
    keys: own.keys ?? {},
    constant: (prop) => (prop === "volume" ? 1 : framing.transform[prop]),
    override: own,
    framing,
  };
}

// `edits` with `own` of its Layout Overrides replaced by `next`.
const withOverride = <T extends LayoutEdits>(edits: T, own: LayoutOverride, next: LayoutOverride): T => ({
  ...edits,
  layout_overrides: edits.layout_overrides.map((override) => (override === own ? next : override)),
});

/**
 * The item `ref` names, as keyed (a Segment from where `track` starts it, a Manual Scene as `plan`
 * places it); null when the edits don't have it, or for a Segment of the Source, which has no Keyframes.
 */
export function keyedItem(edits: AdvancedEdits, ref: KeyedRef, track?: PlayedSegment[], plan?: RenderPlan | null): KeyedItem | null {
  if (ref.kind === "scene") return plan ? manualScene(edits.layout_overrides, plan, Number(ref.id)) : null;
  if (ref.kind === "segment") {
    const segment = edits.segments.find((other) => other.id === ref.id);
    const span = segmentSpan(edits.segments, ref.id, track);
    const framing = segment?.framing;
    if (!segment?.media || !framing || !span) return null;
    return { ...span, keys: segment.keys ?? {}, constant: (prop) => (prop === "volume" ? (segment.volume ?? 1) : framing.transform[prop]) };
  }
  if (ref.kind === "overlay") {
    const overlay = edits.overlays.find((other) => other.id === ref.id);
    return overlay ? { ...overlay, constant: (prop) => (prop === "volume" ? overlay.volume : overlay.transform[prop]) } : null;
  }
  const clip = edits.music.find((other) => other.id === ref.id);
  return clip ? { ...clip, constant: () => clip.volume } : null;
}

// `edits` with item `ref`'s Keyframes `keys`, and `prop`'s constant `constant` (a turn kept within
// ±360°, as the Transform's is, where a Keyframe may hold more); a Manual Scene's as `plan` places it.
function withKeyed(edits: AdvancedEdits, ref: KeyedRef, keys: Keys, prop: KeyProperty, constant: number, plan?: RenderPlan | null): AdvancedEdits {
  if (prop === "rotation") constant %= 360;
  if (ref.kind === "scene") {
    const found = plan && manualScene(edits.layout_overrides, plan, Number(ref.id));
    if (!found || prop === "volume") return edits;
    const { override, framing } = found;
    return withOverride(edits, override, { ...override, keys, framing: { ...framing, transform: { ...framing.transform, [prop]: constant } } });
  }
  if (ref.kind === "segment") {
    return {
      ...edits,
      segments: edits.segments.map((segment) => {
        if (segment.id !== ref.id || !segment.framing) return segment;
        if (prop === "volume") return { ...segment, keys, volume: constant };
        const { framing } = segment;
        return { ...segment, keys, framing: { ...framing, transform: { ...framing.transform, [prop]: constant } } };
      }),
    };
  }
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
export function keyTime(item: { start: number; secs: number; first?: number }, time: number): number | null {
  const at = Math.round((time - item.start) * 1000) / 1000;
  return at >= Math.round((item.first ?? 0) * 1000) / 1000 && at <= item.secs ? at : null;
}

// A Manual Scene is the Video Track's, as the Segment showing it is.
const refused = (scene: KeyScene, ref: KeyedRef) => (scene.locked ?? []).includes(ref.kind === "scene" ? "video" : TRACK_OF[ref.kind]);

// Item `ref` as keyed in `scene`; null when it can't be edited (gone, or on a locked Track).
const itemIn = (scene: KeyScene, ref: KeyedRef) => (refused(scene, ref) ? null : keyedItem(scene.edits, ref, scene.track, scene.plan));

// The item to edit and the playhead in it; null when it can't be (gone, or on a locked Track).
function editable(scene: KeyScene, ref: KeyedRef, time: number) {
  const item = itemIn(scene, ref);
  return item && { item, at: keyTime(item, time) };
}

/** The diamond of `prop` of item `ref` clicked with the playhead at `time`: see toggleKey. Null outside the item. */
export function toggleItemKey(scene: KeyScene, ref: KeyedRef, prop: KeyProperty, time: number): Outcome | null {
  const found = editable(scene, ref, time);
  if (!found || found.at === null) return null;
  const { keys, constant } = toggleKey(found.item.keys, prop, found.at, found.item.constant(prop));
  return { edits: withKeyed(scene.edits, ref, keys, prop, constant, scene.plan), pick: scene.pick };
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
  const { keys, constant } = writeKey(found.item.keys, prop, found.at ?? found.item.first ?? 0, value, found.item.constant(prop));
  return { edits: withKeyed(scene.edits, ref, keys, prop, constant, scene.plan), pick: scene.pick };
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
  const item = itemIn(scene, ref);
  const moved = item && moveKeysAt(item.keys, from - item.start, to - item.start, { secs: item.secs, fps, start: item.start });
  if (!item || !moved) return null;
  const at = Math.round((item.start + moved.at) * 1e6) / 1e6;
  if (moved.keys === item.keys) return { edits: scene.edits, pick: scene.pick, at };
  // Its constants stay as they are: the first keyed property's is put back as it was.
  const [prop] = Object.keys(moved.keys) as KeyProperty[];
  return { edits: withKeyed(scene.edits, ref, moved.keys, prop, item.constant(prop), scene.plan), pick: scene.pick, at };
}

// The shortcuts (K, [ and ]) work on the one item picked, as the ruler's diamonds do.

/**
 * The item the Pick is when it is one of a kind that can have Keyframes, else null. (A Segment of
 * the Source can't: keyedItem has none for it.) A Segment of the Source picked with its Manual
 * Scene `scene` under the playhead (`manualSceneAt`) is that Manual Scene.
 */
export function pickedKeyed(pick: Pick, scene: number | null = null): KeyedRef | null {
  const item = onlyItem(pick);
  if (item?.kind === "segment" && scene !== null) return sceneRef(scene);
  return item && item.kind !== "text" ? { kind: item.kind, id: item.id } : null;
}

/**
 * The plan's Scene under `time` (Timeline time) in Segment `id` of the edits' Main Track when it is
 * a Manual Scene framed by its own Layout Override, which can have Keyframes; else null.
 */
export function manualSceneAt(edits: LayoutEdits & { segments: ClipSegment[] }, plan: RenderPlan, id: string, time: number): number | null {
  const index = edits.segments.findIndex((segment) => segment.id === id);
  const scene = index === -1 ? null : sourceSceneAt(plan, index, edits.segments.length, time);
  return scene !== null && manualScene(edits.layout_overrides, plan, scene) ? scene : null;
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

/**
 * Video Segment `id`'s Framing's Transform changed to `next` with the playhead at `time`, from what
 * was `shown` there (see writtenTransform): on the stage, by its Grips. Null for one that isn't
 * there or is locked.
 */
export function writeSegmentTransform(scene: KeyScene, id: string, next: Transform, time: number, shown?: Transform): Outcome | null {
  const found = editable(scene, { kind: "segment", id }, time);
  if (!found) return null;
  const segments = scene.edits.segments.map((segment) => {
    if (segment.id !== id || !segment.framing) return segment;
    const written = writtenTransform(segment.framing.transform, segment.keys ?? {}, next, found.at, shown);
    return { ...segment, keys: written.keys, framing: { ...segment.framing, transform: written.transform } };
  });
  return { edits: { ...scene.edits, segments }, pick: scene.pick };
}

/**
 * Manual Scene `index`'s Framing's Transform (of `plan`, its own override's) changed to `next` with
 * the playhead at `time`, from what was `shown` there (see writtenTransform): by its inspector's
 * fields, whatever the editor's edits. Null for a Scene without its own Manual override.
 */
export function withSceneTransform<T extends LayoutEdits>(edits: T, plan: RenderPlan, index: number, next: Transform, time: number, shown?: Transform): T | null {
  const found = manualScene(edits.layout_overrides, plan, index);
  if (!found) return null;
  const { override, framing } = found;
  const written = writtenTransform(framing.transform, found.keys, next, keyTime(found, time), shown);
  return withOverride(edits, override, { ...override, keys: written.keys, framing: { ...framing, transform: written.transform } });
}

/**
 * Manual Scene `index`'s Framing's Transform changed to `next` with the playhead at `time`, from what
 * was `shown` there (see withSceneTransform): on the stage, by its Grips. Null for one without its
 * own override, or on a locked Video Track.
 */
export function writeSceneTransform(scene: KeyScene, index: number, next: Transform, time: number, shown?: Transform): Outcome | null {
  if (refused(scene, sceneRef(index)) || !scene.plan) return null;
  const edits = withSceneTransform(scene.edits, scene.plan, index, next, time, shown);
  return edits && { edits, pick: scene.pick };
}

/** Video `segment`'s Framing Reset: its Transform at `defaults`, no Crop, and none of the Transform's Keyframes (its sound's kept). */
export function resetFraming(segment: ClipSegment, defaults: Transform): ClipSegment {
  if (!segment.framing) return segment;
  return { ...segment, framing: { ...segment.framing, transform: defaults, crop: NO_CROP }, keys: clearKeys(segment.keys ?? {}, PICTURE_KEYS) };
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
  return heldTransform(overlay.transform, overlay.keys, overlay, time);
}

/**
 * A Transform keyed by `keys`, of an item playing over `span` of the Timeline (from `first` seconds
 * into it, for a Manual Scene), as the stage's Grips hold it at `time` (see stageTransform).
 */
export function heldTransform(transform: Transform, keys: Keys, span: { start: number; secs: number; first?: number }, time: number): Transform {
  if (!PICTURE_KEYS.some((prop) => keys[prop]?.length)) return transform;
  const at = Math.min(Math.max(time - span.start, span.first ?? 0), span.secs);
  return tidyTransform(shownTransform(transform, keys, at));
}

/**
 * What item `ref` can key, in the Keyframes pane's order: a picture's Transform fields (an Overlay's,
 * a video Segment's Framing's) and, for a video with sound (`media`, its Media Library item), its
 * volume; a Music Clip's volume; a Manual Scene's Transform fields only.
 */
export function keyableOf(ref: KeyedRef, media?: { kind: MediaItem["kind"]; has_audio: boolean }): KeyProperty[] {
  if (ref.kind === "music") return ["volume"];
  if (ref.kind === "scene") return [...PICTURE_KEYS];
  return media?.kind === "video" && media.has_audio ? [...PICTURE_KEYS, "volume"] : [...PICTURE_KEYS];
}

/** The rows of item `ref` of `edits` (keyableOf), its Media Library item looked up in `mediaById`. */
export function keyRows(edits: AdvancedEdits, ref: KeyedRef, mediaById: Map<string, MediaItem>): KeyProperty[] {
  const list = ref.kind === "overlay" ? edits.overlays : ref.kind === "segment" ? edits.segments : [];
  const id = list.find((other) => other.id === ref.id)?.media;
  return keyableOf(ref, id ? mediaById.get(id) : undefined);
}

/**
 * The active row of `rows` (an item's keyable properties, its Keyframes `keys`), the one K and the
 * Keyframes pane's ‹ ◆ › act on: the property last `touched`, else the first keyed one, else Scale
 * (Volume for a Music Clip).
 */
export function activeKey(rows: readonly KeyProperty[], keys: Keys, touched: KeyProperty | null): KeyProperty {
  if (touched && rows.includes(touched)) return touched;
  return rows.find((prop) => keys[prop]?.length) ?? (rows.includes("scale") ? "scale" : rows[0]);
}

/** Item `ref`'s Keyframes of `prop` replaced by `list` (a drag of one, an Ease set): one change. Null when it can't be edited. */
export function setItemKeys(scene: KeyScene, ref: KeyedRef, prop: KeyProperty, list: Keyframe[]): Outcome | null {
  const item = itemIn(scene, ref);
  if (!item) return null;
  const { [prop]: _, ...rest } = item.keys;
  return { edits: withKeyed(scene.edits, ref, list.length ? { ...rest, [prop]: list } : rest, prop, item.constant(prop), scene.plan), pick: scene.pick };
}

/**
 * Clear all: item `ref` without any Keyframes, as one change, each keyed property's constant left at
 * its value at the playhead `time` (at the item's nearer end outside it), so that nothing jumps there.
 * Null when it can't be edited.
 */
export function clearItemKeys(scene: KeyScene, ref: KeyedRef, time: number): Outcome | null {
  const item = itemIn(scene, ref);
  if (!item) return null;
  const at = Math.min(Math.max(time - item.start, item.first ?? 0), item.secs);
  let edits = scene.edits;
  for (const [prop, list] of Object.entries(item.keys) as [KeyProperty, Keyframe[]][]) {
    edits = withKeyed(edits, ref, {}, prop, valueAt(list, at, item.constant(prop)), scene.plan);
  }
  return { edits, pick: scene.pick };
}
