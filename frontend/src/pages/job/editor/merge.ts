import type { Candidate, CandidateChange } from "../../../api";
import { keyText, type TimelineKey } from "./timelineKey";

/**
 * Merging an editor's unsaved edits onto a newer Revision of its Candidate (ADR 0003), three ways:
 * base is what the editor started from, mine its unsaved edits, theirs the newer Revision's. Lists
 * with keys merge item by item, Style Overrides field by field, the rest field by field; where both
 * sides changed the same thing, the owner's (mine) wins and it is a Collision.
 */

// The edits of a Candidate that are merged: any of its content fields.
export type Edits = Omit<CandidateChange, "revision" | "selected">;

// A thing both sides changed: a field, and the item of a list or the Style Override in it.
export interface Collision {
  field: keyof Edits;
  item?: string;
}

export interface Merged<T> {
  merged: T;
  collisions: Collision[];
}

type Item = Record<string, unknown>;

// Each list's items by this key (or these fields): the MCP merge tool's keys. A Word Edit's and a
// Cue Edit's is its time on its timeline, the Source's or (with `media`) a Media Library item's
// (ADR 0020), the time to the millisecond.
const KEYS = {
  segments: "id",
  text_layers: "id",
  shapes: "id",
  music: "id",
  overlays: "id",
  transitions: "after",
  word_edits: ["at", "media"],
  layout_overrides: "at",
  cue_edits: ["at", "media"],
  adjustment_layers: "id",
} as const satisfies Partial<Record<keyof Edits, string | readonly string[]>>;

type ListField = keyof typeof KEYS;

export function mergeEdits<T extends Edits>(base: T, mine: T, theirs: T): Merged<T> {
  const [b, m, t] = [fields(base), fields(mine), fields(theirs)];
  const merged = { ...t };
  const collisions: Collision[] = [];
  for (const field of Object.keys(KEYS) as ListField[]) {
    if (!(field in m)) continue;
    // A list a Candidate from before it lacks (Adjustment Layers) is none.
    merged[field] = mergeList(field, (b[field] ?? []) as Item[], (m[field] ?? []) as Item[], (t[field] ?? []) as Item[], collisions);
  }
  for (const field of Object.keys(m) as (keyof Edits)[]) {
    if (field in KEYS || field === "style_overrides") continue;
    const result = mergeValue(b[field], m[field], t[field]);
    if (result.collision) collisions.push({ field });
    merged[field] = result.value;
  }
  if ("style_overrides" in m) {
    merged.style_overrides = mergeOverrides(b.style_overrides as Overrides, m.style_overrides as Overrides, t.style_overrides as Overrides, collisions);
  }
  return { merged: merged as T, collisions };
}

type Overrides = Record<string, Item>;

// Style Overrides, section by section (caption, hook, watermark) and field by field.
function mergeOverrides(base: Overrides, mine: Overrides, theirs: Overrides, collisions: Collision[]): Overrides {
  const merged: Overrides = {};
  for (const section of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const [b, m, t] = [base[section] ?? {}, mine[section] ?? {}, theirs[section] ?? {}];
    merged[section] = {};
    for (const name of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])) {
      const result = mergeValue(b[name], m[name], t[name]);
      if (result.collision) collisions.push({ field: "style_overrides", item: `${section}.${name}` });
      if (result.value !== undefined) merged[section][name] = result.value;
    }
  }
  return merged;
}

/**
 * An undo history's snapshots once theirs has landed: in each, what changed elsewhere (from base to
 * theirs) is theirs, and the rest is the snapshot's own. Undo then takes back only the owner's steps.
 */
export function rebaseHistory<T extends Edits>(snapshots: T[], base: T, theirs: T): T[] {
  // The same merge with the sides swapped: here theirs wins.
  return snapshots.map((snapshot) => mergeEdits(base, theirs, snapshot).merged);
}

