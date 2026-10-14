import { useEffect, useRef, useState, type PointerEvent } from "react";
import { mediaItemUrl, mediaProxyUrl, type OverlayEvent, type RenderPlan } from "../../../api";
import { cx } from "../../../format";
import { usePlayback, type Playback } from "./playback";

// A video further than this from where the Clip's time puts it is moved back in step.
const MAX_DRIFT_SECS = 0.15;

const percent = (value: number) => `${value * 100}%`;

/** The Advanced Edit's hold on the Overlays in the preview: which is selected, and what a drag does. */
export interface OverlayControls {
  selected: string | null;
  // The Overlays' ids, in the plan's order.
  ids: string[];
  onSelect: (id: string) => void;
  // Dragged to centre (x, y), and resized to `size` pixels wide, in output pixels; each drag one `group`.
  onPlace: (id: string, place: { x: number; y: number; size?: number }, group: string) => void;
}

let drags = 0;

/**
 * The plan's Overlays while they show, over the Source's (and videos') pictures and under the
 * captions: an image, or a video's small copy playing in step with the playback (muted: its sound,
 * when turned up, plays with the music). With `controls`, one is selected by a click, dragged to a
 * new place and resized by its corner; it is drawn where it is put until the plan has it there.
 */
export function PreviewOverlays({
  plan,
  playback,
  stage,
  controls,
}: {
  plan: RenderPlan | null;
  playback: Playback;
  stage: React.RefObject<HTMLDivElement | null>;
  controls?: OverlayControls;
}) {
  // Where a dragged one is held, by its id: its area, in output pixels.
  const [held, setHeld] = useState<{ id: string; x: number; y: number; width: number; height: number; from: string } | null>(null);
  const drag = useRef<{ id: string; pointer: number; kind: "move" | "size"; x: number; y: number; area: OverlayEvent["area"]; group: string } | null>(null);
  if (!plan || !plan.overlays.length) return null;

  // A plan's area for the Overlay, as a key: what a held place is kept until.
  const keyOf = (event: OverlayEvent) => `${event.area.x},${event.area.y},${event.area.width}`;

  function point(pointer: PointerEvent): { x: number; y: number } | null {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || !plan) return null;
    return { x: ((pointer.clientX - rect.left) / rect.width) * plan.width, y: ((pointer.clientY - rect.top) / rect.height) * plan.height };
  }

  return (
    <>
      {plan.overlays.map((event, i) => {
        const id = controls?.ids[i] ?? String(i);
        const area = held && held.id === id && (drag.current?.id === id || held.from === keyOf(event)) ? held : event.area;
        const selected = controls?.selected === id;
        const handlers = controls && {
          onPointerDown: (pointer: PointerEvent<HTMLDivElement>) => {
            const at = point(pointer);
            if (!at || pointer.button !== 0) return;
            pointer.preventDefault();
            pointer.stopPropagation();
            pointer.currentTarget.setPointerCapture(pointer.pointerId);
            controls.onSelect(id);
            const kind = (pointer.target as HTMLElement).dataset.corner ? "size" : "move";
            drag.current = { id, pointer: pointer.pointerId, kind, ...at, area: { ...area }, group: `overlay:${++drags}` };
          },
          onPointerMove: (pointer: PointerEvent<HTMLDivElement>) => {
            const current = drag.current;
            const at = point(pointer);
            if (!current || current.pointer !== pointer.pointerId || !at || !plan) return;
            const { area: from } = current;
            if (current.kind === "move") {
              const x = Math.round(from.x + at.x - current.x);
              const y = Math.round(from.y + at.y - current.y);
              setHeld({ id, x, y, width: from.width, height: from.height, from: keyOf(event) });
              controls.onPlace(id, { x: Math.round(x + from.width / 2), y: Math.round(y + from.height / 2) }, current.group);
            } else {
              // From its top-left corner: the bottom-right one sets its width, keeping its shape.
              const width = Math.max(32, Math.min(plan.width, Math.round(from.width + at.x - current.x)));
              const height = Math.round((width * from.height) / from.width);
              setHeld({ id, x: from.x, y: from.y, width, height, from: keyOf(event) });
              controls.onPlace(id, { x: Math.round(from.x + width / 2), y: Math.round(from.y + height / 2), size: width }, current.group);
            }
          },
          onPointerUp: (pointer: PointerEvent<HTMLDivElement>) => {
            if (drag.current?.pointer === pointer.pointerId) drag.current = null;
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
                {selected && (
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
    const sync = () => {
      const time = playback.time;
      if (time < event.start || time >= event.end) {
        if (!element.paused) element.pause();
        return;
      }
      const want = event.offset + (time - event.start);
      if (Math.abs(element.currentTime - want) > MAX_DRIFT_SECS) element.currentTime = want;
      if (playback.playing && element.paused) void element.play().catch(() => {});
      if (!playback.playing && !element.paused) element.pause();
    };
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
