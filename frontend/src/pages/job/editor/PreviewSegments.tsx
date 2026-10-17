import { useEffect, useMemo, useRef } from "react";
import type { AudioEvent, RenderPlan, ScenePlan, SegmentPlan } from "../../../api";
import { BLUR_BRIGHTNESS, BLUR_SIGMA } from "./ClipPreview";
import { follow } from "./follow";
import { FRAME, panelStyle } from "./picture";
import { PicturePanel } from "./PicturePanel";
import { playable, type Playback } from "./playback";
import { loudness } from "./loudness";
import { mediaPlay, useRetimedCopy } from "./retimedCopy";
import { followCurve, setVolume } from "./PreviewMusic";

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
 * own; its sound faded out over `fade` (the Transition taking it away), if any. Its video plays at
 * its Speed, its pitch kept or not (`follow`). It is drawn from its
 * `scene` (ADR 0007): the Background, its blurred cover panel or its colour, then the picture. Outside
 * its span its video waits at its start, so that its first frame is ready. A keyed picture moves
 * with the playback (PicturePanel), and a keyed sound follows its volume Keyframes (followCurve).
 * A reversed one plays its Retimed copy, and shows its first frame held with the copy's progress
 * until the copy is made (`mediaPlay`).
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
  const copy = useRetimedCopy(segment.reverse ? segment.media : null, segment.source_start, segment.source_end);
  const { src, span } = useMemo(() => mediaPlay(segment, end, copy), [segment, end, copy]);

  useEffect(() => {
    // Its sound: its volume Keyframes when keyed, faded out by the Transition taking it away.
    const sound: AudioEvent = {
      media: segment.media!,
      start: segment.start,
      end: fade ? fade.end : segment.end,
      offset: segment.source_start,
      volume: segment.volume,
      fade_in: 0,
      fade_out: fade ? fade.end - fade.start : 0,
      gain: segment.gain,
      id: segment.id,
    };
    const sync = () => {
      const inside = main.current ? follow(main.current, playback, span, true) : false;
      if (back.current) follow(back.current, playback, span, true);
      if (main.current && !segment.silent && segment.gain.length) followCurve(main.current, playback, sound);
      else if (main.current) setVolume(main.current, segment.silent ? 0 : loudness(sound, playback.shownTime));
      if (box.current) box.current.style.visibility = inside ? "visible" : "hidden";
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, segment, end, fade, span]);

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
          playback={playback}
          media={<video ref={main} src={src} playsInline preload="auto" className="size-full object-fill" />}
        />
      )}
      {copy && !copy.url && (
        <div
          aria-live="polite"
          className="absolute inset-x-0 bottom-[8%] mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-white tabular-nums"
          style={{ fontSize: "max(12px, calc(var(--scale) * 36px))" }}
        >
          {copy.error ? "Couldn't reverse this video" : `Reversing… ${Math.round(copy.progress * 100)}%`}
        </div>
      )}
    </div>
  );
}
