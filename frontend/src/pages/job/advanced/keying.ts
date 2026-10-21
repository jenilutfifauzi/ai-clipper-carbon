import type { ClipSegment, Framing, Keyframe, KeyProperty, Keys, LayoutOverride, MediaItem, Overlay, RenderPlan, Shape, TextLayer, Transform } from "../../../api";
import { canvasOf, type Canvas } from "../editor/canvas";
import { NO_CROP } from "../editor/cropGestures";
import { PICTURE_KEYS, valueAt } from "../editor/keyframes";
import { playedFrom, type PlayedSegment } from "../editor/playback";
import { sourceSceneAt, type LayoutEdits } from "../editor/manual";
import { firstSceneOf, sceneOverride, segmentOfScene } from "../editor/ScenesTrack";
import { segmentLength } from "../editor/segmentTime";
import type { Size } from "../editor/pictureGestures";
import { tidyTransform } from "../editor/stagePicture";
import type { Outcome } from "./actions";
import type { AdvancedEdits } from "./edits";
import { clearKeys, keysAround, moveKeysAt, shownTransform, toggleKey, tooManyKeys, toMillionth, writeKey, writtenTransform } from "./keyActions";
import { itemsOf, onlyItem, type Pick } from "./pick";
import type { TrackKind } from "./trackState";

/**
 * Keyframe edits on the items of the edits (ADR 0008): the pure Keyframe actions of
 * ./keyActions.ts done to an Overlay, a Text Layer, a Shape, a Music Clip, a Segment or a Manual Scene at
 * the playhead, each one change of the edits, so one step of undo. A Keyframe is set at the playhead
 * minus the item's start on the Timeline (a Manual Scene's: the playhead's Source time minus its
 * Scene's start, which the plan gives as `keys_from`), and only with the playhead inside the item;
 * a locked Track refuses them, and so does an edit that would put a 101st Keyframe on a property:
 * its outcome is the edits as they were, with a notice. What each kind of item is, and where its
 * Keyframes and constants are kept, is its row of KINDS.
 */

/**
 * An item that can have Keyframes: an Overlay, a Text Layer, a Shape, a Music Clip, a
 * Segment, or a Manual Scene of a Layout Override's (`index` its place among the plan's Scenes,
 * `sceneRef`: that Segment's showing of it).
 */
export type KeyedRef =
  | { kind: "overlay"; id: string }
  | { kind: "text"; id: string }
  | { kind: "shape"; id: string }
  | { kind: "music"; id: string }
  | { kind: "segment"; id: string }
  | { kind: "scene"; index: number };

/** The Manual Scene that is the plan's Scene `index`, as a KeyedRef. */
export const sceneRef = (index: number): KeyedRef => ({ kind: "scene", index });

/** Item `ref`'s name, one of its own among the keyed items: a React key's, a history group's. */
export const refName = (ref: KeyedRef) => (ref.kind === "scene" ? `scene:${ref.index}` : `${ref.kind}:${ref.id}`);

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
  // The Canvas the items are on (canvas.ts), which holds their centres' Keyframes: when not given, the plan's.
  canvas?: Canvas;
}

/** The Canvas of `scene`'s items. */
export const canvasIn = (scene: KeyScene): Canvas => scene.canvas ?? canvasOf(scene.plan);

/**
 * Where an item's Keyframes count from on the Timeline (`start`), and for how long (`secs`). A Manual
 * Scene shown from part way into its shot is on the Timeline from `first` seconds in (0 for every
 * other item).
 */
export interface KeySpan {
  start: number;
  secs: number;
  first?: number;
}

/**
 * An item as keyed: its span, its Keyframes, its constant Transform (a picture's; none for a Music
 * Clip) and volume, its Media Library item's id (`media`, which says whether it has sound to key),
 * and the constant each property has without Keyframes.
 */
export interface KeyedItem extends KeySpan {
  keys: Keys;
  transform?: Transform;
  volume: number;
  media?: string;
  constant: (prop: KeyProperty) => number;
}

// An item's constants as written back: its Transform, its volume; those left out stay as they are.
type Constants = { transform?: Transform; volume?: number };

// `item` as keyed, its constants read from its Transform and volume.
const asKeyed = <T extends Omit<KeyedItem, "constant">>(item: T): T & KeyedItem => ({
  ...item,
  constant: (prop) => (prop === "volume" || !item.transform ? item.volume : item.transform[prop]),
});

