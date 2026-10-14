import { useEffect, useRef } from "react";
import type { RenderPlan, TransitionEvent, TransitionKind } from "../../../api";
import type { Playback } from "./playback";

/**
 * The plan's Transitions, imitated: the preview plays one piece at a time (playback.ts's `playable`),
 * so as playing goes on into a piece a Transition starts, the last picture of the Segment before it
 * (copied from the stage's videos into a canvas) is laid over the next one and taken away as the
 * Transition's kind does it, over exactly its time. The look is near xfade's, not the same: the
 * Segment before is held still.
 */
export function PreviewTransitions({
  plan,
  playback,
  stage,
}: {
  plan: RenderPlan | null;
  playback: Playback;
  stage: React.RefObject<HTMLDivElement | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const transitions = plan?.transitions ?? [];

  useEffect(() => {
    if (!transitions.length) return;
    // The Transition the picture held in the canvas is for.
    let held: TransitionEvent | null = null;
    const handover = playback.onHandover((_, to) => {
      const coming = transitions.find((t) => Math.abs(t.start - to.start) < 0.01);
      if (!coming || !canvas.current) return;
      copy(stage.current, canvas.current);
      held = coming;
    });
    const sync = () => {
      const time = playback.time;
      const element = canvas.current;
      const cover = veil.current;
      if (!element || !cover) return;
      const now = transitions.find((t) => time >= t.start && time < t.end);
      if (!now || held !== now) {
        element.style.visibility = "hidden";
        cover.style.opacity = "0";
        return;
      }
      element.style.visibility = "visible";
      look(now.kind, (time - now.start) / (now.end - now.start), element, cover);
    };
    sync();
    const unsubscribe = playback.subscribe(sync);
    return () => {
      unsubscribe();
      handover();
    };
  }, [playback, stage, transitions]);

  if (!transitions.length) return null;
  return (
    <>
      <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 size-full" style={{ visibility: "hidden" }} />
      <div ref={veil} aria-hidden className="pointer-events-none absolute inset-0" style={{ opacity: 0 }} />
    </>
  );
}

// The stage's pictures (the Source's panels, or a video's Segment), drawn into `canvas` as they are on screen.
function copy(stage: HTMLDivElement | null, canvas: HTMLCanvasElement) {
  if (!stage) return;
  const frame = stage.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(frame.width * ratio);
  canvas.height = Math.round(frame.height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(ratio, ratio);
  context.fillStyle = "#000";
  context.fillRect(0, 0, frame.width, frame.height);
  for (const video of stage.querySelectorAll<HTMLVideoElement>("[data-picture] video")) {
    const holder = video.closest<HTMLElement>("[data-picture]");
    if (!holder || getComputedStyle(holder).visibility === "hidden" || !video.videoWidth) continue;
    const box = (video.parentElement ?? holder).getBoundingClientRect();
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    // Where the picture is drawn in its element, as its object-fit puts it.
    let [x, y, width, height] = [rect.left, rect.top, rect.width, rect.height];
    if (style.objectFit === "cover" || style.objectFit === "contain") {
      const scale = (style.objectFit === "cover" ? Math.max : Math.min)(rect.width / video.videoWidth, rect.height / video.videoHeight);
      width = video.videoWidth * scale;
      height = video.videoHeight * scale;
      x = rect.left + (rect.width - width) / 2;
      y = rect.top + (rect.height - height) / 2;
    }
    context.save();
    context.beginPath();
    context.rect(box.left - frame.left, box.top - frame.top, box.width, box.height);
    context.clip();
    context.filter = style.filter && style.filter !== "none" ? style.filter : "none";
    context.drawImage(video, x - frame.left, y - frame.top, width, height);
    context.restore();
  }
}

// The held picture (and, for a dip, a veil of black or white) `share` of the way through `kind`.
function look(kind: TransitionKind, share: number, canvas: HTMLCanvasElement, veil: HTMLDivElement) {
  const p = Math.min(1, Math.max(0, share));
  const style = canvas.style;
  style.opacity = "1";
  style.transform = "";
  style.clipPath = "";
  style.maskImage = "";
  veil.style.opacity = "0";
  switch (kind) {
    case "fade":
      style.opacity = String(1 - p);
      break;
    case "fadeblack":
    case "fadewhite":
      // Into the colour over the first half, out of it over the second.
      veil.style.background = kind === "fadeblack" ? "#000" : "#fff";
      veil.style.opacity = String(p < 0.5 ? 2 * p : 2 * (1 - p));
      style.opacity = p < 0.5 ? "1" : "0";
      break;
    case "slideleft":
      style.transform = `translateX(${-100 * p}%)`;
      break;
    case "slideright":
      style.transform = `translateX(${100 * p}%)`;
      break;
    case "slideup":
      style.transform = `translateY(${-100 * p}%)`;
      break;
    case "slidedown":
      style.transform = `translateY(${100 * p}%)`;
      break;
    case "wipeleft":
      style.clipPath = `inset(0 ${100 * p}% 0 0)`;
      break;
    case "zoomin":
      style.transform = `scale(${1 + p})`;
      style.opacity = String(1 - p);
      break;
    case "circleopen": {
      const radius = 80 * p;
      style.maskImage = `radial-gradient(circle at center, transparent ${radius}%, black ${radius}%)`;
      break;
    }
  }
}
