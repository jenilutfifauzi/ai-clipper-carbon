import { useEffect, useMemo, useRef } from "react";
import type { RenderPlan, TransitionEvent, TransitionKind } from "../../../api";
import { PanelView } from "./ClipPreview";
import { MAX_DRIFT_SECS } from "./follow";
import { slotView } from "./picture";
import { onOwnVideos, Playback, usePlayback, useShown } from "./playback";
import { setVolume } from "./PreviewMusic";
import { MediaSegment, ReversedSourceSegment, segmentScene } from "./PreviewSegments";
import { sceneAt } from "./ScenesTrack";

// The Segment a Transition takes away is made ready this long before the Transition starts.
const READY_SECS = 2;

/**
 * The plan's Transitions, imitated: the preview's main playback goes on into the next Segment where
 * a Transition starts (playback.ts's `playable`), and over it the Segment before keeps playing on
 * a playback of its own (its "ghost": its panels, or its own videos), taken away as the Transition's kind
 * does it, its sound fading out, over exactly the Transition's time. Near xfade's look and
 * acrossfade's sound, not the same.
 */
export function PreviewTransitions({ plan, playback, src, jobId }: { plan: RenderPlan | null; playback: Playback; src: string; jobId: string }) {
  const transitions = plan?.transitions ?? [];
  const near = useShown(playback, (time) => transitions.findIndex((t) => time >= t.start - READY_SECS && time < t.end));
  if (!plan || near === -1) return null;
  const transition = transitions[near];
  // The Segment it takes away: the one it ends, which started before it.
  const index = plan.segments.findIndex((segment) => segment.start < transition.start && Math.abs(segment.end - transition.end) < 0.01);
  if (index === -1) return null;
  return <Ghost key={`${near}:${transition.start}`} plan={plan} transition={transition} index={index} playback={playback} src={src} jobId={jobId} />;
}

function Ghost({
  plan,
  transition,
  index,
  playback,
  src,
  jobId,
}: {
  plan: RenderPlan;
  transition: TransitionEvent;
  index: number;
  playback: Playback;
  src: string;
  jobId: string;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const master = useRef<HTMLVideoElement>(null);
  const follower = useRef<HTMLVideoElement>(null);
  const segment = plan.segments[index];
  const ghost = useMemo(() => new Playback(), []);
  ghost.setSegments([{ ...segment, media: segment.media ?? null }]);
  const sceneIndex = usePlayback(ghost, (time) => sceneAt(plan, time, index));
  const scene = plan.scenes[sceneIndex];
  const own = onOwnVideos(segment);

  useEffect(() => {
    if (own) return;
    ghost.attachDeck(0, master.current);
    return () => ghost.attachDeck(0, null);
  }, [ghost, own]);

  useEffect(() => {
    const sync = () => {
      const time = playback.shownTime;
      const inside = time >= transition.start && time < transition.end;
      const share = (time - transition.start) / (transition.end - transition.start);
      if (layer.current && veil.current) {
        layer.current.style.visibility = inside ? "visible" : "hidden";
        if (inside) look(transition.kind, share, layer.current, veil.current);
        else veil.current.style.opacity = "0";
      }
      if (own) return;
      // The ghost plays at the main playback's rate, and its deck its Segment at its Speed.
      ghost.setRate(playback.rate);
      const video = master.current;
      if (video) setVolume(video, inside ? (1 - share) * (plan.source_volume * segment.volume) : 0);
      if (!inside) {
        if (ghost.playing) ghost.pause();
        // Ready on the Transition's first frame.
        if (time < transition.start && Math.abs(ghost.time - transition.start) > MAX_DRIFT_SECS) ghost.seek(transition.start);
        return;
      }
      if (Math.abs(ghost.time - time) > MAX_DRIFT_SECS) ghost.seek(time);
      if (playback.playing && !ghost.playing) ghost.play();
      if (!playback.playing && ghost.playing) ghost.pause();
      const other = follower.current;
      if (video && other) {
        if (other.playbackRate !== video.playbackRate) other.playbackRate = video.playbackRate;
        if (other.preservesPitch !== video.preservesPitch) other.preservesPitch = video.preservesPitch;
        if (Math.abs(other.currentTime - video.currentTime) > MAX_DRIFT_SECS) other.currentTime = video.currentTime;
        if (video.paused !== other.paused) {
          if (video.paused) other.pause();
          else void other.play().catch(() => {});
        }
      }
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, ghost, transition, segment, own, plan.source_volume]);

  return (
    <>
      <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ visibility: "hidden" }}>
        {segment.media ? (
          <MediaSegment segment={segment} end={segment.end} scene={segmentScene(plan, index)} playback={playback} fade={transition} />
        ) : own ? (
          <ReversedSourceSegment plan={plan} index={index} end={segment.end} playback={playback} src={src} jobId={jobId} fade={transition} />
        ) : (
          [master, follower].map((ref, slot) => (
            <PanelView key={slot} videoRef={ref} src={src} plan={plan} {...slotView(scene, slot)} playback={ghost} muted={slot > 0} />
          ))
        )}
      </div>
      <div ref={veil} aria-hidden className="pointer-events-none absolute inset-0" style={{ opacity: 0 }} />
    </>
  );
}

// The Segment taken away (and, for a dip, a veil of black or white) `share` of the way through `kind`.
function look(kind: TransitionKind, share: number, layer: HTMLDivElement, veil: HTMLDivElement) {
  const p = Math.min(1, Math.max(0, share));
  const style = layer.style;
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
