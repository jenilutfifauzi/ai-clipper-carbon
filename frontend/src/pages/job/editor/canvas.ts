import { createContext, useContext, useRef } from "react";
import type { Aspect, Box, RenderPlan } from "../../../api";

/**
 * The Canvas (GLOSSARY.md, docs/adr/0022): the Candidate's frame in output pixels, set by its Canvas
 * Aspect, and its Safe Area. The Preview Plan carries both (backend/app/canvas.py), so the editor
 * keeps no per-aspect sizes of its own (ADR 0001); before a plan is loaded, it draws the 9:16 one.
 */
export interface Canvas {
  width: number;
  height: number;
  safe_area: Box;
}

// The 9:16 Canvas (canvas.py's PORTRAIT): what is drawn until a plan says otherwise.
export const PORTRAIT: Canvas = { width: 1080, height: 1920, safe_area: { x: 0, y: 232, width: 950, height: 1304 } };

// The Reference Space (GLOSSARY.md): the 1080×1920 frame the Caption, Hook and Watermark Styles keep
// their places in on every Canvas, and that Video Effects' sizes are measured against.
export const REFERENCE = { width: 1080, height: 1920 } as const;
// Its Safe Area (9:16's), which the Hook Style's height is held to.
export const REFERENCE_SAFE_AREA = PORTRAIT.safe_area;
// How tall a caption area is (canvas.py's CAPTION_HEIGHT): a line's middle stays half of it inside a Safe Area.
export const CAPTION_HEIGHT = 200;

/** The Canvas `plan` is drawn on; while there is no plan, the Candidate's `aspect`'s (9:16 by default). */
export function canvasOf(plan: RenderPlan | null | undefined, aspect: Aspect = "9:16"): Canvas {
  if (!plan) return aspectCanvas(aspect);
  return { width: plan.width, height: plan.height, safe_area: plan.safe_area };
}

/** An aspect's width and height in lowest terms ("16:9" is 16 by 9). */
export function aspectParts(aspect: Aspect): { width: number; height: number } {
  const [width, height] = aspect.split(":").map(Number);
  return { width, height };
}

/** The CSS `aspect-ratio` of a box of `aspect`'s shape (a Candidate's thumbnail, a Clip's poster). */
export const aspectRatio = (aspect: Aspect) => aspect.replace(":", " / ");

/**
 * The tallest of `aspects` (9:16 when there are none): the shape of a grid's every slot, so that
 * cards of mixed shapes, each as wide as its slot, line up.
 */
export function tallestAspect(aspects: Iterable<Aspect>): Aspect {
  let tallest: Aspect | null = null;
  const across = (aspect: Aspect) => aspectParts(aspect).width / aspectParts(aspect).height;
  for (const aspect of aspects) if (tallest === null || across(aspect) < across(tallest)) tallest = aspect;
  return tallest ?? "9:16";
}

// Kept clear on each edge of a Canvas other than 9:16 (canvas.py's SAFE_MARGIN).
const SAFE_MARGIN = 0.05;

/**
 * The Canvas of `aspect` as canvas.py makes it (its short side 1080, each side even), drawn only
 * until the Candidate's plan comes: the plan's is the one that counts (ADR 0001).
 */
export function aspectCanvas(aspect: Aspect): Canvas {
  if (aspect === "9:16") return PORTRAIT;
  const parts = aspectParts(aspect);
  const short = Math.min(parts.width, parts.height);
  const [width, height] = [parts.width, parts.height].map((side) => Math.round((1080 * side) / short / 2) * 2);
  const [x, y] = [Math.round(width * SAFE_MARGIN), Math.round(height * SAFE_MARGIN)];
  return { width, height, safe_area: { x, y, width: width - 2 * x, height: height - 2 * y } };
}

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** `canvasOf(plan, aspect)`, the same object while each new plan has the same Canvas, as a hook's or a context's dependency. */
export function useCanvasOf(plan: RenderPlan | null | undefined, aspect?: Aspect): Canvas {
  const next = canvasOf(plan, aspect);
  const kept = useRef(next);
  const was = kept.current;
  if (was.width !== next.width || was.height !== next.height || !sameBox(was.safe_area, next.safe_area)) kept.current = next;
  return kept.current;
}

/**
 * The largest size of the `canvas`'s aspect that fits in `room`, in whole CSS pixels: the stage's in
 * a player. The aspect is taken in its lowest terms (9:16, 16:9), so a size works out the same on
 * every Canvas of it.
 */
export function fittedStage(room: { width: number; height: number }, canvas: { width: number; height: number }): { width: number; height: number } {
  const divisor = gcd(Math.round(canvas.width), Math.round(canvas.height));
  const [across, down] = [Math.round(canvas.width) / divisor, Math.round(canvas.height) / divisor];
  const unit = Math.max(0, Math.min(room.width / across, room.height / down));
  return { width: Math.floor(unit * across), height: Math.floor(unit * down) };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a || 1);

/** The Canvas's centre, in its pixels. */
export const centreOf = (canvas: { width: number; height: number }) => ({ x: canvas.width / 2, y: canvas.height / 2 });

// The Canvas of the Candidate being edited, for the inspector's fields and the panels that add items.
export const CanvasContext = createContext<Canvas>(PORTRAIT);
export const useCanvas = () => useContext(CanvasContext);
