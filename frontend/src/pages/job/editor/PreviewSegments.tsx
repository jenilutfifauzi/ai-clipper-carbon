import { useEffect, useRef } from "react";
import { mediaProxyUrl, type RenderPlan, type ScenePlan, type SegmentPlan } from "../../../api";
import { BLUR_BRIGHTNESS, BLUR_SIGMA } from "./ClipPreview";
import { follow } from "./follow";
import { FRAME, panelStyle } from "./picture";
import { PicturePanel } from "./PicturePanel";
import { playable, type Playback } from "./playback";
import { setVolume } from "./PreviewMusic";

/**
 * The plan's Segments of Media Library videos, over the Source's panels while they play: each its
 * video's small copy, in step with the playback, drawn as the Scene the plan gives it (its picture
 * over its Background), its sound at its volume. One that a Transition overlaps with the next gives
 * way where the Transition starts (PreviewTransitions draws the rest of it).
 */
export function PreviewSegments({ plan, playback }: { plan: RenderPlan | null; playback: Playback }) {
  if (!plan || !plan.segments.some((segment) => segment.media)) return null;
  const played = playable(plan.segments);
  return (
    <>
      {plan.segments.map((segment, i) =>
        segment.media ? (
          <MediaSegment key={`${i}:${segment.start}`} segment={segment} end={played[i].end} scene={segmentScene(plan, i)} playback={playback} />
        ) : null,
      )}
    </>
  );
}

// Segment `index`'s (first) Scene.
export function segmentScene(plan: RenderPlan, index: number): ScenePlan | undefined {
  const first = plan.segments.slice(0, index).reduce((count, segment) => count + segment.scenes, 0);
  return plan.scenes[first];
}

/**
 * A video's Segment, shown until `end` (where it gives way), or within a Transition when `end` is its
 * own; its sound faded out over `fade` (the Transition taking it away), if any. It is drawn from its
 * `scene` (ADR 0007): the Background, its blurred cover panel or its colour, then the picture. Outside
 * its span its video waits at its start, so that its first frame is ready.
 */
export function MediaSegment({
  segment,
  end,
  scene,
  playback,
  fade,
}: {
  segment: SegmentPlan;
  end: number;
  scene: ScenePlan | undefined;
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
  const picture = scene?.picture;
  const background = picture && scene.panels[0] ? panelStyle(scene.panels[0], picture.item_size, FRAME) : null;
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" style={{ visibility: "hidden", background: scene?.colour ?? "#000" }}>
      {background && (
        <div className="absolute overflow-hidden" style={background.box}>
          <video
            ref={back}
            src={src}
            muted
            playsInline
            preload="auto"
            className="absolute max-w-none object-fill"
            style={{ ...background.inner, filter: `blur(calc(${BLUR_SIGMA}px * var(--scale))) brightness(${BLUR_BRIGHTNESS})` }}
          />
        </div>
      )}
      {picture && (
        <PicturePanel
          picture={picture}
          frame={FRAME}
          media={<video ref={main} src={src} playsInline preload="auto" className="size-full object-fill" />}
        />
      )}
    </div>
  );
}
