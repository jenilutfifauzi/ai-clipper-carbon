import { useEffect, useRef, type PointerEvent } from "react";
import { mediaItemUrl, mediaProxyUrl, type OverlayEvent, type Picture, type RenderPlan, type Transform } from "../../../api";
import { cx } from "../../../format";
import { follow } from "./follow";
import { clamp, FRAME, SCALE_RANGE } from "./picture";
import { PicturePanel } from "./PicturePanel";
import { useShown, type Playback } from "./playback";
import type { Drift } from "./StageEdit";

/** The Advanced Edit's hold on the Overlays in the preview: which are picked, and what a drag does. */
export interface OverlayControls {
  selected: string[];
  // The Overlay's Transform as saved, by its id: what a drag starts from.
  transformOf: (id: string) => Transform | undefined;
  // Picked alone, or (`toggle`: a click with Shift, Cmd or Ctrl) added to the Pick or taken out of it.
  onSelect: (id: string, toggle: boolean) => void;
  // Dragged to centre (x, y) in output pixels, and resized to `scale`; each drag one `group`.
  onPlace: (id: string, place: { x: number; y: number; scale?: number }, group: string) => void;
}

/**
 * Where a dragged Overlay is drawn, in output pixels, until the plan has it there: centred on (x, y),
 * `width` x `height` before it is turned. `from` is the plan's place for it when it was put there
 * (`overlayKey`), and it is held while `dragging` or until a plan with another place comes.
 */
export type OverlayHold = { id: string; x: number; y: number; width: number; height: number; from: string; dragging: boolean };

// A plan's place for an Overlay, as a key: what a held place is kept until.
export const overlayKey = ({ picture }: OverlayEvent) => `${picture.centre.join(",")},${picture.width}`;

// The held place of the Overlay drawn by `event`, if it is still held.
export const heldArea = (hold: OverlayHold | null, id: string, event: OverlayEvent) =>
  hold && hold.id === id && (hold.dragging || hold.from === overlayKey(event)) ? hold : null;

let drags = 0;

/**
 * The plan's Overlays while they show, over the Source's (and videos') pictures and under the
 * captions, each drawn as its Picture: an image, or a video's small copy playing in step with the
 * playback (muted: its sound, when turned up, plays with the music). With `controls`, one is picked
 * by a click (with Shift, Cmd or Ctrl, added to the Pick), dragged to a new place (its centre kept on
 * the frame) and, picked alone, resized about its centre by its corner; it is drawn where it is put
 * (`hold`) until the plan has it there. Picked ones that follow another moved item are drawn as far
 * from their places (`drift`).
 */
