import { useEffect, useMemo, useRef } from "react";
import { mediaItemUrl, mediaProxyUrl, type OverlayEvent, type Picture, type RenderPlan } from "../../../api";
import { cx } from "../../../format";
import { isAnimated, overlayLook, type Look } from "./animation";
import { follow } from "./follow";
import { MaskedImage, MaskedVideo, useImageMatte, useItemMatte } from "./MatteMask";
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
 * Each is in its Grade (ADR 0013) and its Video Effects (ADR 0014), its border and shadow not, and
 * laid by its Blend Mode (ADR 0014) over what is under it.
 * A selected one is shown whole while paused in its time, as a picked Text Layer is, so that it can
 * be seen while it is edited on a frame its animation hasn't reached. Its media element names its
 * Overlay (`data-overlay-media`), for Chroma key's eyedropper to read (EyedropperLayer). With
 * Background removal (ADR 0015), its picture is cut by its item's Matte (MatteMask.tsx) under its
 * Grade, effects, corners, border, shadow and Blend Mode, as the render orders them.
 */
export function PreviewOverlays({
  plan,
  playback,
  selected,
  events = plan?.overlays ?? [],
}: {
  plan: RenderPlan | null;
  playback: Playback;
  selected: string[];
  // The Overlays drawn: by default the plan's over the Main Track (BehindOverlays draws those behind it).
  events?: OverlayEvent[];
}) {
  if (!plan || !events.length) return null;
  return (
    <>
      {events.map((event, i) => (
        <OverlayView key={`${i}:${event.media}`} plan={plan} event={event} picture={event.picture} playback={playback} selected={selected.includes(event.id)} />
      ))}
    </>
  );
}

/**
 * The plan's Overlays Behind the Main Track (ADR 0015), drawn as PreviewOverlays draws the others, in
 * the Clip's time, over a Segment's Background and under its picture: where it is cut out (inside
 * MaskGroup, `className` showing them only with the cut), or where its picture doesn't cover the frame.
 * None without any (or while the Behind Track is hidden, which leaves them out of the plan).
 */
export function BehindOverlays({ plan, playback, className }: { plan: RenderPlan; playback: Playback; className?: string }) {
  if (!plan.behind?.length) return null;
  return (
    <div aria-hidden className={cx("absolute inset-0 overflow-hidden", className)}>
      <PreviewOverlays plan={plan} playback={playback} selected={[]} events={plan.behind} />
    </div>
  );
}

/**
 * Whether a Scene's one picture (a Manual Scene's, a video's) covers the frame, hiding its Background
 * and the Behind Overlays: opaque, unturned and unkeyed, and over the whole frame, as the render's `_covers`.
 */
export function coversFrame(picture: Picture | null | undefined, frame: { width: number; height: number }): boolean {
  if (!picture || picture.opacity < 1 || picture.rotation % 360 || Object.keys(picture.motion ?? {}).length) return false;
  const [x, y] = picture.centre;
  const reach = 0.5;
  return (
    x - picture.width / 2 <= reach &&
    y - picture.height / 2 <= reach &&
    x + picture.width / 2 >= frame.width - reach &&
    y + picture.height / 2 >= frame.height - reach
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
  // Its range of its item (its copy's, when it plays one), which its Matte follows (ADR 0015).
  const played = useMemo(
    () => ({ start: range?.start ?? offset, end: range?.end ?? offset + (end - start) * (speed ?? 1), speed, reverse }),
    [range, offset, start, end, speed, reverse],
  );
  const removal = event.background_removal;
  const matte = useItemMatte(image ? null : media, removal, played, range, copy, video);
  const imageMatte = useImageMatte(media, image ? removal : null);
  const feather = removal?.feather ?? 0;
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
        effects={event.video_effects}
        blend={event.blend}
        start={start}
        media={
          image ? (
            <MaskedImage src={mediaItemUrl(media)} matte={imageMatte} feather={feather}>
              <img src={mediaItemUrl(media)} alt="" draggable={false} className="size-full object-fill" data-overlay-media={event.id} />
            </MaskedImage>
          ) : (
            <MaskedVideo matte={matte} feather={feather} videoRef={video} playback={playback}>
              <video ref={video} src={src} muted playsInline preload="auto" className="size-full object-fill" data-overlay-media={event.id} />
            </MaskedVideo>
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
