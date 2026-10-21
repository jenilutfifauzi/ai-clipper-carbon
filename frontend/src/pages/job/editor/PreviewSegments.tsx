import { useEffect, useMemo, useRef } from "react";
import type { RenderPlan, RetimedCopy, RetimedRange, ScenePlan, SegmentPlan, TransitionEvent } from "../../../api";
import { BLUR_BRIGHTNESS, BLUR_SIGMA, PanelView } from "./ClipPreview";
import { follow } from "./follow";
import { GradeVignette, useFrameFilter } from "./GradeFilters";
import { FRAME, panelStyle, slotView } from "./picture";
import { PicturePanel } from "./PicturePanel";
import { onOwnVideos, playable, useShown, type Playback } from "./playback";
import { changing, loudness, segmentSound } from "./loudness";
import { copyProgress, mediaPlay, segmentCopy, sourcePlay, useRetimedCopies, useRetimedCopy } from "./retimedCopy";
import { followCurve, setVolume } from "./PreviewMusic";
import { firstSceneOf, sceneAt } from "./ScenesTrack";
import { crossedBy } from "./transitionSound";
import { silencedForCopy } from "./effectedCopy";

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
  // The Transition that brings Segment `i` in, if any.
  const into = (i: number) => plan.transitions.find((transition) => Math.abs(transition.start - plan.segments[i].start) < 0.01);
  return (
    <>
      {plan.segments.map((segment, i) =>
        segment.media ? (
          <MediaSegment
            key={`${i}:${segment.start}`}
            segment={segment}
            end={played[i].end}
            scene={segmentScene(plan, i)}
            playback={playback}
            into={into(i)}
          />
        ) : onOwnVideos(segment) ? (
          <CopiedSourceSegment
            key={`${i}:${segment.start}`}
            plan={plan}
            index={i}
            end={played[i].end}
            playback={playback}
            src={src}
            jobId={jobId}
            into={into(i)}
          />
        ) : null,
      )}
    </>
  );
}

// Segment `index`'s (first) Scene.
export const segmentScene = (plan: RenderPlan, index: number): ScenePlan | undefined => plan.scenes[firstSceneOf(plan, index)];

/**
 * A video's Segment, shown until `end` (where it gives way), or within a Transition when `end` is its
 * own; its sound brought in by `into` and taken away by `fade` (the Transitions either side), if any,
 * as their sounds say (`crossedVolumes`). Its video plays at
 * its Speed, its pitch kept or not (`follow`). It is drawn from its
 * `scene` (ADR 0007): the Background, its blurred cover panel or its colour, then the picture. Outside
 * its span its video waits at its start, so that its first frame is ready. A keyed picture moves
 * with the playback (PicturePanel), and a keyed or faded sound follows its gain curve (followCurve).
 * A reversed one, or one at a Speed a browser won't play, plays its Retimed copy, and shows its first
 * frame held with the copy's progress until the copy is made (`mediaPlay`).
 */
export function MediaSegment({
  segment,
  end,
  scene,
  playback,
  fade,
  into,
}: {
  segment: SegmentPlan;
  end: number;
  scene: ScenePlan | undefined;
  playback: Playback;
  fade?: TransitionEvent;
  into?: TransitionEvent;
}) {
  const box = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLVideoElement>(null);
  const back = useRef<HTMLVideoElement>(null);
  const range = useMemo(() => segmentCopy(segment), [segment]);
  const copy = useRetimedCopy(segment.media, range);
  const { src, span } = useMemo(() => mediaPlay(segment, end, copy), [segment, end, copy]);

  useEffect(() => {
    // Its sound: its volume Keyframes when keyed, and its fades, brought in by the Transition before it
    // and taken away by the one after it (along their sounds), if any.
    const sound = segmentSound(segment, 1, fade);
    const crossed = crossedBy(into);
    const sync = () => {
      const inside = main.current ? follow(main.current, playback, span, true) : false;
      if (back.current) follow(back.current, playback, span, true);
      // Heard from its Effected copy (PreviewEffected.tsx) instead, while it plays.
      if (main.current && silencedForCopy({ kind: "segment", id: segment.id }, playback)) setVolume(main.current, 0);
      else if (main.current && !segment.silent && changing(sound)) followCurve(main.current, playback, sound, crossed);
      else if (main.current) setVolume(main.current, segment.silent ? 0 : loudness(sound, playback.shownTime, crossed));
      if (box.current) box.current.style.visibility = inside ? "visible" : "hidden";
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, segment, end, fade, into, span]);

  const filter = useFrameFilter(segment.grade, segment.video_effects);
  const picture = scene?.picture;
  const background = picture && scene.panels[0] ? panelStyle(scene.panels[0], picture.item_size, FRAME) : null;
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" style={{ visibility: "hidden" }}>
      {/* Its Grade and Video Effects over its whole frame (ADR 0013, 0014): its Background and its picture, its vignette over them. */}
      <div className="absolute inset-0" style={{ background: scene?.colour ?? "#000", filter }}>
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
      </div>
      <GradeVignette grade={segment.grade} />
      <CopyProgress range={range} copy={copy} what="video" />
    </div>
  );
}

/**
 * Segment `index` of `plan`, of the Source played from a Retimed copy (`segmentCopy`: reversed, or at
 * a Speed a browser won't play), shown until `end`, or within a Transition when `end` is its own, its
 * sound brought in by `into` and taken away by `fade`, as MediaSegment's: its Scenes' panels (a Split's two, a Blur's background and
 * shot, a Manual Scene's picture) drawn as the decks draw them, from a master and a follower of its
 * own playing the copy (`sourcePlay`), at the Clip's own volume times its own (or its Keyframes'),
 * through its fades. Outside its span they wait at its start. Until the copy is made they hold the
 * Source's `src` at the frame the copy shows first, with its progress.
 */
export function CopiedSourceSegment({
  plan,
  index,
  end,
  playback,
  src,
  jobId,
  fade,
  into,
}: {
  plan: RenderPlan;
  index: number;
  end: number;
  playback: Playback;
  src: string;
  jobId: string;
  fade?: TransitionEvent;
  into?: TransitionEvent;
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
    // Its sound: its volume Keyframes when keyed, under the Clip's own, and its fades, brought in by
    // the Transition before it and taken away by the one after it (along their sounds), if any.
    const sound = segmentSound(segment, plan.source_volume, fade);
    const crossed = crossedBy(into);
    const sync = () => {
      const inside = master.current ? follow(master.current, playback, span, true) : false;
      if (follower.current) follow(follower.current, playback, span, true);
      if (master.current && silencedForCopy({ kind: "segment", id: segment.id }, playback)) setVolume(master.current, 0);
      else if (master.current && changing(sound)) followCurve(master.current, playback, sound, crossed);
      else if (master.current) setVolume(master.current, loudness(sound, playback.shownTime, crossed));
      if (box.current) box.current.style.visibility = inside ? "visible" : "hidden";
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, segment, fade, into, span, plan.source_volume]);

  const filter = useFrameFilter(segment.grade, segment.video_effects);
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" style={{ visibility: "hidden" }}>
      {/* Its Grade and Video Effects over its whole frame (ADR 0013, 0014), its vignette over it. */}
      <div className="absolute inset-0 bg-black" style={{ filter }}>
        {[master, follower].map((ref, slot) => (
          <PanelView key={slot} videoRef={ref} src={shown} plan={plan} {...slotView(scene, slot)} playback={playback} muted={slot > 0} />
        ))}
      </div>
      <GradeVignette grade={segment.grade} />
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
