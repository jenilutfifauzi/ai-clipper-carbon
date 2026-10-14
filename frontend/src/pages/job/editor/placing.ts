import type { StyleOverrides, StyleValue } from "../../../api";

/** Where a move or resize on the preview put the hook or the captions (see StageControls). */
export interface Place {
  x: number;
  y: number;
  size: number | null;
}

/** The fields of the hook's or the captions' style that put it at `place`: Custom, at x and y, and its size. */
export function placedFields(place: Place): Record<string, StyleValue> {
  return { position: "custom", x: place.x, y: place.y, ...(place.size === null ? {} : { size: place.size }) };
}

/** `overrides` with the hook's (`part` "hook") or the captions' ("caption") put at `place`. */
export function placedOverrides(overrides: StyleOverrides, part: "hook" | "caption", place: Place): StyleOverrides {
  return { ...overrides, [part]: { ...overrides[part], ...placedFields(place) } };
}

// What a move on the preview sets, which "Reset position" takes back to the Style Preset's.
const PLACED_FIELDS = ["position", "x", "y"] as const;

/** `overrides` without the hook's or the captions' place: where their Style Preset puts them. */
export function unplacedOverrides(overrides: StyleOverrides, part: "hook" | "caption"): StyleOverrides {
  const fields: Record<string, StyleValue> = { ...overrides[part] };
  for (const field of PLACED_FIELDS) delete fields[field];
  return { ...overrides, [part]: fields };
}

/** Whether the hook's or the captions' place is their own, not their Style Preset's. */
export const isPlaced = (overrides: StyleOverrides, part: "hook" | "caption") =>
  PLACED_FIELDS.some((field) => field in overrides[part]);
