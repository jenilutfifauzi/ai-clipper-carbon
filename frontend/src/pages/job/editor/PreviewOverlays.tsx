import { useEffect, useRef } from "react";
import { mediaItemUrl, mediaProxyUrl, type OverlayEvent, type Picture, type RenderPlan } from "../../../api";
import { follow } from "./follow";
import { PicturePanel } from "./PicturePanel";
import { useShown, type Playback } from "./playback";

/**
 * The plan's Overlays while they show, over the Source's (and videos') pictures and under the
 * captions, each drawn as its Picture: an image, or a video's small copy playing in step with the
 * playback (muted: its sound, when turned up, plays with the music). The `selected` ones (picked in
 * the Advanced Edit, whose stage picks, moves and transforms them: StageEdit.tsx) show faintly
 * outside their time too.
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
  const { start, end, offset } = event;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => void follow(element, playback, { start, end, from: offset });
    sync();
    return playback.subscribe(sync);
  }, [playback, start, end, offset]);

  return (
    <PicturePanel
      picture={picture}
      frame={plan}
      hidden={!shown && !selected}
      faded={shown ? undefined : 0.25}
      media={
        event.image ? (
          <img src={mediaItemUrl(event.media)} alt="" draggable={false} className="size-full object-fill" />
        ) : (
          <video ref={video} src={mediaProxyUrl(event.media)} muted playsInline preload="auto" className="size-full object-fill" />
        )
      }
    />
  );
}
