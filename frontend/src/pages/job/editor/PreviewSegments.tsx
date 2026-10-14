import { useEffect, useRef } from "react";
import { mediaProxyUrl, type RenderPlan, type SegmentPlan } from "../../../api";
import type { Playback } from "./playback";
import { setVolume } from "./PreviewMusic";

// A video further than this from where the Clip's time puts it is moved back in step.
const MAX_DRIFT_SECS = 0.15;

/**
 * The plan's Segments of Media Library videos, over the Source's panels while the Clip's time is in
 * them: each its video's small copy, playing in step with the playback, filling the frame (Fill) or
 * whole over a blurred copy of itself (Blur), as the Scene the plan gives it says, its sound at its
 * volume.
 */
export function PreviewSegments({ plan, playback }: { plan: RenderPlan | null; playback: Playback }) {
  const segments = (plan?.segments ?? []).filter((segment) => segment.media);
  if (!plan || !segments.length) return null;
  return (
    <>
      {segments.map((segment, i) => (
        <MediaSegment
          key={`${i}:${segment.start}`}
          segment={segment}
          fill={plan.scenes.find((scene) => scene.start >= segment.start - 1e-3 && scene.start < segment.end)?.layout === "fill"}
          playback={playback}
        />
      ))}
    </>
  );
}

function MediaSegment({ segment, fill, playback }: { segment: SegmentPlan; fill: boolean; playback: Playback }) {
  const box = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLVideoElement>(null);
  const back = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const sync = () => {
      const time = playback.time;
      const inside = time >= segment.start && time < segment.end;
      if (box.current) box.current.style.visibility = inside ? "visible" : "hidden";
      const want = segment.source_start + (time - segment.start);
      for (const [element, heard] of [
        [main.current, true],
        [back.current, false],
      ] as const) {
        if (!element) continue;
        if (heard) setVolume(element, segment.silent ? 0 : segment.volume);
        if (!inside) {
          if (!element.paused) element.pause();
          continue;
        }
        if (Math.abs(element.currentTime - want) > MAX_DRIFT_SECS) element.currentTime = want;
        if (playback.playing && element.paused) void element.play().catch(() => {});
        if (!playback.playing && !element.paused) element.pause();
      }
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, segment]);

  const src = mediaProxyUrl(segment.media!);
  return (
    <div ref={box} data-picture className="absolute inset-0 overflow-hidden bg-black" style={{ visibility: "hidden" }}>
      {!fill && (
        <video
          ref={back}
          src={src}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 size-full scale-110 object-cover"
          style={{ filter: "blur(calc(40px * var(--scale))) brightness(0.9)" }}
        />
      )}
      <video ref={main} src={src} playsInline preload="auto" className={fill ? "absolute inset-0 size-full object-cover" : "absolute inset-0 size-full object-contain"} />
    </div>
  );
}
