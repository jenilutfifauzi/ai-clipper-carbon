import type { TransitionKind } from "../../../api";

// The styles a look sets on one layer; those it leaves out are the layer's own.
export interface LayerLook {
  opacity?: number;
  transform?: string;
  clipPath?: string;
  maskImage?: string;
  background?: string;
}

// A Transition `progress` of the way through, as the preview draws it: the outgoing Segment (the
// ghost), the incoming Segment's picture (the Segments' picture layer only, never the Overlays,
// captions, Picture layers, hook or Watermark over it), and a veil over both.
export interface TransitionLook {
  outgoing: LayerLook;
  incoming: LayerLook;
  veil: LayerLook;
}

// The Transitions tab's sections.
export type TransitionGroup = "Basic" | "Slide" | "Wipe" | "Shape" | "Zoom" | "Light" | "Glitch";

const shown = (outgoing: LayerLook, veil: LayerLook = {}): TransitionLook => ({ outgoing, incoming: {}, veil });

// Into the colour over the first half, out of it over the second.
const dip = (background: string) => (p: number) =>
  shown({ opacity: p < 0.5 ? 1 : 0 }, { background, opacity: p < 0.5 ? 2 * p : 2 * (1 - p) });

/**
 * Every Transition kind (docs/adr/0012-transitions-are-recipes-around-one-xfade.md): its name, its
 * section of the Transitions tab, and its look, near what its recipe renders (backend/app/transitions.py)
 * with exact timing. In the Transitions tab's order.
 */
export const TRANSITIONS: Record<TransitionKind, { label: string; group: TransitionGroup; look: (progress: number) => TransitionLook }> = {
  fade: { label: "Fade", group: "Basic", look: (p) => shown({ opacity: 1 - p }) },
  fadeblack: { label: "Dip to black", group: "Basic", look: dip("#000") },
  fadewhite: { label: "Dip to white", group: "Basic", look: dip("#fff") },
  // xfade's slides push the incoming picture in as the outgoing one goes.
  slideleft: { label: "Push left", group: "Slide", look: (p) => shown({ transform: `translateX(${-100 * p}%)` }) },
  slideright: { label: "Push right", group: "Slide", look: (p) => shown({ transform: `translateX(${100 * p}%)` }) },
  slideup: { label: "Push up", group: "Slide", look: (p) => shown({ transform: `translateY(${-100 * p}%)` }) },
  slidedown: { label: "Push down", group: "Slide", look: (p) => shown({ transform: `translateY(${100 * p}%)` }) },
  wipeleft: { label: "Wipe", group: "Wipe", look: (p) => shown({ clipPath: `inset(0 ${100 * p}% 0 0)` }) },
  zoomin: { label: "Zoom in", group: "Zoom", look: (p) => shown({ transform: `scale(${1 + p})`, opacity: 1 - p }) },
  circleopen: {
    label: "Circle open",
    group: "Shape",
    look: (p) => shown({ maskImage: `radial-gradient(circle at center, transparent ${80 * p}%, black ${80 * p}%)` }),
  },
};

export const TRANSITION_KINDS = Object.keys(TRANSITIONS) as TransitionKind[];

// Shows `look` on `layer`, clearing what an earlier look set there and this one doesn't.
export function showLook(look: LayerLook, layer: { style: CSSStyleDeclaration }) {
  const style = layer.style;
  style.opacity = look.opacity === undefined ? "" : String(look.opacity);
  style.transform = look.transform ?? "";
  style.clipPath = look.clipPath ?? "";
  style.maskImage = look.maskImage ?? "";
  style.background = look.background ?? "";
}
