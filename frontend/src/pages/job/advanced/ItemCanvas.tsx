import { useEffect, useLayoutEffect, useRef } from "react";
import { cx } from "../../../format";
import type { TimelineView } from "./AdvancedTimeline";
import type { MediaCache } from "./mediaCache";
import { canvasWindow, type Span } from "./timelineView";

/** What a layer of an item's canvas is given to draw with. */
export interface CanvasArea {
  // Drawing in CSS pixels from the item's left edge, from the top of the canvas.
  ctx: CanvasRenderingContext2D;
  // The stretch of the item the canvas covers, and its part on screen (empty when it is off
  // screen), in those pixels; the item's width, and the canvas's height.
  span: Span;
  view: Span;
  width: number;
  height: number;
  // Device pixels to a CSS pixel, the Timeline's pixels a second, and the frame's time.
  dpr: number;
  pps: number;
  now: number;
  // What the cache is told about whether a chunk at `url` is still wanted when its turn comes: as
  // long as this canvas's last drawing asked for it.
  want: (url: string) => () => boolean;
}

/** A layer of an item's canvas, such as its Filmstrip; true while it still changes (a chunk fading in). */
export type Layer = (area: CanvasArea) => boolean;

/**
 * An item's canvas on the Timeline, windowed: it covers the item's visible part and half a viewport
 * on each side, and its `layers` draw on it in turn. It is drawn again in an animation frame when the
 * Timeline scrolls or zooms, the item changes (a render), or a chunk arrives in `cache`. It sits in
 * the item, from `left` (in the Timeline's pixels from 0 s), `width` pixels wide.
 */
export function ItemCanvas({
  view,
  cache,
  left,
  width,
  pps,
  layers,
  className,
}: {
  view: TimelineView;
  cache: MediaCache;
  left: number;
  width: number;
  pps: number;
  layers: Layer[];
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ left, width, pps, layers });
  latest.current = { left, width, pps, layers };
  const schedule = useRef(() => {});

  useEffect(() => {
    let frame = 0;
    let live = true;
    // The chunks the last drawing asked for.
    let wanted = new Set<string>();
    const draw = () => {
      frame = 0;
      const node = canvas.current;
      if (!node) return;
      const { left, width, pps, layers } = latest.current;
      const dpr = window.devicePixelRatio || 1;
      const visible = view.visible();
      const span = canvasWindow({ left, width }, visible, dpr);
      if (!span) {
        node.width = 0;
        node.style.width = "0px";
        wanted = new Set();
        return;
      }
      const height = node.clientHeight;
      const cssWidth = span.right - span.left;
      const pixels = { width: Math.round(cssWidth * dpr), height: Math.round(height * dpr) };
      if (node.width !== pixels.width) node.width = pixels.width;
      if (node.height !== pixels.height) node.height = pixels.height;
      node.style.left = `${span.left}px`;
      node.style.width = `${cssWidth}px`;
      const ctx = node.getContext("2d");
      if (!ctx || !pixels.width || !pixels.height) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pixels.width, pixels.height);
      const scale = pixels.width / cssWidth;
      ctx.setTransform(scale, 0, 0, pixels.height / height, -span.left * scale, 0);
      // A chunk asked for may start loading at once.
      const asked = new Set<string>();
      wanted = asked;
      const area: CanvasArea = {
        ctx,
        span,
        view: { left: visible.left - left, right: visible.right - left },
        width,
        height,
        dpr,
        pps,
        now: performance.now(),
        want: (url) => {
          asked.add(url);
          return () => live && wanted.has(url);
        },
      };
      let changing = false;
      for (const layer of layers) changing = layer(area) || changing;
      if (changing) schedule.current();
    };
    schedule.current = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const stopView = view.subscribe(schedule.current);
    const stopCache = cache.subscribe(schedule.current);
    schedule.current();
    return () => {
      live = false;
      stopView();
      stopCache();
      cancelAnimationFrame(frame);
    };
  }, [view, cache]);

  useLayoutEffect(() => schedule.current());

  return <canvas ref={canvas} aria-hidden className={cx("pointer-events-none absolute inset-y-0 left-0 h-full w-0", className)} />;
}