// `set` with `prop`'s constant `value`: a turn kept within ±360°, as the Transform's is, where a
// Keyframe may hold more.
function withConstant(set: Constants, prop: KeyProperty, value: number): Constants {
  if (prop === "volume" || !set.transform) return { ...set, volume: value };
  return { ...set, transform: { ...set.transform, [prop]: prop === "rotation" ? value % 360 : value } };
}

// The volume of `set`, as fields to spread: none when it isn't given.
const soundOf = (set: Constants) => (set.volume === undefined ? {} : { volume: set.volume });

/**
 * Where Segment `id` plays on the Timeline: from where it starts on the Main Track as planned
 * (`track`), for its Timeline length; null when there is no such Segment.
 */
export function segmentSpan(segments: ClipSegment[], id: string, track?: PlayedSegment[]): KeySpan | null {
  const index = segments.findIndex((segment) => segment.id === id);
  if (index === -1) return null;
  const planned = track?.length === segments.length ? track : playedFrom(segments);
  return { start: planned[index].start, secs: segmentLength(segments[index]) };
}

// The Speed of the Segment of `plan` that shows its Scene `index` (1 in a Clip of one range).
const sceneSpeed = (plan: RenderPlan, index: number): number => plan.segments[segmentOfScene(plan, index)]?.speed ?? 1;

// `keys` with every Keyframe's time `by` times as far from its item's start, all of them kept: a
// Manual Scene's shown in Timeline seconds and written back in the Source's. (A Speed change drops
// those it crowds: `scaledKeys`.)
const stretchedKeys = (keys: Keys, by: number): Keys =>
  by === 1
    ? keys
    : Object.fromEntries((Object.entries(keys) as [KeyProperty, Keyframe[]][]).map(([prop, list]) => [prop, list.map((key) => ({ ...key, at: toMillionth(key.at * by) }))]));

/**
 * Manual Scene `index` of `plan` framed by its own Layout Override (of `overrides`), as keyed: from
 * the plan's `keys_from` (where its Scene starts, on the Timeline of this showing of it) to its end,
 * on the Timeline from its own start; with its override. Null for any other Scene, one the Candidate's
 * own Manual Framing frames (which has no Keyframes), or while the plan isn't of the override yet.
 * Its override keeps its Keyframes in seconds of its shot on the Source's timeline (the planner's
 * `_keyed_manual`): in a Segment at a Speed they are shown here divided by it, in Timeline seconds,
 * and written back times it (`speed`).
 */
export function manualScene(
  overrides: LayoutOverride[],
  plan: RenderPlan,
  index: number,
): (KeyedItem & { first: number; override: LayoutOverride; framing: Framing; speed: number }) | null {
  const scene = plan.scenes[index];
  const own = scene && sceneOverride(overrides, plan, index);
  const from = scene?.keys_from;
  if (!own || own.layout !== "manual" || !own.framing || from == null) return null;
  const { framing } = own;
  const speed = sceneSpeed(plan, index);
  return asKeyed({
    start: from,
    first: toMillionth(scene.start - from),
    secs: toMillionth(scene.end - from),
    keys: stretchedKeys(own.keys ?? {}, 1 / speed),
    transform: framing.transform,
    volume: 1,
    override: own,
    framing,
    speed,
  });
}

// `edits` with Manual Scene `index`'s own override keyed by `keys`, its Framing's Transform
// `transform` when it is given; as they are without that override.
function withSceneKeys<T extends LayoutEdits>(edits: T, plan: RenderPlan, index: number, keys: Keys, transform?: Transform): T {
  const found = manualScene(edits.layout_overrides, plan, index);
  if (!found) return edits;
  const { override, framing, speed } = found;
  const next = { ...override, keys: stretchedKeys(keys, speed), framing: transform ? { ...framing, transform } : framing };
  return { ...edits, layout_overrides: edits.layout_overrides.map((other) => (other === override ? next : other)) };
}

// A picture's rows: its Transform's fields, and for a video with sound its volume.
const pictureRows = (media?: { kind: MediaItem["kind"]; has_audio: boolean }): KeyProperty[] =>
  media?.kind === "video" && media.has_audio ? [...PICTURE_KEYS, "volume"] : [...PICTURE_KEYS];

