import { useEffect, useRef } from "react";
import { mediaProxyUrl, type RenderPlan, type SegmentPlan } from "../../../api";
import { follow } from "./follow";
import { playable, type Playback } from "./playback";
import { setVolume } from "./PreviewMusic";

/**
 * The plan's Segments of Media Library videos, over the Source's panels while they play: each its
 * video's small copy, in step with the playback, filling the frame (Fill) or whole over a blurred
 * copy of itself (Blur), as the Scene the plan gives it says, its sound at its volume. One that a
 * Transition overlaps with the next gives way where the Transition starts (PreviewTransitions draws
 * the rest of it).
 */
export function PreviewSegments({ plan, playback }: { plan: RenderPlan | null; playback: Playback }) {
  if (!plan || !plan.segments.some((segment) => segment.media)) return null;
  const played = playable(plan.segments);
  return (
    <>
      {plan.segments.map((segment, i) =>
        segment.media ? (
          <MediaSegment key={`${i}:${segment.start}`} segment={segment} end={played[i].end} fill={sceneLayout(plan, i) === "fill"} playback={playback} />
        ) : null,
      )}
    </>
  );
}

// The layout of Segment `index`'s (first) Scene.
export function sceneLayout(plan: RenderPlan, index: number) {
  const first = plan.segments.slice(0, index).reduce((count, segment) => count + segment.scenes, 0);
  return plan.scenes[first]?.layout;
}

/**
 * A video's Segment, shown until `end` (where it gives way), or within a Transition when `end` is its
 * own; its sound faded out over `fade` (the Transition taking it away), if any. Outside its span its
 * video waits at its start, so that its first frame is ready.
 */
export function MediaSegment({
  segment,
  end,
  fill,
  playback,
  fade,
}: {
  segment: SegmentPlan;
  end: number;
  fill: boolean;
  playback: Playback;
  fade?: { start: number; end: number };
}) {
  const box = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLVideoElement>(null);
  const back = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const span = { start: segment.start, end, from: segment.source_start };
    const sync = () => {
      const inside = main.current ? follow(main.current, playback, span, true) : false;
      if (back.current) follow(back.current, playback, span, true);
      const left = fade ? Math.min(1, Math.max(0, (fade.end - playback.shownTime) / (fade.end - fade.start))) : 1;
      if (main.current) setVolume(main.current, segment.silent ? 0 : segment.volume * left);
      if (box.current) box.current.style.visibility = inside ? "visible" : "hidden";
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, segment, end, fade]);

  const src = mediaProxyUrl(segment.media!);
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden bg-black" style={{ visibility: "hidden" }}>
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
