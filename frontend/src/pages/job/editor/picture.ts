import type { Background, MediaItem, Panel, Picture, RenderPlan, ScenePlan, Transform } from "../../../api";
import { valueAt } from "./keyframes";

/**
 * Pictures as the preview draws them (ADR 0007): a Picture of the plan as CSS, and the fitted-size
 * rule of backend/app/pictures.py and the Transform's limits, which the inspector's Fit and Fill, a
 * new Overlay and the stage's gestures go by. The plan resolves every Picture (ADR 0001); this only
 * turns it into boxes.
 */

// The frame's size, in output pixels.
export const FRAME = { width: 1080, height: 1920 } as const;

// The Transform's limits (backend/app/candidates.py).
export const SCALE_RANGE = [0.05, 8] as const;
export const STRETCH_RANGE = [0.1, 10] as const;

// Every field at its identity: fitted, centred, upright, unflipped and opaque.
export const IDENTITY: Transform = { x: 540, y: 960, scale: 1, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 };

export interface PictureStyle {
  left: string;
  top: string;
  width: string;
  height: string;
  transform: string;
  opacity: number;
  // The media inside the box: its whole item, sized and moved so that only the crop shows in it.
  inner: { left: string; top: string; width: string; height: string };
  // An Overlay's rounded corners (a border-radius in shares of the box), border, and drop shadow
  // (a filter for a box that isn't turned, so that it falls in screen space); undefined without.
  radius?: string;
  border?: string;
  shadow?: string;
}

const percent = (share: number) => `${share * 100}%`;

// Output pixels as stage pixels: `--scale` is the stage's pixels per output pixel (ClipPreview).
const pixels = (value: number) => `calc(${value}px * var(--scale))`;

const rgb = (colour: string, opacity: number) =>
  `rgb(${[1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16)).join(" ")} / ${opacity})`;

/**
 * The CSS of a box drawing `picture` on a stage of the `frame`'s shape: placed at its centre and as
 * large as it is drawn (in shares of the frame, so it may go past its edges), then centred on that
 * point, turned clockwise and flipped. CSS applies a transform's functions right to left, so the
 * flip comes first and the turn after it, in the renderer's order. Inside it, its media is as large
 * as its whole item would be and moved so that its crop fills the box (as `PanelView` shows a
 * Source crop), cut off by the box. Its corners are rounded as many output pixels across as down,
 * and its border and shadow stay as many output pixels whatever its size, as the renderer draws them.
 */
export function pictureStyle(picture: Picture, frame: { width: number; height: number }): PictureStyle {
  const [x, y] = picture.centre;
  const { crop, item_size: [across, down] } = picture;
  const steps = ["translate(-50%, -50%)"];
  if (picture.rotation % 360) steps.push(`rotate(${picture.rotation}deg)`);
  if (picture.flip_h || picture.flip_v) steps.push(`scale(${picture.flip_h ? -1 : 1}, ${picture.flip_v ? -1 : 1})`);
  return {
    left: percent(x / frame.width),
    top: percent(y / frame.height),
    width: percent(picture.width / frame.width),
    height: percent(picture.height / frame.height),
    transform: steps.join(" "),
    opacity: picture.opacity,
    inner: {
      left: percent(-crop.x / crop.width),
      top: percent(-crop.y / crop.height),
      width: percent(across / crop.width),
      height: percent(down / crop.height),
    },
    radius: picture.radius ? `${percent(picture.radius / picture.width)} / ${percent(picture.radius / picture.height)}` : undefined,
    border: picture.border ? `${pixels(picture.border.width)} solid ${picture.border.colour}` : undefined,
    shadow: picture.shadow
      ? `drop-shadow(${[picture.shadow.x, picture.shadow.y, picture.shadow.blur].map(pixels).join(" ")} ${rgb(picture.shadow.colour, picture.shadow.opacity)})`
      : undefined,
  };
}

// Each keyed property's range (backend/app/candidates.py's KEY_RANGES): a sampled value is held to
// it, but a rotation, which may turn any number of times.
const KEY_RANGES = { x: [0, 1080], y: [0, 1920], scale: SCALE_RANGE, opacity: [0, 1] } as const;

/** Whether `picture` moves: it has Keyframes. */
export const isKeyed = (picture: Picture) => !!picture.motion && Object.keys(picture.motion).length > 0;

/**
 * `picture` as drawn at `time` seconds into the Clip (backend/app/planner.py's picture_at, which
 * the renderer draws by): each keyed property sampled from its motion and held to its range, its
 * size its drawn size at scale 1 times the sampled scale (in fractions of a pixel), its corners'
 * radius in step with its shorter side (its border and shadow stay as they are), and its bounds
 * turned about the sampled centre; a still Picture, without motion. An unkeyed picture is itself.
 */
