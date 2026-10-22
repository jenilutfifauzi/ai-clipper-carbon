import type { CueKey, RenderPlan } from "../../../api";
import type { PickedOnStage } from "../editor/ClipPreview";
import { cueKeyOf, cueStageId } from "../editor/cues";
import type { AdvancedEdits } from "./edits";
import type { TrackKind } from "./trackState";
import { sameKey } from "../editor/timelineKey";

// The Pick (GLOSSARY.md): what is picked on the Advanced Edit's Timeline or preview, which its actions
// and inspector act on. Kept in the editor only: never saved, never undone.

// The items that are picked together, and the list of the edits each kind is in.
export type ItemKind = "segment" | "text" | "shape" | "music" | "overlay" | "adjustment";
export const LISTS = {
  segment: "segments",
  text: "text_layers",
  shape: "shapes",
  music: "music",
  overlay: "overlays",
  adjustment: "adjustment_layers",
} as const;

/** The items of `kind` in `edits`: none of a list a Candidate from before it lacks (Adjustment Layers). */
export const listOf = <K extends ItemKind>(edits: Partial<AdvancedEdits>, kind: K) =>
  (edits[LISTS[kind]] ?? []) as NonNullable<AdvancedEdits[(typeof LISTS)[K]]>;

// The kinds of item placed on the frame by a Transform, and picked on the stage: Text Layers,
// Shapes and Overlays.
export type PlacedKind = "text" | "shape" | "overlay";
// The picture layers' kinds (GLOSSARY.md): Text Layers and Shapes.
export type PictureLayerKind = Extract<PlacedKind, "text" | "shape">;

/** Whether items of `kind` are placed on the frame by a Transform. */
export const isPlaced = (kind: ItemKind): kind is PlacedKind => kind === "text" || kind === "shape" || kind === "overlay";

export interface ItemRef {
  kind: ItemKind;
  id: string;
}

/**
 * One or more Segments, Text Layers, Shapes, Music Clips, Overlays and Adjustment Layers, mixed; or the hook, the captions,
 * one Cue (by its key) or the join after a Segment (for its Transition), alone; or nothing.
 */
export type Pick =
  | { kind: "items"; items: ItemRef[] }
  | { kind: "hook" }
  | { kind: "captions" }
  | { kind: "cue"; key: CueKey }
  | { kind: "join"; after: string }
  | null;

/** `pick` without its Cue once `plan` (when there is one) has no Cue of its key: after an edit, an undo or a change from elsewhere. */
export function prunedCue(pick: Pick, plan: RenderPlan | null): Pick {
  if (pick?.kind !== "cue" || !plan) return pick;
  return plan.captions.some((cue) => sameKey(cue.key, pick.key)) ? pick : null;
}

/** The Pick of `items`: nothing when there are none. */
export const picked = (...items: ItemRef[]): Pick => (items.length ? { kind: "items", items } : null);

/** The items picked: none when the Pick is the hook, the captions, a join or nothing. */
export const itemsOf = (pick: Pick): ItemRef[] => (pick?.kind === "items" ? pick.items : []);

export const isPicked = (pick: Pick, kind: ItemKind, id: string) => itemsOf(pick).some((item) => item.kind === kind && item.id === id);

/** The one item picked, when exactly one is. */
export const onlyItem = (pick: Pick): ItemRef | null => (pick?.kind === "items" && pick.items.length === 1 ? pick.items[0] : null);

export const samePick = (a: Pick, b: Pick) => JSON.stringify(a) === JSON.stringify(b);

/** `pick` with `item` added, or taken out when it is in it. The hook, the captions or a join give way to it. */
export function toggled(pick: Pick, item: ItemRef): Pick {
  const items = itemsOf(pick);
  return isPicked(pick, item.kind, item.id)
    ? picked(...items.filter((other) => other.kind !== item.kind || other.id !== item.id))
    : picked(...items, item);
}

/** The Pick after a click on `item`: it alone, or with Shift, Cmd or Ctrl (`toggle`) added or taken out. */
export const clicked = (pick: Pick, item: ItemRef, toggle: boolean): Pick => (toggle ? toggled(pick, item) : picked(item));

/** Each kind of item, by name: "Text Layer". */
export const NAMES: Record<ItemKind, string> = {
  segment: "Segment",
  text: "Text Layer",
  shape: "Shape",
  music: "Music Clip",
  overlay: "Overlay",
  adjustment: "Adjustment Layer",
};

/** `n` items of `kind`, by name: "1 Text Layer", "2 Overlays". */
export const counted = (n: number, kind: ItemKind) => `${n} ${NAMES[kind]}${n === 1 ? "" : "s"}`;

/** Parts of a sentence listed: "a", "a and b", "a, b and c". */
export const listed = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? ""));

/** The Track each kind of item is on: an Overlay Behind the Main Track is on the Behind Track instead (`trackOf`). */
export const TRACK_OF: Record<ItemKind, TrackKind> = { segment: "video", text: "text", shape: "shape", music: "music", overlay: "overlay", adjustment: "adjust" };