type RefOf<K extends KeyedRef["kind"]> = Extract<KeyedRef, { kind: K }>;

/**
 * How each kind of keyed item is kept: the Track whose lock refuses its Keyframe edits (a Manual
 * Scene's is the Video Track, as the Segment showing it is); it as keyed (`find`: a Segment from
 * where the Main Track as planned starts it, a Manual Scene as the plan places it; null when the
 * edits don't have it); what it can key, in the Keyframes pane's order, by its Media Library item;
 * and the edits with it keyed by `keys` and its constants `set` (those given).
 */
interface Kind<R extends KeyedRef> {
  track: TrackKind;
  find: (edits: AdvancedEdits, ref: R, track?: PlayedSegment[], plan?: RenderPlan | null) => KeyedItem | null;
  keyable: (media?: { kind: MediaItem["kind"]; has_audio: boolean }, item?: KeyedItem) => KeyProperty[];
  write: (edits: AdvancedEdits, ref: R, keys: Keys, set: Constants, plan?: RenderPlan | null) => AdvancedEdits;
}

const KINDS: { [K in KeyedRef["kind"]]: Kind<RefOf<K>> } = {
  overlay: {
    track: "overlay",
    find: (edits, ref) => {
      const overlay = edits.overlays.find((other) => other.id === ref.id);
      return overlay ? asKeyed({ start: overlay.start, secs: overlay.secs, keys: overlay.keys, transform: overlay.transform, volume: overlay.volume, media: overlay.media }) : null;
    },
    keyable: pictureRows,
    write: (edits, ref, keys, set) => ({
      ...edits,
      overlays: edits.overlays.map((overlay) => (overlay.id === ref.id ? { ...overlay, keys, transform: set.transform ?? overlay.transform, ...soundOf(set) } : overlay)),
    }),
  },
  // Its Transform only: it has no sound.
  text: {
    track: "text",
    find: (edits, ref) => {
      const layer = edits.text_layers.find((other) => other.id === ref.id);
      return layer ? asKeyed({ start: layer.start, secs: layer.secs, keys: layer.keys, transform: layer.transform, volume: 1 }) : null;
    },
    keyable: () => [...PICTURE_KEYS],
    write: (edits, ref, keys, set) => ({
      ...edits,
      text_layers: edits.text_layers.map((layer) => (layer.id === ref.id ? { ...layer, keys, transform: set.transform ?? layer.transform } : layer)),
    }),
  },
  // Its Transform only, as a Text Layer's.
  shape: {
    track: "shape",
    find: (edits, ref) => {
      const shape = edits.shapes.find((other) => other.id === ref.id);
      return shape ? asKeyed({ start: shape.start, secs: shape.secs, keys: shape.keys, transform: shape.transform, volume: 1 }) : null;
    },
    keyable: () => [...PICTURE_KEYS],
    write: (edits, ref, keys, set) => ({
      ...edits,
      shapes: edits.shapes.map((shape) => (shape.id === ref.id ? { ...shape, keys, transform: set.transform ?? shape.transform } : shape)),
    }),
  },
  music: {
    track: "music",
    find: (edits, ref) => {
      const clip = edits.music.find((other) => other.id === ref.id);
      return clip ? asKeyed({ start: clip.start, secs: clip.secs, keys: clip.keys, volume: clip.volume, media: clip.media ?? undefined }) : null;
    },
    keyable: () => ["volume"],
    write: (edits, ref, keys, set) => ({ ...edits, music: edits.music.map((clip) => (clip.id === ref.id ? { ...clip, keys, ...soundOf(set) } : clip)) }),
  },
  // A video's Segment; one of the Source keys its sound only (its Layouts frame it), and a Freeze
  // frame of it, which is silent, has none.
  segment: {
    track: "video",
    find: (edits, ref, track) => {
      const segment = edits.segments.find((other) => other.id === ref.id);
      const span = segmentSpan(edits.segments, ref.id, track);
      if (!segment || !span) return null;
      const keys = segment.keys ?? {};
      const volume = segment.volume ?? 1;
      if (!segment.media) return segment.hold == null ? asKeyed({ ...span, keys, volume }) : null;
      if (!segment.framing) return null;
      return asKeyed({ ...span, keys, transform: segment.framing.transform, volume, media: segment.media });
    },
    keyable: (media, item) => (item && !item.transform ? ["volume"] : pictureRows(media)),
    write: (edits, ref, keys, set) => ({
      ...edits,
      segments: edits.segments.map((segment) => {
        if (segment.id !== ref.id) return segment;
        if (!segment.framing) return { ...segment, keys, ...soundOf(set) };
        const framing = set.transform ? { ...segment.framing, transform: set.transform } : segment.framing;
        return { ...segment, keys, framing, ...soundOf(set) };
      }),
    }),
  },
  // Its Transform only: its sound is its Segment's, of the Source.
  scene: {
    track: "video",
    find: (edits, ref, _track, plan) => (plan ? manualScene(edits.layout_overrides, plan, ref.index) : null),
    keyable: () => [...PICTURE_KEYS],
    write: (edits, ref, keys, set, plan) => (plan ? withSceneKeys(edits, plan, ref.index, keys, set.transform) : edits),
  },
};