export function pictureAt(picture: Picture, time: number): Picture {
  const motion = picture.motion;
  if (!motion || !isKeyed(picture)) return picture;
  const sampled = (prop: "x" | "y" | "scale" | "rotation" | "opacity", constant: number) => {
    const keys = motion[prop];
    if (!keys?.length) return constant;
    const value = valueAt(keys, time, constant);
    return prop === "rotation" ? value : clamp(value, KEY_RANGES[prop]);
  };
  let [width, height] = [picture.width, picture.height];
  if (motion.scale?.length && picture.unscaled) {
    const scale = sampled("scale", 1);
    [width, height] = [picture.unscaled[0] * scale, picture.unscaled[1] * scale];
  }
  const [x, y] = [sampled("x", picture.centre[0]), sampled("y", picture.centre[1])];
  const rotation = sampled("rotation", picture.rotation);
  const angle = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))];
  const [across, down] = [width * cos + height * sin, width * sin + height * cos];
  const radius = picture.radius ? (picture.radius * Math.min(width, height)) / Math.min(picture.width, picture.height) : 0;
  return {
    ...picture,
    width,
    height,
    radius,
    centre: [x, y],
    rotation,
    opacity: sampled("opacity", picture.opacity),
    bounds: { x: roundHalfEven(x - across / 2), y: roundHalfEven(y - down / 2), width: roundHalfEven(across), height: roundHalfEven(down) },
    motion: {},
  };
}

// Python's round(): a half goes to the even neighbour, so that bounds are the backend's to the pixel.
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** The plan's Overlays as drawn at `time`: each keyed one's picture sampled there (`pictureAt`). */
export function overlaysAt(plan: RenderPlan, time: number): RenderPlan["overlays"] {
  return plan.overlays.map((event) => (isKeyed(event.picture) ? { ...event, picture: pictureAt(event.picture, time) } : event));
}

export interface PanelStyle {
  box: { left: string; top: string; width: string; height: string };
  // Its item inside the box, sized and moved so that only the panel's crop shows in it.
  inner: { left: string; top: string; width: string; height: string };
}

/**
 * The CSS of a still panel of the plan (a Background's blurred cover) cropped from an item `item`
 * pixels large, on a stage of the `frame`'s shape: its area, and its item as large as the crop
 * makes it and moved to the crop's first point, as `PanelView` shows a Source crop.
 */
export function panelStyle(panel: Panel, [across, down]: [number, number], frame: { width: number; height: number }): PanelStyle {
  const { area, crop_width: width, crop_height: height } = panel;
  const point = panel.path[0] ?? { x: 0, y: 0 };
  return {
    box: {
      left: percent(area.x / frame.width),
      top: percent(area.y / frame.height),
      width: percent(area.width / frame.width),
      height: percent(area.height / frame.height),
    },
    inner: { left: percent(-point.x / width), top: percent(-point.y / height), width: percent(across / width), height: percent(down / height) },
  };
}

export interface SlotView {
  panel: Panel | null;
  picture: Picture | null;
  colour: string | null;
}

/**
 * What a deck's video `slot` shows in `scene` (docs/adr/0006): the Scene's panel for the slot; but in
 * a Manual Scene (ADR 0007) the first shows its Background (the blurred cover panel, or its colour)
 * and the second its picture, so that the Source is drawn from the decks as every other Scene is.
 */
export function slotView(scene: ScenePlan | undefined, slot: number): SlotView {
  if (scene?.layout !== "manual") return { panel: scene?.panels[slot] ?? null, picture: null, colour: null };
  return slot === 0 ? { panel: scene.panels[0] ?? null, picture: null, colour: scene.colour } : { panel: null, picture: scene.picture, colour: null };
}

// The Background of the picture itself, blurred (the colour is kept for when it is switched to one).
export const BLURRED: Background = { kind: "blur", colour: "#000000" };

/** The largest size `size` fits in `frame` at, keeping its aspect: a picture's size at scale 1. */
export function fittedSize(size: { width: number; height: number }, frame: { width: number; height: number } = FRAME): { width: number; height: number } {
  const fit = Math.min(frame.width / size.width, frame.height / size.height);
  return { width: size.width * fit, height: size.height * fit };
}

/** The scale at which a `width` x `height` picture covers the frame. */
export function coverScale(width: number, height: number): number {
  return Math.max(FRAME.width / width, FRAME.height / height) / Math.min(FRAME.width / width, FRAME.height / height);
}

/**
 * The scale at which a `width` x `height` picture turned `rotation` degrees covers the frame: Fill.
 * Turned a quarter (or three), its fitted width stands up the frame and its height across it; at
 * any other angle it is the cover scale of the picture unturned.
 */
export function fillScale(width: number, height: number, rotation: number): number {
  if (Math.abs(rotation % 180) !== 90) return coverScale(width, height);
  const fitted = fittedSize({ width, height });
  return Math.max(FRAME.width / fitted.height, FRAME.height / fitted.width);
}

/** The scale that draws a `width` x `height` picture `pixels` wide, within the Transform's range. */
export function scaleForWidth(width: number, height: number, pixels: number): number {
  return clamp(pixels / fittedSize({ width, height }).width, SCALE_RANGE);
}

/** The size of a Media Library item's picture, in pixels; undefined while it isn't known (or it has none). */
export const mediaSize = (item: MediaItem | undefined) => (item?.width && item.height ? { width: item.width, height: item.height } : undefined);

/**
 * Where a new Overlay of an item `size` pixels large is placed, and what its Reset puts it back to:
 * half the frame wide (540 px, at the scale its size gives that) in its upper middle; at half scale
 * while its size isn't known.
 */
export function overlayPlacement(size: { width: number; height: number } | undefined): Transform {
  return { ...IDENTITY, y: 760, scale: size ? Number(scaleForWidth(size.width, size.height, 540).toFixed(4)) : 0.5 };
}

export const clamp = (value: number, [low, high]: readonly [number, number]) => Math.min(Math.max(value, low), high);