/** The Track `item` (of `kind`) is on: its kind's, or the Behind Track for an Overlay Behind the Main Track (ADR 0015). */
export const trackOf = (kind: ItemKind, item: { behind?: boolean } | undefined): TrackKind =>
  kind === "overlay" && item?.behind ? "behind" : TRACK_OF[kind];

/** The Overlays on `track`: the Overlay Track's, over the Main Track, or the Behind Track's (ADR 0015). */
export const overlaysOn = <T extends { behind?: boolean }>(overlays: T[], track: "overlay" | "behind"): T[] =>
  overlays.filter((overlay) => trackOf("overlay", overlay) === track);

/** The Track the item `ref` names is on, in `edits` (`trackOf`). */
export const trackOfRef = (ref: ItemRef, edits: Partial<AdvancedEdits> | undefined): TrackKind =>
  trackOf(ref.kind, edits && (listOf(edits, ref.kind) as { id: string; behind?: boolean }[]).find((item) => item.id === ref.id));

/**
 * `pick` without what is on the `locked` Tracks, which can't be picked: a join is on the Video Track, a
 * Cue on the Captions Track, an Overlay on the Overlay Track or, Behind the Main Track, on the Behind
 * Track (as `edits` has it).
 */
export function unlockedPick(pick: Pick, locked: TrackKind[], edits?: Partial<AdvancedEdits>): Pick {
  if (!locked.length || pick === null) return pick;
  if (pick.kind === "join") return locked.includes("video") ? null : pick;
  if (pick.kind === "cue") return locked.includes("captions") ? null : pick;
  if (pick.kind !== "items") return locked.includes(pick.kind) ? null : pick;
  const kept = pick.items.filter((item) => !locked.includes(trackOfRef(item, edits)));
  return kept.length === pick.items.length ? pick : picked(...kept);
}

/** `pick` with what `edits` no longer has left out: after an undo, a redo or a change from elsewhere. */
export function prunedPick(pick: Pick, edits: AdvancedEdits): Pick {
  if (pick?.kind === "join") {
    const index = edits.segments.findIndex((segment) => segment.id === pick.after);
    return index >= 0 && index < edits.segments.length - 1 ? pick : null;
  }
  if (pick?.kind !== "items") return pick;
  const kept = pick.items.filter((item) => (listOf(edits, item.kind) as { id: string }[]).some((other) => other.id === item.id));
  return kept.length === pick.items.length ? pick : picked(...kept);
}

/** The ids on the preview's stage (StageControls) of what is picked there: the hook, the captions, a Cue, Text Layers, Shapes and Overlays. */
export function stageIdsOf(pick: Pick): PickedOnStage[] {
  if (pick?.kind === "hook" || pick?.kind === "captions") return [pick.kind];
  if (pick?.kind === "cue") return [cueStageId(pick.key)];
  return itemsOf(pick).flatMap((item): PickedOnStage[] => (isPlaced(item.kind) ? [`${item.kind}:${item.id}`] : []));
}

/** What a stage id names: the hook, the captions, a Cue, a Text Layer, a Shape or an Overlay. */
export function stageItem(stageId: PickedOnStage): { kind: "hook" } | { kind: "captions" } | { kind: "cue"; key: CueKey } | ItemRef {
  if (stageId === "hook" || stageId === "captions") return { kind: stageId };
  if (stageId.startsWith("cue:")) return { kind: "cue", key: cueKeyOf(stageId as `cue:${string}`) };
  const [kind, ...id] = stageId.split(":");
  return { kind: kind as PlacedKind, id: id.join(":") };
}

/** An item's key on the Timeline: its kind and id. */
export const keyOf = (item: ItemRef) => `${item.kind}:${item.id}`;

const KINDS = new Set<string>(Object.keys(LISTS));

// The item a key names, if it is one that is picked with others.
function refOf(key: string): ItemRef | null {
  const [kind, id] = key.split(":");
  return KINDS.has(kind) && id ? { kind: kind as ItemKind, id } : null;
}

type Area = { left: number; right: number; top: number; bottom: number };

/**
 * The Pick after a rubber band over `band`: each item drawn (`items`, by key, in the same pixels) that
 * it touches, even partly; added to `pick` with `add` (Shift), else in its place. The hook, the
 * captions and joins aren't picked by it.
 */
export function bandPick(pick: Pick, items: (Area & { key: string })[], band: Area, add: boolean): Pick {
  const touched = items
    .filter((item) => item.left < band.right && band.left < item.right && item.top < band.bottom && band.top < item.bottom)
    .map((item) => refOf(item.key))
    .filter((item): item is ItemRef => item !== null);
  if (!add) return picked(...touched);
  return picked(...itemsOf(pick), ...touched.filter((item) => !isPicked(pick, item.kind, item.id)));
}