// The fields of `edits` as `candidate` has them: what a change of those fields is merged from.
export function fieldsOf<T extends Edits>(candidate: Candidate, edits: T): T {
  return Object.fromEntries(Object.keys(edits).map((field) => [field, (candidate as unknown as Record<string, unknown>)[field]])) as T;
}

// The parts the editors name, by the Candidate field a Collision names.
const PART_OF: Record<Collision["field"], string> = {
  start: "Range",
  end: "Range",
  segments: "Segments",
  text_layers: "Text Layers",
  shapes: "Shapes",
  music: "Music",
  overlays: "Overlays",
  transitions: "Transitions",
  hook_text: "Hook",
  hook_kicker: "Hook",
  hook_start: "Hook",
  hook_secs: "Hook",
  preset_id: "Style",
  style_overrides: "Style",
  word_edits: "Word Edits",
  cue_edits: "Cue Edits",
  layout: "Layout",
  framing: "Layout",
  aspect: "Layout",
  layout_overrides: "Layout Overrides",
  source_volume: "Source volume",
  grade: "Color",
  adjustment_layers: "Adjustment Layers",
};

// The parts of a merge's Collisions, each once.
export function collidedParts(collisions: Collision[]): string {
  return [...new Set(collisions.map((collision) => PART_OF[collision.field]))].join(", ");
}

// An item's key: a timed item's (keyed by `at`, and `media` when it has one) its time on its
// timeline to the millisecond, as the backend de-duplicates (keyText); another's its key field's.
const keyOf = (item: Item, key: string | readonly string[]) =>
  key === "at" || typeof key !== "string" ? keyText(item as unknown as TimelineKey) : String(item[key] ?? "");

// Edits seen as plain JSON fields.
const fields = (edits: Edits) => edits as Record<string, unknown>;

function mergeList(field: ListField, base: Item[], mine: Item[], theirs: Item[], collisions: Collision[]): Item[] {
  const key = KEYS[field];
  const byKey = (items: Item[]) => new Map(items.map((item) => [keyOf(item, key), item]));
  const [b, m, t] = [byKey(base), byKey(mine), byKey(theirs)];
  const kept = new Map<string, Item>();
  for (const id of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
    const result = mergeValue(b.get(id), m.get(id), t.get(id));
    if (result.collision) collisions.push({ field, item: id });
    if (result.value) kept.set(id, result.value);
  }
  const order = ordered(
    [base, mine, theirs].map((items) => items.map((item) => keyOf(item, key))) as [string[], string[], string[]],
    kept,
  );
  return order.map((id) => kept.get(id)!);
}

/**
 * The order of the kept items: mine if I reordered the items base had, otherwise theirs. Each kept
 * item that order lacks goes after the item it followed in its own list (mine's, else theirs').
 */
function ordered([base, mine, theirs]: [string[], string[], string[]], kept: Map<string, unknown>): string[] {
  const order = (reordered(base, mine) ? mine : theirs).filter((id) => kept.has(id));
  for (const source of [mine, theirs]) {
    source.forEach((id, i) => {
      if (!kept.has(id) || order.includes(id)) return;
      const after = source.slice(0, i).findLast((before) => order.includes(before));
      order.splice(after === undefined ? 0 : order.indexOf(after) + 1, 0, id);
    });
  }
  return order;
}

// Whether `side` has the items it shares with `base` in another order.
function reordered(base: string[], side: string[]): boolean {
  const shared = side.filter((id) => base.includes(id));
  return !same(shared, base.filter((id) => shared.includes(id)));
}

// One value (a field, a list's item or an override), three ways; undefined where a side hasn't it.
function mergeValue<V>(base: V | undefined, mine: V | undefined, theirs: V | undefined): { value?: V; collision: boolean } {
  if (same(base, mine)) return { value: theirs, collision: false };
  if (same(base, theirs) || same(mine, theirs)) return { value: mine, collision: false };
  return { value: mine, collision: true };
}

// Structural equality of JSON values, whatever the order of their keys.
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => same(value, b[i]));
  const [x, y] = [a as Item, b as Item];
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => k in y && same(x[k], y[k]));
}
