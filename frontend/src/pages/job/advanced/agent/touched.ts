import { same } from "../../editor/merge";
import { playedFrom } from "../../editor/playback";
import type { AdvancedEdits } from "../edits";

/**
 * What a Revision changed (ADR 0029): the diff of the edits before and after it, never the tool's
 * arguments, so that it is right for every tool (a Template or a Narration adds items no call names).
 * Items are compared by id per kind (a Transition by the Segment it follows); what has no id comes
 * back as a named flag. A new item kind needs its place here to show the Agent's presence.
 */

// The kinds of item the Timeline draws, by their field in the edits.
export const TOUCHED_KINDS = ["segments", "text_layers", "shapes", "music", "overlays", "adjustment_layers", "transitions"] as const;
export type TouchedKind = (typeof TOUCHED_KINDS)[number];

export interface TouchedItem {
  kind: TouchedKind;
  id: string;
  how: "added" | "changed" | "removed";
}

// The changes with no id, each named by what it changes: the hook, the captions' look, the Word Edits,
// the Cue Edits, the Layouts, the source's volume, the Grade.
export type TouchedFlag = "hook" | "captions" | "words" | "cues" | "layout" | "volume" | "grade";

// Each field of the edits that holds no item, by the flag it raises: a new field must be named here.
const FLAGGED: Record<Exclude<keyof AdvancedEdits, TouchedKind>, TouchedFlag> = {
  hook_start: "hook",
  hook_secs: "hook",
  hook_text: "hook",
  hook_kicker: "hook",
  preset_id: "captions",
  style_overrides: "captions",
  word_edits: "words",
  cue_edits: "cues",
  layout: "layout",
  framing: "layout",
  layout_overrides: "layout",
  source_volume: "volume",
  grade: "grade",
};
const FLAG_ORDER: TouchedFlag[] = ["hook", "captions", "words", "cues", "layout", "volume", "grade"];

export interface Touched {
  // In the kinds' order; in each, added and changed ones in the new order, then the removed ones.
  items: TouchedItem[];
  flags: TouchedFlag[];
}

const keyOf = (kind: TouchedKind, item: { id?: string; after?: string }) => (kind === "transitions" ? item.after! : item.id!);
const itemsOf = (edits: AdvancedEdits, kind: TouchedKind) => (edits[kind] ?? []) as { id?: string; after?: string }[];

/** The items and flags `after` changed from `before`: none when they are equal. */
export function touchedItems(before: AdvancedEdits, after: AdvancedEdits): Touched {
  const items: TouchedItem[] = [];
  for (const kind of TOUCHED_KINDS) {
    const old = new Map(itemsOf(before, kind).map((item) => [keyOf(kind, item), item]));
    const kept = new Set<string>();
    for (const item of itemsOf(after, kind)) {
      const id = keyOf(kind, item);
      kept.add(id);
      const was = old.get(id);
      if (was === undefined) items.push({ kind, id, how: "added" });
      else if (!same(was, item)) items.push({ kind, id, how: "changed" });
    }
    for (const id of old.keys()) if (!kept.has(id)) items.push({ kind, id, how: "removed" });
  }
  const raised = new Set<TouchedFlag>();
  for (const [field, flag] of Object.entries(FLAGGED) as [keyof typeof FLAGGED, TouchedFlag][]) {
    if (!raised.has(flag) && !same(before[field], after[field])) raised.add(flag);
  }
  return { items, flags: FLAG_ORDER.filter((flag) => raised.has(flag)) };
}

// Where the Agent was last at work: an item of `kind` (or the hook), at `time` on the Timeline.
export interface PresenceTarget {
  kind: TouchedKind | "hook";
  id: string;
  time: number;
}

/**
 * Where the first touched item is on the Timeline: from where it starts after the Revision, or a
 * removed one before it; a Transition at the end of the Segment it follows. The hook, when only flags
 * changed and it is one of them; else null.
 */
export function touchedTarget(touched: Touched, before: AdvancedEdits, after: AdvancedEdits): PresenceTarget | null {
  const first = touched.items[0];
  if (!first) return touched.flags.includes("hook") ? { kind: "hook", id: "hook", time: after.hook_start } : null;
  const edits = first.how === "removed" ? before : after;
  const items = itemsOf(edits, first.kind);
  if (first.kind === "segments" || first.kind === "transitions") {
    const played = playedFrom(edits.segments, edits.transitions);
    const index = edits.segments.findIndex((segment) => segment.id === first.id);
    const time = index < 0 ? 0 : first.kind === "segments" ? played[index].start : played[index].end;
    return { kind: first.kind, id: first.id, time };
  }
  const item = items.find((each) => keyOf(first.kind, each) === first.id) as { start?: number } | undefined;
  return { kind: first.kind, id: first.id, time: item?.start ?? 0 };
}