// Item `ref`'s row of KINDS.
const kindOf = <R extends KeyedRef>(ref: R) => KINDS[ref.kind] as unknown as Kind<R>;

/**
 * The item `ref` names, as keyed (a Segment from where `track` starts it, a Manual Scene as `plan`
 * places it); null when the edits don't have it, or for a Freeze frame of the Source, which has no Keyframes.
 */
export function keyedItem(edits: AdvancedEdits, ref: KeyedRef, track?: PlayedSegment[], plan?: RenderPlan | null): KeyedItem | null {
  return kindOf(ref).find(edits, ref, track, plan);
}

// `edits` with `item` (item `ref`) keyed by `keys`, and `prop`'s constant `constant`.
const withKeyed = (scene: KeyScene, ref: KeyedRef, item: KeyedItem, keys: Keys, prop: KeyProperty, constant: number) =>
  kindOf(ref).write(scene.edits, ref, keys, withConstant({ transform: item.transform }, prop, constant), scene.plan);

/** The playhead at `time` (Timeline time) in `item`'s own seconds, to the millisecond; null outside it. */
export function keyTime(item: KeySpan, time: number): number | null {
  const at = Math.round((time - item.start) * 1000) / 1000;
  return at >= Math.round((item.first ?? 0) * 1000) / 1000 && at <= item.secs ? at : null;
}

/** The playhead at `time` (Timeline time) in `item`'s own seconds, held at its start before it and at its end after it. */
export const heldKeyTime = (item: KeySpan, time: number) => Math.min(Math.max(time - item.start, item.first ?? 0), item.secs);

/**
 * A field's history group, of the Keyframe there when the change wrote one (`keyed`): changes to a
 * field merge into one step while they keep coming, but a Keyframe written at another time is a step of its own.
 */
export const keyedGroup = (group: string, keyed: boolean, at: number | null) => (keyed ? `${group}@${at}` : group);

// Item `ref` as keyed in `scene`; null when it can't be edited (gone, or on a locked Track).
function editableItem(scene: KeyScene, ref: KeyedRef): KeyedItem | null {
  if ((scene.locked ?? []).includes(kindOf(ref).track)) return null;
  return keyedItem(scene.edits, ref, scene.track, scene.plan);
}

// The edits as they were, told why: a 101st Keyframe on `prop`.
const refused = (scene: KeyScene, prop: KeyProperty): Outcome => ({ edits: scene.edits, pick: scene.pick, notice: tooManyKeys(prop) });

/** The diamond of `prop` of item `ref` clicked with the playhead at `time`: see toggleKey. Null outside the item. */
export function toggleItemKey(scene: KeyScene, ref: KeyedRef, prop: KeyProperty, time: number): Outcome | null {
  const item = editableItem(scene, ref);
  const at = item && keyTime(item, time);
  if (!item || at === null) return null;
  const { keys, constant, full } = toggleKey(item.keys, prop, at, item.constant(prop), canvasIn(scene));
  if (full) return refused(scene, full);
  return { edits: withKeyed(scene, ref, item, keys, prop, constant), pick: scene.pick };
}

/**
 * `prop` of item `ref` set to `value` with the playhead at `time` (auto-key, see writeKey): a keyed
 * property is written only with the playhead inside the item, else null.
 */
