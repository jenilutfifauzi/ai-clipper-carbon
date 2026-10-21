import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { RenderPlan, TransitionEvent } from "../../../api";
import { PanelView } from "./ClipPreview";
import { DecksGraded } from "./GradeFilters";
import { MAX_DRIFT_SECS } from "./follow";
import { slotView } from "./picture";
import { onOwnVideos, Playback, usePlayback, useShown } from "./playback";
import { loudness, segmentSound } from "./loudness";
import { setVolume } from "./PreviewMusic";
import { silencedForCopy } from "./effectedCopy";
import { MediaSegment, CopiedSourceSegment, segmentScene } from "./PreviewSegments";
import { sceneAt } from "./ScenesTrack";
import { TransitionFilters } from "./TransitionFilters";
import { showLook, TRANSITIONS, type TransitionLook } from "./transitions";

// The Segment a Transition takes away is made ready this long before the Transition starts.
const READY_SECS = 2;
// Outside a Transition: each layer as it is.
const UNSTYLED: TransitionLook = { outgoing: {}, incoming: {}, veil: {} };

/**
 * The plan's Transitions, imitated: the preview's main playback goes on into the next Segment where
 * a Transition starts (playback.ts's `playable`), and over it the Segment before keeps playing on
 * a playback of its own (its "ghost": its panels, or its own videos), over exactly the Transition's
 * time. The kind's look (transitions.ts) styles the ghost, the `incoming` Segments' picture layer
 * under it and a veil over both; the ghost's sound (times its own fades) gives way to the incoming
 * one's along the Transition's sound (transitionSound.ts, the incoming side's in PreviewMusic and
 * PreviewSegments). Near the render's look, not the same.
 */
export function PreviewTransitions({
  plan,
  playback,
  src,
  jobId,
  incoming,
}: {
  plan: RenderPlan | null;
  playback: Playback;
  src: string;
  jobId: string;
  // The Segments' picture layer: never the Overlays, captions, Picture layers, hook or Watermark over it.
  incoming: RefObject<HTMLDivElement>;
}) {
  const transitions = plan?.transitions ?? [];
  const near = useShown(playback, (time) => transitions.findIndex((t) => time >= t.start - READY_SECS && time < t.end));
  if (!plan || near === -1) return null;
  const transition = transitions[near];
  // The Segment it takes away: the one it ends, which started before it.
  const index = plan.segments.findIndex((segment) => segment.start < transition.start && Math.abs(segment.end - transition.end) < 0.01);
  if (index === -1) return null;
  return (
    <Ghost
      key={`${near}:${transition.start}`}
      plan={plan}
      transition={transition}
      index={index}
      playback={playback}
      src={src}
      jobId={jobId}
      incoming={incoming}
    />
  );
}

function Ghost({
  plan,
  transition,
  index,
  playback,
  src,
  jobId,
  incoming,
}: {
  plan: RenderPlan;
  transition: TransitionEvent;
  index: number;
  playback: Playback;
  src: string;
  jobId: string;
  incoming: RefObject<HTMLDivElement>;
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
      // By its knobs, which the event carries.
      const look = inside ? TRANSITIONS[transition.kind].look(Math.min(1, Math.max(0, share)), transition) : UNSTYLED;
      if (layer.current) {
        layer.current.style.visibility = inside ? "visible" : "hidden";
        showLook(look.outgoing, layer.current);
      }
      if (incoming.current) showLook(look.incoming, incoming.current);
      if (veil.current) showLook(look.veil, veil.current);
      if (own) return;
      // The ghost plays at the main playback's rate, and its deck its Segment at its Speed.
      ghost.setRate(playback.rate);
      const video = master.current;
      // Its sound (its Keyframes when keyed) through its fades, giving way along the Transition's sound.
      // Unless it is heard from its Effected copy (PreviewEffected.tsx), over the overlap too.
      const copied = silencedForCopy({ kind: "segment", id: segment.id }, playback);
      if (video) setVolume(video, inside && !copied ? loudness(segmentSound(segment, plan.source_volume, transition), time) : 0);
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
    const unsubscribe = playback.subscribe(sync);
    const picture = incoming.current;
    return () => {
      unsubscribe();
      // The Segments' picture as it is again once the Transition is gone.
      if (picture) showLook({}, picture);
    };
  }, [playback, ghost, transition, segment, own, plan.source_volume, incoming]);

  return (
    <>
      <TransitionFilters />
      <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ visibility: "hidden" }}>
        {segment.media ? (
          <MediaSegment segment={segment} end={segment.end} scene={segmentScene(plan, index)} playback={playback} fade={transition} />
        ) : own ? (
          <CopiedSourceSegment plan={plan} index={index} end={segment.end} playback={playback} src={src} jobId={jobId} fade={transition} />
        ) : (
          // In its Segment's Grade and Video Effects, as the decks draw it (MediaSegment and CopiedSourceSegment draw their own).
          <DecksGraded grade={segment.grade} effects={segment.video_effects} start={segment.start}>
            {[master, follower].map((ref, slot) => (
              <PanelView key={slot} videoRef={ref} src={src} plan={plan} {...slotView(scene, slot)} playback={ghost} muted={slot > 0} />
            ))}
          </DecksGraded>
        )}
      </div>
      <div ref={veil} aria-hidden className="pointer-events-none absolute inset-0" style={{ opacity: 0 }} />
    </>
  );
}
