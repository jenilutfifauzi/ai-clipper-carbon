import { useEffect, useMemo, useRef } from "react";
import { mediaItemUrl, mediaProxyUrl, type OverlayEvent, type Picture, type RenderPlan } from "../../../api";
import { isAnimated, overlayLook, type Look } from "./animation";
import { follow } from "./follow";
import { PicturePanel } from "./PicturePanel";
import { useShown, type Playback } from "./playback";
import { copyProgress, eventCopy, eventPlay, useRetimedCopy } from "./retimedCopy";

/**
 * The plan's Overlays while they show, over the Source's (and videos') pictures and under the
 * captions, each drawn as its Picture: an image, or a video's small copy playing in step with the
 * playback at its Speed (muted: its sound, when turned up, plays with the music); in Reverse or at
 * a Speed a browser won't play, from a Retimed copy (retimedCopy.ts). The `selected` ones (picked in
 * the Advanced Edit, whose stage picks, moves and transforms them: StageEdit.tsx) show faintly
 * outside their time too. A keyed one moves with the playback (PicturePanel), and so does one coming
 * on or going off as a picture layer does (its picture only: a video's sound is left to its volume).
 * Each is in its Grade (ADR 0013), its border and shadow not.
 * A selected one is shown whole while paused in its time, as a picked Text Layer is, so that it can
 * be seen while it is edited on a frame its animation hasn't reached.
 */
export function PreviewOverlays({ plan, playback, selected }: { plan: RenderPlan | null; playback: Playback; selected: string[] }) {
  if (!plan || !plan.overlays.length) return null;
  return (
    <>
      {plan.overlays.map((event, i) => (
        <OverlayView key={`${i}:${event.media}`} plan={plan} event={event} picture={event.picture} playback={playback} selected={selected.includes(event.id)} />
      ))}
    </>
  );
}

// Neither faded, scaled nor moved by an animation.
const WHOLE: Look = [1, 1, 0];

/** One Overlay drawn as `picture`, shown while the Clip's time is in it. */
function OverlayView({
  plan,
  event,
  picture,
  playback,
  selected,
}: {
  plan: RenderPlan;
  event: OverlayEvent;
  picture: Picture;
  playback: Playback;
  // Selected, it is shown faintly outside its time too, to be placed.
  selected: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const shown = useShown(playback, (time) => time >= event.start && time < event.end);

  // By its times, not the event: one is made afresh while it is held on the stage.
  const { start, end, offset, speed, pitch, reverse, media, image, animation_in, animation_out, animation_ms } = event;
  const look = useMemo(() => {
    const animated = { start, end, animation_in, animation_out, animation_ms };
    if (!isAnimated(animated)) return undefined;
    return (time: number): Look => {
      if (selected && !playback.playing && start <= time && time < end) return WHOLE;
      return overlayLook(animated, time) ?? WHOLE;
    };
  }, [animation_in, animation_out, animation_ms, start, end, selected, playback]);
  const range = useMemo(
    () => (image ? null : eventCopy({ start, end, offset, speed, pitch, reverse })),
    [image, start, end, offset, speed, pitch, reverse],
  );
  const copy = useRetimedCopy(media, range);
  const { src, span } = useMemo(
    () => eventPlay({ start, end, offset, speed, pitch, reverse }, mediaProxyUrl(media), copy),
    [start, end, offset, speed, pitch, reverse, media, copy],
  );
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => void follow(element, playback, span);
    sync();
    return playback.subscribe(sync);
  }, [playback, span]);

  return (
    <>
      <PicturePanel
        picture={picture}
        frame={plan}
        playback={playback}
        hidden={!shown && !selected}
        faded={shown ? undefined : 0.25}
        look={look}
        grade={event.grade}
        media={
          image ? (
            <img src={mediaItemUrl(media)} alt="" draggable={false} className="size-full object-fill" />
          ) : (
            <video ref={video} src={src} muted playsInline preload="auto" className="size-full object-fill" />
          )
        }
      />
      {shown && range && copy && !copy.url && (
        <div
          aria-live="polite"
          className="absolute inset-x-0 top-[8%] mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-white tabular-nums"
          style={{ fontSize: "max(12px, calc(var(--scale) * 36px))" }}
        >
          {copyProgress(range, copy)}
        </div>
      )}
    </>
  );
}
