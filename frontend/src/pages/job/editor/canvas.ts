import { createContext, useContext, useRef } from "react";
import type { Aspect, Box, RenderPlan } from "../../../api";

/**
 * The Canvas (GLOSSARY.md, docs/adr/0022): the Candidate's frame in output pixels, set by its Canvas
 * Aspect, and its Safe Area. The Preview Plan carries both (backend/app/canvas.py), so the editor
 * keeps no per-aspect sizes of its own (ADR 0001); before a plan is loaded, it draws its Candidate's
 * aspect's (`CANVASES`, canvas.py's), or the 9:16 one.
 */
export interface Canvas {
  width: number;
  height: number;
  safe_area: Box;
}

// The 9:16 Canvas (canvas.py's PORTRAIT): what is drawn until a plan says otherwise.
export const PORTRAIT: Canvas = { width: 1080, height: 1920, safe_area: { x: 0, y: 232, width: 950, height: 1304 } };

// The Reference Space (GLOSSARY.md): the 1080×1920 frame the Caption, Hook and Watermark Styles keep
// their places in on every Canvas.
export const REFERENCE = { width: 1080, height: 1920 } as const;
// Its Safe Area (9:16's), which the Hook Style's height is held to.
export const REFERENCE_SAFE_AREA = PORTRAIT.safe_area;
// How tall a caption area is (canvas.py's CAPTION_HEIGHT): a line's middle stays half of it inside a Safe Area.
export const CAPTION_HEIGHT = 200;

// A place in the Reference Space is kept to this many decimals: enough that it maps back onto the
// Canvas pixel it came from on every aspect.
const REFERENCE_DECIMALS = 100;

/**
 * A place in `canvas`'s pixels (a caption, the hook or the Watermark dragged on the stage) in the
 * Reference Space, where their Style keeps it: x·1080/W and y·1920/H, to a hundredth of a pixel, so
 * that the planner's mapping (`fromReference`) puts it back on the pixel it was dropped on. Itself
 * on 9:16.
 */
export function toReference(canvas: { width: number; height: number }, place: { x: number; y: number }): { x: number; y: number } {
  const kept = (value: number) => Math.round(value * REFERENCE_DECIMALS) / REFERENCE_DECIMALS;
  return { x: kept((place.x * REFERENCE.width) / canvas.width), y: kept((place.y * REFERENCE.height) / canvas.height) };
}

/** A Style's place in the Reference Space on `canvas`, to the pixel, as the planner maps it (canvas.py's x_from_reference, y_from_reference). */
export function fromReference(canvas: { width: number; height: number }, place: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round((place.x * canvas.width) / REFERENCE.width), y: Math.round((place.y * canvas.height) / REFERENCE.height) };
}

// Each aspect's Canvas, as backend/app/canvas.py makes it (the others keep a twentieth clear at each
// edge): only for drawing a Candidate before its first plan comes.
export const CANVASES: Record<Aspect, Canvas> = {
  "9:16": PORTRAIT,
  "4:5": { width: 1080, height: 1350, safe_area: { x: 54, y: 68, width: 972, height: 1214 } },
  "1:1": { width: 1080, height: 1080, safe_area: { x: 54, y: 54, width: 972, height: 972 } },
  "16:9": { width: 1920, height: 1080, safe_area: { x: 96, y: 54, width: 1728, height: 972 } },
};

/** The Canvas `plan` is drawn on; while there is no plan, `aspect`'s (9:16's when not given). */
export function canvasOf(plan: RenderPlan | null | undefined, aspect?: Aspect): Canvas {
  if (!plan) return aspect ? CANVASES[aspect] : PORTRAIT;
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
