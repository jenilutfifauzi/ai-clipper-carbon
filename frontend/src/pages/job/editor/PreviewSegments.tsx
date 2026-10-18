import { useEffect, useMemo, useRef } from "react";
import type { AudioEvent, RenderPlan, RetimedCopy, RetimedRange, ScenePlan, SegmentPlan } from "../../../api";
import { BLUR_BRIGHTNESS, BLUR_SIGMA, PanelView } from "./ClipPreview";
import { follow } from "./follow";
import { FRAME, panelStyle, slotView } from "./picture";
import { PicturePanel } from "./PicturePanel";
import { onOwnVideos, playable, useShown, type Playback } from "./playback";
import { loudness } from "./loudness";
import { copyProgress, mediaPlay, segmentCopy, sourcePlay, useRetimedCopies, useRetimedCopy } from "./retimedCopy";
import { followCurve, setVolume } from "./PreviewMusic";
import { firstSceneOf, sceneAt } from "./ScenesTrack";

/**
 * The plan's Segments on videos of their own (`onOwnVideos`), over the Source's panels while they
 * play, in step with the playback: a Media Library video's, its video's small copy drawn as the Scene
 * the plan gives it (its picture over its Background), its sound at its volume; and one of the Source
 * played from a Retimed copy (reversed, or at a Speed a browser won't play), its Scenes drawn from the
 * copy (of the Source `src`, the decks' video, of Job `jobId`). One that a Transition overlaps with
 * the next gives way where the Transition starts (PreviewTransitions draws the rest of it).
 */
export function PreviewSegments({ plan, playback, src, jobId }: { plan: RenderPlan | null; playback: Playback; src: string; jobId: string }) {
  if (!plan || !plan.segments.some(onOwnVideos)) return null;
  const played = playable(plan.segments);
  return (
    <>
      {plan.segments.map((segment, i) =>
        segment.media ? (
          <MediaSegment key={`${i}:${segment.start}`} segment={segment} end={played[i].end} scene={segmentScene(plan, i)} playback={playback} />
        ) : onOwnVideos(segment) ? (
          <CopiedSourceSegment key={`${i}:${segment.start}`} plan={plan} index={i} end={played[i].end} playback={playback} src={src} jobId={jobId} />
        ) : null,
      )}
    </>
  );
}

// Segment `index`'s (first) Scene.
export const segmentScene = (plan: RenderPlan, index: number): ScenePlan | undefined => plan.scenes[firstSceneOf(plan, index)];

/**
 * A video's Segment, shown until `end` (where it gives way), or within a Transition when `end` is its
 * own; its sound faded out over `fade` (the Transition taking it away), if any. Its video plays at
 * its Speed, its pitch kept or not (`follow`). It is drawn from its
 * `scene` (ADR 0007): the Background, its blurred cover panel or its colour, then the picture. Outside
 * its span its video waits at its start, so that its first frame is ready. A keyed picture moves
 * with the playback (PicturePanel), and a keyed sound follows its volume Keyframes (followCurve).
 * A reversed one, or one at a Speed a browser won't play, plays its Retimed copy, and shows its first
 * frame held with the copy's progress until the copy is made (`mediaPlay`).
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
  const range = useMemo(() => segmentCopy(segment), [segment]);
  const copy = useRetimedCopy(segment.media, range);
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
      muted: segment.muted,
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
      <CopyProgress range={range} copy={copy} what="video" />
    </div>
  );
}

/**
 * Segment `index` of `plan`, of the Source played from a Retimed copy (`segmentCopy`: reversed, or at
 * a Speed a browser won't play), shown until `end`, or within a Transition when `end` is its own, its
 * sound faded out over `fade`, if any: its Scenes' panels (a Split's two, a Blur's background and
 * shot, a Manual Scene's picture) drawn as the decks draw them, from a master and a follower of its
 * own playing the copy (`sourcePlay`), at the Clip's own volume times its own. Outside its span they
 * wait at its start. Until the copy is made they hold the Source's `src` at the frame the copy shows
 * first, with its progress.
 */
export function CopiedSourceSegment({
  plan,
  index,
  end,
  playback,
  src,
  jobId,
  fade,
}: {
  plan: RenderPlan;
  index: number;
  end: number;
  playback: Playback;
  src: string;
  jobId: string;
  fade?: { start: number; end: number };
}) {
  const segment = plan.segments[index];
  const box = useRef<HTMLDivElement>(null);
  const master = useRef<HTMLVideoElement>(null);
  const follower = useRef<HTMLVideoElement>(null);
  // It plays from a copy: that is why it is drawn here.
  const range = useMemo(() => segmentCopy(segment)!, [segment]);
  const [copy] = useRetimedCopies([{ job: jobId, range }]);
  const frame = 1 / (plan.fps > 0 ? plan.fps : 30);
  const { src: shown, span } = useMemo(() => sourcePlay(segment, end, range, copy, src, frame), [segment, end, range, copy, src, frame]);
  const sceneIndex = useShown(playback, (time) => sceneAt(plan, time, index));
  const scene = plan.scenes[sceneIndex];

  useEffect(() => {
    const sound: AudioEvent = {
      media: "",
      start: segment.start,
      end: fade ? fade.end : segment.end,
      offset: segment.source_start,
      volume: plan.source_volume * segment.volume,
      fade_in: 0,
      fade_out: fade ? fade.end - fade.start : 0,
      gain: [],
      id: segment.id,
      muted: segment.muted,
    };
    const sync = () => {
      const inside = master.current ? follow(master.current, playback, span, true) : false;
      if (follower.current) follow(follower.current, playback, span, true);
      if (master.current) setVolume(master.current, loudness(sound, playback.shownTime));
      if (box.current) box.current.style.visibility = inside ? "visible" : "hidden";
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, segment, fade, span, plan.source_volume]);

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden bg-black" style={{ visibility: "hidden" }}>
      {[master, follower].map((ref, slot) => (
        <PanelView key={slot} videoRef={ref} src={shown} plan={plan} {...slotView(scene, slot)} playback={playback} muted={slot > 0} />
      ))}
      <CopyProgress range={range} copy={copy} what="Segment" />
    </div>
  );
}

// A Retimed copy's progress while it is made, or why it couldn't be (`copyProgress`).
function CopyProgress({ range, copy, what }: { range: RetimedRange | null; copy: RetimedCopy | null; what: string }) {
  if (!range || !copy || copy.url) return null;
  return (
    <div
      aria-live="polite"
      className="absolute inset-x-0 bottom-[8%] mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-white tabular-nums"
      style={{ fontSize: "max(12px, calc(var(--scale) * 36px))" }}
    >
      {copyProgress(range, copy, what)}
    </div>
  );
}
