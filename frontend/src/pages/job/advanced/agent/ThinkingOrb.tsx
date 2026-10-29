import { useEffect, useRef } from "react";
import { ORB_SPEED, orbFrame } from "./orb";

// The frame shown, still, to an owner who asked for less motion.
const STILL_T = 0.6;

/**
 * The thinking orb (orb.ts) on a canvas `size` px square, in the app's orange: each dot's opacity
 * follows its depth, the nearest strongest. It turns on requestAnimationFrame while it is on screen
 * and its tab is shown; with prefers-reduced-motion it is one still frame. Decoration: aria-hidden,
 * the status or the button it sits in says what is going on.
 */
export function ThinkingOrb({ size = 20, className }: { size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#ff9f0a";
    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = accent;
      for (const dot of orbFrame(size, t)) {
        ctx.globalAlpha = 0.25 + 0.75 * (1 - dot.ink);
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      draw(STILL_T);
      return;
    }

    let frame = 0;
    let running = false;
    let visible = true;
    const loop = () => {
      draw((performance.now() / 1000) * ORB_SPEED);
      if (running) frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || !visible || document.visibilityState === "hidden") return;
      running = true;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };
    draw((performance.now() / 1000) * ORB_SPEED);
    // Paused off screen (the transcript scrolled) and while the tab is hidden.
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) start();
      else stop();
    });
    observer.observe(canvas);
    const onVisibility = () => (document.visibilityState === "hidden" ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [size]);

  return <canvas ref={ref} aria-hidden className={className} style={{ width: size, height: size, display: "block" }} />;
}