export function PreviewOverlays({
  plan,
  playback,
  stage,
  controls,
  picked,
  hold,
  onHold,
  drift,
}: {
  plan: RenderPlan | null;
  playback: Playback;
  stage: React.RefObject<HTMLDivElement | null>;
  controls?: OverlayControls;
  // Everything picked on the stage (Overlays as "overlay:<id>").
  picked: string[];
  hold: OverlayHold | null;
  onHold: (hold: OverlayHold | null) => void;
  drift: Drift | null;
}) {
  const drag = useRef<{
    id: string;
    pointer: number;
    kind: "move" | "size";
    x: number;
    y: number;
    // The picture's centre and size, and its Transform's scale, when it was grabbed.
    centre: [number, number];
    width: number;
    height: number;
    scale: number;
    group: string;
    moved: boolean;
    together: boolean;
  } | null>(null);
  if (!plan || !plan.overlays.length) return null;

  function point(pointer: PointerEvent): { x: number; y: number } | null {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || !plan) return null;
    return { x: ((pointer.clientX - rect.left) / rect.width) * plan.width, y: ((pointer.clientY - rect.top) / rect.height) * plan.height };
  }

  return (
    <>
      {plan.overlays.map((event, i) => {
        const id = event.id;
        const selected = controls?.selected.includes(id) ?? false;
        const follows = selected && !!drift && drift.lead !== `overlay:${id}`;
        const held = heldArea(hold, id, event);
        const [x, y] = event.picture.centre;
        const picture: Picture = held
          ? { ...event.picture, centre: [held.x, held.y], width: held.width, height: held.height }
          : follows
            ? { ...event.picture, centre: [x + drift!.dx, y + drift!.dy] }
            : event.picture;
        const alone = selected && picked.length === 1;
        const handlers = controls && {
          onPointerDown: (pointer: PointerEvent<HTMLDivElement>) => {
            const at = point(pointer);
            const transform = controls.transformOf(id);
            if (!at || !transform || pointer.button !== 0) return;
            pointer.preventDefault();
            pointer.stopPropagation();
            if (pointer.shiftKey || pointer.metaKey || pointer.ctrlKey) {
              controls.onSelect(id, true);
              return;
            }
            pointer.currentTarget.setPointerCapture(pointer.pointerId);
            const together = selected && picked.length > 1;
            if (!together) controls.onSelect(id, false);
            const kind = (pointer.target as HTMLElement).dataset.corner ? "size" : "move";
            drag.current = {
              id, pointer: pointer.pointerId, kind, ...at, centre: picture.centre, width: picture.width, height: picture.height,
              scale: transform.scale, group: `drag:overlay:${++drags}`, moved: false, together,
            };
          },
          onPointerMove: (pointer: PointerEvent<HTMLDivElement>) => {
            const current = drag.current;
            const at = point(pointer);
            if (!current || current.pointer !== pointer.pointerId || !at || !plan) return;
            current.moved = true;
            const [centreX, centreY] = current.centre;
            const from = overlayKey(event);
            if (current.kind === "move") {
              const x = Math.round(clamp(centreX + at.x - current.x, [0, FRAME.width]));
              const y = Math.round(clamp(centreY + at.y - current.y, [0, FRAME.height]));
              onHold({ id, x, y, width: current.width, height: current.height, from, dragging: true });
              controls.onPlace(id, { x, y }, current.group);
            } else {
              // About its centre: by how much further from it the pointer is than when it was grabbed.
              const grabbed = Math.hypot(current.x - centreX, current.y - centreY) || 1;
              const scale = clamp((current.scale * Math.hypot(at.x - centreX, at.y - centreY)) / grabbed, SCALE_RANGE);
              const grown = scale / current.scale;
              onHold({ id, x: centreX, y: centreY, width: current.width * grown, height: current.height * grown, from, dragging: true });
              controls.onPlace(id, { x: centreX, y: centreY, scale: Number(scale.toFixed(4)) }, current.group);
            }
          },
          onPointerUp: (pointer: PointerEvent<HTMLDivElement>) => {
            const current = drag.current;
            if (current?.pointer !== pointer.pointerId) return;
            drag.current = null;
            if (hold?.id === id) onHold({ ...hold, dragging: false });
            // A click on one of several picked picks it alone.
            if (!current.moved && current.together) controls.onSelect(id, false);
          },
        };
        return (
          <OverlayView key={`${i}:${event.media}`} plan={plan} event={event} picture={picture} playback={playback} selected={selected}>
            {handlers && (
              <div
                role="button"
                tabIndex={-1}
                aria-label="Overlay: drag to move it, its corner to resize it"
                aria-pressed={selected}
                {...handlers}
                className={cx(
                  "absolute inset-0 cursor-move touch-none",
                  selected ? "outline-2 outline-white outline-dashed" : "hover:outline-1 hover:outline-white/70 hover:outline-dashed",
                )}
              >
                {alone && (
                  <span
                    data-corner
                    aria-hidden
                    className="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize rounded-full bg-white shadow ring-1 ring-black/30"
                  />
                )}
              </div>
            )}
          </OverlayView>
        );
      })}
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
  children,
}: {
  plan: RenderPlan;
  event: OverlayEvent;
  picture: Picture;
  playback: Playback;
  // Selected, it is shown faintly outside its time too, to be placed.
  selected: boolean;
  children?: React.ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const shown = useShown(playback, (time) => time >= event.start && time < event.end);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => void follow(element, playback, { start: event.start, end: event.end, from: event.offset });
    sync();
    return playback.subscribe(sync);
  }, [playback, event]);

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
    >
      {children}
    </PicturePanel>
  );
}
