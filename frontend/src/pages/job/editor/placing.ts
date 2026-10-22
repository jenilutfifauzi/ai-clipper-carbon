import type { StyleOverrides, StyleValue } from "../../../api";
import { toReference, type Canvas } from "./canvas";

/** Where a move or resize on the preview put the hook or the captions, in the Canvas's pixels (see StageControls). */
export interface Place {
  x: number;
  y: number;
  size: number | null;
}

/**
 * The fields of the hook's or the captions' style that put it at `place` on `canvas`: Custom, at its
 * x and y in the Reference Space (GLOSSARY.md), where a Style keeps them, and its size (which isn't mapped).
 */
export function placedFields(place: Place, canvas: Canvas): Record<string, StyleValue> {
  return { position: "custom", ...toReference(canvas, place), ...(place.size === null ? {} : { size: place.size }) };
}

/** `overrides` with the hook's (`part` "hook") or the captions' ("caption") put at `place` on `canvas`. */
export function placedOverrides(overrides: StyleOverrides, part: "hook" | "caption", place: Place, canvas: Canvas): StyleOverrides {
  return { ...overrides, [part]: { ...overrides[part], ...placedFields(place, canvas) } };
}

/** The Watermark's style fields that centre it at (`x`, `y`) on `canvas`: Custom, in the Reference Space. */
export const watermarkPlaced = (canvas: Canvas, x: number, y: number): Record<string, StyleValue> => ({ position: "custom", ...toReference(canvas, { x, y }) });

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
