import { useEffect, useRef, type PointerEvent } from "react";
import { mediaItemUrl, mediaProxyUrl, type OverlayEvent, type RenderPlan } from "../../../api";
import { cx } from "../../../format";
import { follow } from "./follow";
import { usePlayback, type Playback } from "./playback";
import type { Drift } from "./StageEdit";

const percent = (value: number) => `${value * 100}%`;

/** The Advanced Edit's hold on the Overlays in the preview: which are picked, and what a drag does. */
export interface OverlayControls {
  selected: string[];
  // The Overlays' ids, in the plan's order.
  ids: string[];
  // Picked alone, or (`toggle`: a click with Shift, Cmd or Ctrl) added to the Pick or taken out of it.
  onSelect: (id: string, toggle: boolean) => void;
  // Dragged to centre (x, y), and resized to `size` pixels wide, in output pixels; each drag one `group`.
  onPlace: (id: string, place: { x: number; y: number; size?: number }, group: string) => void;
}

/**
 * Where a dragged Overlay is drawn, in output pixels, until the plan has it there: `from` is the
 * plan's area for it when it was put there (`overlayKey`), and it is held while `dragging` or until a
 * plan with another area comes.
 */
export type OverlayHold = { id: string; x: number; y: number; width: number; height: number; from: string; dragging: boolean };

// A plan's area for an Overlay, as a key: what a held place is kept until.
export const overlayKey = (event: OverlayEvent) => `${event.area.x},${event.area.y},${event.area.width}`;

// The held place of the Overlay drawn by `event`, if it is still held.
export const heldArea = (hold: OverlayHold | null, id: string, event: OverlayEvent) =>
  hold && hold.id === id && (hold.dragging || hold.from === overlayKey(event)) ? hold : null;

let drags = 0;

/**
 * The plan's Overlays while they show, over the Source's (and videos') pictures and under the
 * captions: an image, or a video's small copy playing in step with the playback (muted: its sound,
 * when turned up, plays with the music). With `controls`, one is picked by a click (with Shift, Cmd or
 * Ctrl, added to the Pick), dragged to a new place and, picked alone, resized by its corner; it is
 * drawn where it is put (`hold`) until the plan has it there. Picked ones that follow another moved
 * item are drawn as far from their places (`drift`).
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
    area: OverlayEvent["area"];
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
        const id = controls?.ids[i] ?? String(i);
        const selected = controls?.selected.includes(id) ?? false;
        const follows = selected && !!drift && drift.lead !== `overlay:${id}`;
        const area = heldArea(hold, id, event) ?? (follows ? { ...event.area, x: event.area.x + drift!.dx, y: event.area.y + drift!.dy } : event.area);
        const alone = selected && picked.length === 1;
        const handlers = controls && {
          onPointerDown: (pointer: PointerEvent<HTMLDivElement>) => {
            const at = point(pointer);
            if (!at || pointer.button !== 0) return;
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
            drag.current = { id, pointer: pointer.pointerId, kind, ...at, area: { ...area }, group: `drag:overlay:${++drags}`, moved: false, together };
          },
          onPointerMove: (pointer: PointerEvent<HTMLDivElement>) => {
            const current = drag.current;
            const at = point(pointer);
            if (!current || current.pointer !== pointer.pointerId || !at || !plan) return;
            current.moved = true;
            const { area: from } = current;
            if (current.kind === "move") {
              const x = Math.round(from.x + at.x - current.x);
              const y = Math.round(from.y + at.y - current.y);
              onHold({ id, x, y, width: from.width, height: from.height, from: overlayKey(event), dragging: true });
              controls.onPlace(id, { x: Math.round(x + from.width / 2), y: Math.round(y + from.height / 2) }, current.group);
            } else {
              // From its top-left corner: the bottom-right one sets its width, keeping its shape.
              const width = Math.max(32, Math.min(plan.width, Math.round(from.width + at.x - current.x)));
              const height = Math.round((width * from.height) / from.width);
              onHold({ id, x: from.x, y: from.y, width, height, from: overlayKey(event), dragging: true });
              controls.onPlace(id, { x: Math.round(from.x + width / 2), y: Math.round(from.y + height / 2), size: width }, current.group);
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
          <OverlayView key={`${i}:${event.media}`} plan={plan} event={event} area={area} playback={playback} selected={selected}>
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

/** One Overlay in `area`, shown while the Clip's time is in it. */
function OverlayView({
  plan,
  event,
  area,
  playback,
  selected,
  children,
}: {
  plan: RenderPlan;
  event: OverlayEvent;
  area: { x: number; y: number; width: number; height: number };
  playback: Playback;
  // Selected, it is shown faintly outside its time too, to be placed.
  selected: boolean;
  children?: React.ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const shown = usePlayback(playback, (time) => time >= event.start && time < event.end);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => void follow(element, playback, { start: event.start, end: event.end, from: event.offset });
    sync();
    return playback.subscribe(sync);
  }, [playback, event]);

  return (
    <div
      className="absolute"
      style={{
        left: percent(area.x / plan.width),
        top: percent(area.y / plan.height),
        width: percent(area.width / plan.width),
        height: percent(area.height / plan.height),
        visibility: shown || selected ? "visible" : "hidden",
      }}
    >
      <div className="size-full" style={{ opacity: shown ? event.opacity : 0.25 }}>
        {event.image ? (
          <img src={mediaItemUrl(event.media)} alt="" draggable={false} className="size-full object-fill" />
        ) : (
          <video ref={video} src={mediaProxyUrl(event.media)} muted playsInline preload="auto" className="size-full object-fill" />
        )}
      </div>
      {children}
    </div>
  );
}
