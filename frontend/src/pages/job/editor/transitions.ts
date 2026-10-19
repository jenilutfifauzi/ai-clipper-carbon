import type { TransitionKind, TransitionKnobs } from "../../../api";

// The styles a look sets on one layer; those it leaves out are the layer's own.
export interface LayerLook {
  opacity?: number;
  transform?: string;
  clipPath?: string;
  maskImage?: string;
  filter?: string;
  background?: string;
  mixBlendMode?: "screen";
}

// A Transition `progress` of the way through, as the preview draws it: the outgoing Segment (the
// ghost), the incoming Segment's picture (the Segments' picture layer only, never the Overlays,
// captions, Picture layers, hook or Watermark over it) under it, and a veil over both.
export interface TransitionLook {
  outgoing: LayerLook;
  incoming: LayerLook;
  veil: LayerLook;
}

// The Transitions tab's sections, in its order.
export type TransitionGroup = "Basic" | "Slide" | "Wipe" | "Shape" | "Zoom" | "Light" | "Glitch";
export const TRANSITION_GROUPS: TransitionGroup[] = ["Basic", "Slide", "Wipe", "Shape", "Zoom", "Light", "Glitch"];

// Pixelize's SVG filters (TransitionFilters.tsx draws them): the size of each one's blocks, in the
// preview's pixels, from the finest, and the id of the one at a level.
export const PIXELIZE_BLOCKS = [4, 8, 12, 16, 20, 24];
export const pixelizeFilter = (level: number) => `transition-pixelize-${level}`;

// RGB split's SVG filters (TransitionFilters.tsx draws them): one per tenth of strength, each
// moving the red picture left and the blue right by that much of a 27th of the picture's width, as
// the render does.
export const RGBSPLIT_LEVELS = 10;
export const rgbsplitFilter = (level: number) => `transition-rgbsplit-${level}`;

// Whip pan's SVG filters (TransitionFilters.tsx draws them): one per tenth of its blur, each smearing
// a picture across by that much of an eighth of its width, as the render does at most.
export const WHIP_LEVELS = 10;
export const whipFilter = (level: number) => `transition-whip-${level}`;

// A look reads the Transition's knobs (backend/app/transitions.py): those a kind doesn't read are ignored.
type Look = (progress: number, knobs?: TransitionKnobs) => TransitionLook;
type Side = "top" | "right" | "bottom" | "left";

const layers = (outgoing: LayerLook, incoming: LayerLook = {}, veil: LayerLook = {}): TransitionLook => ({ outgoing, incoming, veil });

// How far into the middle a Transition is: 0 at either end, 1 halfway.
const peak = (p: number) => 2 * Math.min(p, 1 - p);

// A clip-path that cuts `share` of a picture away from its `side`.
function cut(side: Side, share: number) {
  const inset = { top: 0, right: 0, bottom: 0, left: 0, [side]: 100 * share };
  return `inset(${inset.top}% ${inset.right}% ${inset.bottom}% ${inset.left}%)`;
}

// A transform that moves a picture `share` of its size off its `side`.
const away = { top: ["Y", -1], right: ["X", 1], bottom: ["Y", 1], left: ["X", -1] } as const;
const off = (side: Side, share: number) => `translate${away[side][0]}(${away[side][1] * 100 * share}%)`;
const opposite = { top: "bottom", right: "left", bottom: "top", left: "right" } as const;

// Into the colour over the first half, out of it over the second.
const dip = (background: string) => (p: number) =>
  layers({ opacity: p < 0.5 ? 1 : 0 }, {}, { background, opacity: p < 0.5 ? 2 * p : 2 * (1 - p) });

// xfade's slides push the incoming picture in from `from` as the outgoing one leaves the other way: both move.
const push =
  (from: Side): Look =>
  (p) =>
    layers({ transform: off(opposite[from], p) }, { transform: off(from, 1 - p) });

// The incoming picture slides in from `from` over the outgoing one, which stays where it is (drawn
// under it as the outgoing one, cut away where the incoming one has come).
const cover =
  (from: Side): Look =>
  (p) =>
    layers({ clipPath: cut(from, p) }, { transform: off(from, 1 - p) });

// The incoming picture uncovered from `from`.
const wipe =
  (from: Side): Look =>
  (p) =>
    layers({ clipPath: cut(from, p) });