export function writeItemKey(scene: KeyScene, ref: KeyedRef, prop: KeyProperty, value: number, time: number): Outcome | null {
  const item = editableItem(scene, ref);
  if (!item) return null;
  const at = keyTime(item, time);
  if (item.keys[prop]?.length && at === null) return null;
  const { keys, constant, full } = writeKey(item.keys, prop, at ?? item.first ?? 0, value, item.constant(prop), canvasIn(scene));
  if (full) return refused(scene, full);
  return { edits: withKeyed(scene, ref, item, keys, prop, constant), pick: scene.pick };
}

/**
 * Item `ref`'s Transform (an Overlay's, a video Segment's or a Manual Scene's Framing's) changed to
 * `next` with the playhead at `time`, from what was `shown` there (see writtenTransform): on the
 * stage, by its Grips. Null for one that isn't there, has no Transform, or is locked.
 */
export function writeItemTransform(scene: KeyScene, ref: KeyedRef, next: Transform, time: number, shown?: Transform): Outcome | null {
  const item = editableItem(scene, ref);
  if (!item?.transform) return null;
  const written = writtenTransform(item.transform, item.keys, next, keyTime(item, time), canvasIn(scene), shown);
  if (written.full) return refused(scene, written.full);
  return { edits: kindOf(ref).write(scene.edits, ref, written.keys, { transform: written.transform }, scene.plan), pick: scene.pick };
}

/**
 * Manual Scene `index`'s Framing's Transform (of `plan`, its own override's) changed to `next` with
 * the playhead at `time`, from what was `shown` there (see writtenTransform): by its inspector's
 * fields, whatever the editor's edits; refused with a notice (the edits as they were) where it
 * would write a 101st Keyframe. Null for a Scene without its own Manual override.
 */
export function withSceneTransform<T extends LayoutEdits>(
  edits: T,
  plan: RenderPlan,
  index: number,
  next: Transform,
  time: number,
  shown?: Transform,
): { edits: T; notice?: string } | null {
  const found = manualScene(edits.layout_overrides, plan, index);
  if (!found) return null;
  const written = writtenTransform(found.framing.transform, found.keys, next, keyTime(found, time), canvasOf(plan), shown);
  if (written.full) return { edits, notice: tooManyKeys(written.full) };
  return { edits: withSceneKeys(edits, plan, index, written.keys, written.transform) };
}

/**
 * Item `ref`'s ruler diamond at `from` dragged to `to` (both Timeline time): every Keyframe at that
 * instant moved there together (see moveKeysAt), on the Clip's frames at `fps`, with the time they
 * went to. The edits themselves when they stay where they are; null when there are none there, or
 * the item is gone or locked.
 */
export function moveItemKeys(scene: KeyScene, ref: KeyedRef, from: number, to: number, fps: number): (Outcome & { at: number }) | null {
  const item = editableItem(scene, ref);
  const moved = item && moveKeysAt(item.keys, from - item.start, to - item.start, { secs: item.secs, fps, start: item.start });
  if (!item || !moved) return null;
  const at = toMillionth(item.start + moved.at);
  if (moved.keys === item.keys) return { edits: scene.edits, pick: scene.pick, at };
  // Its constants stay as they are.
  return { edits: kindOf(ref).write(scene.edits, ref, moved.keys, {}, scene.plan), pick: scene.pick, at };
}

/**
 * Whether some item of the Pick has Keyframes: an Overlay, a Text Layer, a Shape, a Music Clip, a video's
 * Segment, or a Segment of the Source one of whose Scenes (of `plan`; none without it) is a Manual
 * Scene with them. Keyframes are edited with one item picked.
 */
export function keyedInPick(edits: AdvancedEdits, pick: Pick, plan?: RenderPlan | null): boolean {
  const keyed = (ref: KeyedRef) => Object.keys(keyedItem(edits, ref, undefined, plan)?.keys ?? {}).length > 0;
  return itemsOf(pick).some(({ kind, id }) => {
    // An Adjustment Layer has no Keyframes (ADR 0013): its fades ease it.
    if (kind === "adjustment") return false;
    if (keyed({ kind, id })) return true;
    return kind === "segment" && !!plan && scenesOf(edits, plan, id).some((index) => keyed(sceneRef(index)));
  });
}

