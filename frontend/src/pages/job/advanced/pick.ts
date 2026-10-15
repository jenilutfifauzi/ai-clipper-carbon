import type { StageId } from "../editor/ClipPreview";
import type { AdvancedEdits } from "./edits";

// The Pick (GLOSSARY.md): what is picked on the Advanced Edit's Timeline or preview, which its actions
// and inspector act on. Kept in the editor only: never saved, never undone.

// The items that are picked together, and the list of the edits each kind is in.
export type ItemKind = "segment" | "text" | "music" | "overlay";
export const LISTS = { segment: "segments", text: "text_layers", music: "music", overlay: "overlays" } as const;

export interface ItemRef {
  kind: ItemKind;
  id: string;
}

/**
 * One or more Segments, Text Layers, Music Clips and Overlays, mixed; or the hook, the captions or
 * the join after a Segment (for its Transition), alone; or nothing.
 */
export type Pick = { kind: "items"; items: ItemRef[] } | { kind: "hook" } | { kind: "captions" } | { kind: "join"; after: string } | null;

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

/** `pick` with what `edits` no longer has left out: after an undo, a redo or a change from elsewhere. */
export function prunedPick(pick: Pick, edits: AdvancedEdits): Pick {
  if (pick?.kind === "join") {
    const index = edits.segments.findIndex((segment) => segment.id === pick.after);
    return index >= 0 && index < edits.segments.length - 1 ? pick : null;
  }
  if (pick?.kind !== "items") return pick;
  const kept = pick.items.filter((item) => (edits[LISTS[item.kind]] as { id: string }[]).some((other) => other.id === item.id));
  return kept.length === pick.items.length ? pick : picked(...kept);
}

/** The ids on the preview's stage (StageControls) of what is picked there. */
export function stageIdsOf(pick: Pick): StageId[] {
  if (pick?.kind === "hook" || pick?.kind === "captions") return [pick.kind];
  return itemsOf(pick)
    .filter((item) => item.kind === "text")
    .map((item): StageId => `text:${item.id}`);
}

/** What a stage id names: the hook, the captions or a Text Layer. */
export function stageItem(stageId: StageId): { kind: "hook" } | { kind: "captions" } | ItemRef {
  if (stageId === "hook" || stageId === "captions") return { kind: stageId };
  return { kind: "text", id: stageId.slice("text:".length) };
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