// The incoming picture through a slit across the middle along `to`, widening to both edges.
const doors =
  (to: "right" | "bottom"): Look =>
  (p) =>
    layers({
      maskImage: `linear-gradient(to ${to}, black ${50 - 50 * p}%, transparent ${50 - 50 * p}%, transparent ${50 + 50 * p}%, black ${50 + 50 * p}%)`,
    });

// Through black: the outgoing picture closing to nothing in the middle by its first half, the
// incoming one opening from there by its second, each inside `shape` of a share of its size.
const crop =
  (shape: (share: number) => string): Look =>
  (p) =>
    p < 0.5 ? layers({ clipPath: shape(1 - 2 * p) }, { opacity: 0 }) : layers({ opacity: 0 }, { clipPath: shape(2 * p - 1) });

// A circle of `share` of the way to the picture's corners (71% of its diagonal over √2), at its middle.
const circle = (share: number) => `circle(${71 * share}% at 50% 50%)`;

// A mask of noise, opaque but where it is below `share`: more of it clear as `share` grows.
function noise(share: number) {
  const threshold = 0.3 + 0.4 * share;
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='192' height='192'><filter id='n' x='0' y='0' width='1' height='1' color-interpolation-filters='sRGB'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.7' seed='7' stitchTiles='stitch'/>" +
    `<feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 40 0 0 0 ${-40 * threshold}'/></filter>` +
    "<rect width='100%' height='100%' filter='url(#n)'/></svg>";
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Into a grey picture and out of it: both turn grey towards the middle as one gives way to the other.
const grays: Look = (p) =>
  layers({ opacity: 1 - p, filter: `grayscale(${Math.min(1, 2 * p)})` }, { filter: `grayscale(${Math.min(1, 2 - 2 * p)})` });

// A crossfade through `filter` of both pictures, strongest halfway.
const through =
  (filter: (amount: number) => string | undefined): Look =>
  (p) =>
    layers({ opacity: 1 - p, filter: filter(peak(p)) }, { filter: filter(peak(p)) });

// A strength-reading kind's look and its own strength (STRENGTHS in backend/app/transitions.py),
// which `look` is drawn with while the Transition's is unset.
const strong = (own: number, look: (p: number, strength: number) => TransitionLook) => ({
  look: (p: number, knobs?: TransitionKnobs) => look(p, knobs?.strength ?? own),
  strength: own,
});

// Film burn: a warm flash blended over both as they crossfade, as hot as the strength, brightest halfway.
const burn = (p: number, strength: number) =>
  layers(
    { opacity: 1 - p },
    {},
    {
      background: "radial-gradient(circle at 30% 70%, #fff3d6, #ffb060 35%, #c04000 70%, #400000)",
      mixBlendMode: "screen",
      opacity: strength * peak(p),
    },
  );

// Light leak: a warm band across the diagonal, swept from the top left to the bottom right and
// brightest halfway, blended over both as they crossfade.
function leak(p: number, strength: number) {
  const at = -30 + 160 * p;
  return layers(
    { opacity: 1 - p },
    {},
    {
      background: `linear-gradient(135deg, transparent ${at - 40}%, #ffd696 ${at}%, transparent ${at + 40}%)`,
      mixBlendMode: "screen",
      opacity: strength * peak(p),
    },
  );
}

// RGB split: a crossfade with both pictures' red and blue parted by the strength throughout.
function split(p: number, strength: number) {
  const level = Math.round(strength * RGBSPLIT_LEVELS);
  const filter = p > 0 && p < 1 && level ? `url(#${rgbsplitFilter(level)})` : undefined;
  return layers({ opacity: 1 - p, filter }, { filter });
}

// Blur dissolve: a crossfade with both pictures blurred by the strength, most halfway.
const blurred = (p: number, strength: number) => through((amount) => (strength * amount ? `blur(${24 * strength * amount}px)` : undefined))(p);

// Whip pan: a push of both pictures, each smeared across by the strength, most halfway.
const whip = (from: Side) => (p: number, strength: number) => {
  const pushed = push(from)(p);
  const level = Math.round(strength * peak(p) * WHIP_LEVELS);
  if (!level) return pushed;
  const filter = `url(#${whipFilter(level)})`;
  return layers({ ...pushed.outgoing, filter }, { ...pushed.incoming, filter });
};

// Zoom blur: a crossfade with both pictures scaled up about their middles (by up to 60%) and
// blurred, by the strength, most halfway.
function zoomBlur(p: number, strength: number) {
  const amount = strength * peak(p);
  if (!amount) return layers({ opacity: 1 - p });
  const zoomed = { transform: `scale(${1 + 0.6 * amount})`, filter: `blur(${12 * amount}px)` };
  return layers({ opacity: 1 - p, ...zoomed }, zoomed);
}

// Spin: a crossfade with both pictures turned together by the turns (half a turn to two, by the
// strength), easing in and out, the outgoing one from upright and the incoming one to it; and
// shrunk by up to 30% halfway.
function spin(p: number, strength: number) {
  if (p <= 0 || p >= 1) return layers({ opacity: 1 - p });
  const turns = 360 * (0.5 + 1.5 * strength);
  const turned = turns * p * p * (3 - 2 * p);
  const size = `scale(${1 - 0.3 * peak(p)})`;
  const rotate = (angle: number) => `rotate(${Math.round(angle * 100) / 100}deg) ${size}`;
  return layers({ opacity: 1 - p, transform: rotate(turned) }, { transform: rotate(turned - turns) });
}

// Ten slices across, each keeping less of the outgoing picture from its left.
const slices: Look = (p) =>
  layers({ maskImage: `repeating-linear-gradient(to right, black 0%, black ${10 - 10 * p}%, transparent ${10 - 10 * p}%, transparent 10%)` });

// Glitch: Slices of one picture into the other, both torn apart (red one way, blue the other, by up
// to an 18th of the width: RGB split's filters by half as much again) and shaken across, by the strength.
function glitch(p: number, strength: number) {
  const sliced = slices(p);
  const level = Math.min(RGBSPLIT_LEVELS, Math.round(strength * 1.5 * RGBSPLIT_LEVELS));
  if (p <= 0 || p >= 1 || !level) return sliced;
  const torn = { filter: `url(#${rgbsplitFilter(level)})`, transform: `translateX(${Math.round(200 * strength * Math.sin(97 * p)) / 100}%)` };
  return layers({ ...sliced.outgoing, ...torn }, torn);
}

/**
 * Every Transition kind (docs/adr/0012-transitions-are-recipes-around-one-xfade.md): its name, its
 * section of the Transitions tab, and its look, near what its recipe renders (backend/app/transitions.py)
 * with exact timing, and the knobs it reads: `strength`, its own when the Transition's is unset,
 * and `colour`, its own likewise. In the Transitions tab's order.
 */
export const TRANSITIONS: Record<TransitionKind, { label: string; group: TransitionGroup; look: Look; strength?: number; colour?: string }> = {
  fade: { label: "Fade", group: "Basic", look: (p) => layers({ opacity: 1 - p }) },
  fadeblack: { label: "Dip to black", group: "Basic", look: dip("#000") },
  fadewhite: { label: "Dip to white", group: "Basic", look: dip("#fff") },
  fadegrays: { label: "Dip through grey", group: "Basic", look: grays },
  dipcolour: { label: "Dip to colour", group: "Basic", look: (p, knobs) => dip(knobs?.colour ?? "#000000")(p), colour: "#000000" },
  // Clear where a noise is below the progress: at the ends, all or none of it.
  dissolve: { label: "Dissolve", group: "Basic", look: (p) => layers(p <= 0 ? {} : p >= 1 ? { opacity: 0 } : { maskImage: noise(p) }) },
  blurdissolve: { label: "Blur dissolve", group: "Basic", ...strong(0.5, blurred) },
  slideleft: { label: "Push left", group: "Slide", look: push("right") },
  slideright: { label: "Push right", group: "Slide", look: push("left") },
  slideup: { label: "Push up", group: "Slide", look: push("bottom") },
  slidedown: { label: "Push down", group: "Slide", look: push("top") },
  coverleft: { label: "Cover left", group: "Slide", look: cover("right") },
  coverright: { label: "Cover right", group: "Slide", look: cover("left") },
  coverup: { label: "Cover up", group: "Slide", look: cover("bottom") },
  coverdown: { label: "Cover down", group: "Slide", look: cover("top") },
  whipleft: { label: "Whip pan left", group: "Slide", ...strong(0.5, whip("right")) },
  whipright: { label: "Whip pan right", group: "Slide", ...strong(0.5, whip("left")) },
  wipeleft: { label: "Wipe left", group: "Wipe", look: wipe("right") },
  wiperight: { label: "Wipe right", group: "Wipe", look: wipe("left") },
  wipeup: { label: "Wipe up", group: "Wipe", look: wipe("bottom") },
  wipedown: { label: "Wipe down", group: "Wipe", look: wipe("top") },
  // Clockwise from twelve.
  radial: { label: "Clock wipe", group: "Wipe", look: (p) => layers({ maskImage: `conic-gradient(transparent ${360 * p}deg, black ${360 * p}deg)` }) },
  circleopen: {
    label: "Circle open",
    group: "Shape",
    look: (p) => layers({ maskImage: `radial-gradient(circle at center, transparent ${100 * p}%, black ${100 * p}%)` }),
  },
  circleclose: { label: "Circle close", group: "Shape", look: (p) => layers({ clipPath: circle(1 - p) }) },
  circlecrop: { label: "Iris", group: "Shape", look: crop(circle) },
  rectcrop: { label: "Box", group: "Shape", look: crop((share) => `inset(${50 - 50 * share}%)`) },
  vertopen: { label: "Doors vertical", group: "Shape", look: doors("right") },
  horzopen: { label: "Doors horizontal", group: "Shape", look: doors("bottom") },
  zoomin: { label: "Zoom in", group: "Zoom", look: (p) => layers({ transform: `scale(${1 + p})`, opacity: 1 - p }) },
  // The outgoing picture squeezed into a line across the middle (or down it), the incoming one still behind.
  squeezeh: { label: "Squeeze across", group: "Zoom", look: (p) => layers({ transform: `scaleY(${1 - p})` }) },
  squeezev: { label: "Squeeze down", group: "Zoom", look: (p) => layers({ transform: `scaleX(${1 - p})` }) },
  zoomblur: { label: "Zoom blur", group: "Zoom", ...strong(0.5, zoomBlur) },
  spin: { label: "Spin", group: "Zoom", ...strong(1 / 3, spin) },
  filmburn: { label: "Film burn", group: "Light", ...strong(0.6, burn) },
  lightleak: { label: "Light leak", group: "Light", ...strong(0.7, leak) },
  glitch: { label: "Glitch", group: "Glitch", ...strong(0.5, glitch) },
  rgbsplit: { label: "RGB split", group: "Glitch", ...strong(0.5, split) },
  pixelize: {
    label: "Pixelize",
    group: "Glitch",
    look: through((amount) => {
      const level = Math.ceil(amount * PIXELIZE_BLOCKS.length);
      return level ? `url(#${pixelizeFilter(level - 1)})` : undefined;
    }),
  },
  hblur: { label: "Blur", group: "Glitch", look: through((amount) => `blur(${8 * amount}px)`) },
  distance: { label: "Distance", group: "Glitch", look: (p) => layers({ opacity: 1 - p }) },
  hlslice: { label: "Slices", group: "Glitch", look: slices },
};

export const TRANSITION_KINDS = Object.keys(TRANSITIONS) as TransitionKind[];

// Each group with its kinds, in order, any with none yet left out: the Transitions tab's sections and
// the Join Transition's choices.
export const KINDS_BY_GROUP = TRANSITION_GROUPS.map((group) => ({ group, kinds: TRANSITION_KINDS.filter((kind) => TRANSITIONS[kind].group === group) })).filter(
  ({ kinds }) => kinds.length,
);

// Shows `look` on `layer`, clearing what an earlier look set there and this one doesn't.
export function showLook(look: LayerLook, layer: { style: CSSStyleDeclaration }) {
  const style = layer.style;
  style.opacity = look.opacity === undefined ? "" : String(look.opacity);
  style.transform = look.transform ?? "";
  style.clipPath = look.clipPath ?? "";
  style.maskImage = look.maskImage ?? "";
  style.filter = look.filter ?? "";
  style.background = look.background ?? "";
  style.mixBlendMode = look.mixBlendMode ?? "";
}