// The places among `plan`'s Scenes of those of Segment `id` of the Main Track: all of them in a Clip
// of one range; none while the plan isn't of these Segments.
function scenesOf(edits: AdvancedEdits, plan: RenderPlan, id: string): number[] {
  const index = edits.segments.findIndex((segment) => segment.id === id);
  if (!plan.segments.length) return index === 0 && edits.segments.length === 1 ? plan.scenes.map((_, i) => i) : [];
  if (index === -1 || plan.segments.length !== edits.segments.length) return [];
  const first = firstSceneOf(plan, index);
  return Array.from({ length: plan.segments[index].scenes }, (_, i) => first + i);
}

// The shortcuts (K, [ and ]) work on the one item picked, as the ruler's diamonds do.

/**
 * The item the Pick is when it is one of a kind that can have Keyframes, else null. A Segment of the
 * Source picked with its Manual Scene `scene` under the playhead (`manualSceneAt`) is that Manual
 * Scene; elsewhere it is the Segment, which keys its volume.
 */
export function pickedKeyed(pick: Pick, scene: number | null = null): KeyedRef | null {
  const item = onlyItem(pick);
  if (item?.kind === "segment" && scene !== null) return sceneRef(scene);
  return item && item.kind !== "adjustment" ? { kind: item.kind, id: item.id } : null;
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
  return at === null ? null : toMillionth(item.start + at);
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

/** Text Layer or Shape `layer` Reset: unscaled, unturned and opaque where it is, and none of those fields' Keyframes (its centre's kept). */
export const resetTextLayer = <T extends TextLayer | Shape>(layer: T): T => ({
  ...layer,
  transform: { ...layer.transform, scale: 1, rotation: 0, opacity: 1 },
  keys: clearKeys(layer.keys, ["scale", "rotation", "opacity"]),
});

/**
 * A Transform keyed by `keys`, of an item playing over `span` of the Timeline, as the stage's Grips
 * hold it at `time` on the Canvas `frame`: its keyed fields at the playhead (held at its ends outside it), tidied as the
 * stage tidies what it puts.
 */
export function heldTransform(transform: Transform, keys: Keys, span: KeySpan, time: number, frame: Size): Transform {
  if (!PICTURE_KEYS.some((prop) => keys[prop]?.length)) return transform;
  return tidyTransform(shownTransform(transform, keys, heldKeyTime(span, time), frame));
}

/**
 * What item `ref` can key, in the Keyframes pane's order: a picture's Transform fields (an Overlay's,
 * a video Segment's Framing's) and, for a video with sound (`media`, its Media Library item), its
 * volume; a Music Clip's and a Source Segment's (`item`, as keyed: without a Transform) volume; a
 * Text Layer's, a Shape's and a Manual Scene's Transform fields only.
 */
export function keyableOf(ref: KeyedRef, media?: { kind: MediaItem["kind"]; has_audio: boolean }, item?: KeyedItem): KeyProperty[] {
  return kindOf(ref).keyable(media, item);
}

/** The rows of item `ref` of `edits` (keyableOf), its Media Library item looked up in `mediaById`. */
export function keyRows(edits: AdvancedEdits, ref: KeyedRef, mediaById: Map<string, MediaItem>): KeyProperty[] {
  const item = keyedItem(edits, ref);
  return keyableOf(ref, item?.media ? mediaById.get(item.media) : undefined, item ?? undefined);
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
  const item = editableItem(scene, ref);
  if (!item) return null;
  const { [prop]: _, ...rest } = item.keys;
  return { edits: kindOf(ref).write(scene.edits, ref, list.length ? { ...rest, [prop]: list } : rest, {}, scene.plan), pick: scene.pick };
}

/**
 * Clear all: item `ref` without any Keyframes, as one change, each keyed property's constant left at
 * its value at the playhead `time` (at the item's nearer end outside it), so that nothing jumps there.
 * Null when it can't be edited.
 */
export function clearItemKeys(scene: KeyScene, ref: KeyedRef, time: number): Outcome | null {
  const item = editableItem(scene, ref);
  if (!item) return null;
  const at = heldKeyTime(item, time);
  let set: Constants = { transform: item.transform };
  for (const [prop, list] of Object.entries(item.keys) as [KeyProperty, Keyframe[]][]) set = withConstant(set, prop, valueAt(list, at, item.constant(prop)));
  return { edits: kindOf(ref).write(scene.edits, ref, {}, set, scene.plan), pick: scene.pick };
}
