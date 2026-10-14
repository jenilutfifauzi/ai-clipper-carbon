import { Minus, Plus } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "../../../components/Button";
import { cx, formatClock } from "../../../format";
import { usePlayback, type Playback } from "../editor/playback";

// The track labels' column, in CSS pixels.
const LABEL_WIDTH = 64;
// How far the timeline zooms in from showing the whole Clip.
const MAX_ZOOM = 40;
// An edge comes within this many CSS pixels of a snap point to snap to it.
const SNAP_PX = 8;
// A touch held this long without moving lifts the item under it, to be dragged; one that moves
// sooner scrolls the timeline.
const LONG_PRESS_MS = 350;
const SLOP_PX = 8;
// A touch that moves further than this before it lifts is a swipe, not a tap.
const TAP_SLOP_PX = 8;
// The arrow keys move an item this far (with Alt, ten times as far).
const STEP_SECS = 0.1;

/** How the tracks are drawn: pixels per second, and how a time snaps. All times are Timeline time. */
export interface TimeGeometry {
  pps: number;
  duration: number;
  // `time`, moved onto the nearest snap point (the playhead, the Clip's ends, items' edges but
  // `own`) within SNAP_PX, or as it is.
  snap: (time: number, own?: number[]) => number;
  // The time under a pointer (or a drop) at `clientX`.
  timeAt: (clientX: number) => number;
}

/**
 * The Advanced Edit's multi-track Timeline, in Timeline time (seconds into the output): a ruler, the
 * tracks `children` draws, and the playhead over them. A click anywhere off the items (on the ruler
 * or the tracks) moves the playhead there, and dragging scrubs, as in CapCut or Premiere Pro. Zoomed by its buttons, by pinching (a trackpad's, or two fingers on a touch screen), or by
 * Ctrl or Cmd with the scroll wheel, about the pointer.
 */
export function AdvancedTimeline({
  duration,
  playback,
  snapPoints,
  tools,
  children,
}: {
  duration: number;
  playback: Playback;
  // Edges items snap to, besides the playhead and the Clip's ends.
  snapPoints: number[];
  // Buttons for the bar above the tracks (split, delete, ...).
  tools?: ReactNode;
  children: (geometry: TimeGeometry) => ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // A press on the tracks or the ruler that moves the playhead: at once and while dragged (`now`), or
  // when it lifts where it went down (a tap, which may yet turn into a scroll).
  const scrub = useRef<{ pointer: number; x: number; y: number; now: boolean } | null>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  // A zoom about a point: the time under it and where it is in the view, kept there after the zoom.
  const anchor = useRef<{ time: number; offset: number } | null>(null);
  const fit = Math.max(width - LABEL_WIDTH - 16, 100) / Math.max(duration, 1);
  const pps = fit * zoom;
  const total = Math.max(duration * pps, 0);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The time under a pointer.
  const timeAt = (clientX: number) => {
    const element = scroller.current!;
    const left = element.getBoundingClientRect().left + LABEL_WIDTH - element.scrollLeft;
    return Math.min(Math.max((clientX - left) / pps, 0), duration);
  };

  const zoomRef = useRef({ zoom, timeAt });
  zoomRef.current = { zoom, timeAt };
  function zoomTo(next: number, clientX?: number) {
    const element = scroller.current;
    const clamped = Math.min(Math.max(next, 1), MAX_ZOOM);
    if (element) {
      const rect = element.getBoundingClientRect();
      const x = clientX ?? rect.left + LABEL_WIDTH + (rect.width - LABEL_WIDTH) / 2;
      anchor.current = { time: zoomRef.current.timeAt(x), offset: x - rect.left - LABEL_WIDTH };
    }
    setZoom(clamped);
  }
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !anchor.current) return;
    element.scrollLeft = anchor.current.time * pps - anchor.current.offset;
    anchor.current = null;
  }, [pps]);

  // Pinching: Ctrl or Cmd with the wheel (a trackpad's pinch comes so), or two fingers.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomToRef.current(zoomRef.current.zoom * Math.exp(-event.deltaY * 0.01), event.clientX);
    };
    let pinch: { distance: number; zoom: number } | null = null;
    const spread = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) pinch = { distance: spread(event.touches), zoom: zoomRef.current.zoom };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const middle = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      zoomToRef.current((pinch.zoom * spread(event.touches)) / Math.max(pinch.distance, 1), middle);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) pinch = null;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEnd);
    element.addEventListener("touchcancel", onTouchEnd);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEnd);
      element.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const geometry: TimeGeometry = {
    pps,
    duration,
    timeAt,
    snap: (time, own = []) => {
      const points = [0, duration, playback.time, ...snapPoints].filter((point) => !own.some((o) => Math.abs(o - point) < 1e-6));
      let best = time;
      let distance = SNAP_PX / pps;
      for (const point of points) {
        if (Math.abs(point - time) < distance) {
          best = point;
          distance = Math.abs(point - time);
        }
      }
      return best;
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 items-center justify-between gap-2 px-2">
        <div className="flex items-center gap-1">{tools}</div>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <Button size="icon" variant="ghost" onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= 1} aria-label="Zoom out">
            <Minus aria-hidden size={16} />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
            <Plus aria-hidden size={16} />
          </Button>
        </div>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-contain select-none">
        <div
          className="relative flex min-h-full flex-col pb-2"
          style={{ width: total + LABEL_WIDTH + 16 }}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            // Items and buttons are picked and dragged as they are; the labels' column isn't time.
            if (event.button !== 0 || target.closest("button, a, input, [role=button]")) return;
            const left = scroller.current!.getBoundingClientRect().left + LABEL_WIDTH;
            if (event.clientX < left) return;
            // A touch on the tracks may be a swipe that scrolls: it moves the playhead when it ends
            // where it started. A mouse, or a touch on the ruler, moves it at once and scrubs.
            const now = event.pointerType !== "touch" || !!target.closest("[data-scrub]");
            scrub.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, now };
            if (now) {
              event.currentTarget.setPointerCapture(event.pointerId);
              playback.seek(timeAt(event.clientX));
            }
          }}
          onPointerMove={(event) => {
            const current = scrub.current;
            if (!current || current.pointer !== event.pointerId) return;
            if (current.now) playback.seek(timeAt(event.clientX));
            else if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > TAP_SLOP_PX) scrub.current = null;
          }}
          onPointerUp={(event) => {
            const current = scrub.current;
            if (current?.pointer === event.pointerId && !current.now) playback.seek(timeAt(event.clientX));
            scrub.current = null;
          }}
          onPointerCancel={() => {
            scrub.current = null;
          }}
        >
          <TrackRow label="" height="h-7">
            <Ruler duration={duration} pps={pps} />
          </TrackRow>
          {children(geometry)}
          <Playhead playback={playback} pps={pps} />
        </div>
      </div>
    </div>
  );
}

/**
 * A track: its label, sticky at the left, and its items, placed by time. With `drop`, it takes what
 * is dragged onto it from the asset panel (of the DataTransfer `types` it names), highlighted while
 * over it.
 */
export function TrackRow({
  label,
  height = "h-11",
  drop,
  children,
}: {
  label: ReactNode;
  // A Tailwind height class.
  height?: string;
  drop?: { types: string[]; onDrop: (data: DataTransfer, clientX: number) => void };
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const takes = (data: DataTransfer) => !!drop && drop.types.some((type) => data.types.includes(type));
  return (
    <div
      className={cx("flex shrink-0 border-b border-border last:border-b-0", height, over && "bg-accent/10")}
      onDragOver={(event) => {
        if (!takes(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        if (!takes(event.dataTransfer)) return;
        event.preventDefault();
        drop?.onDrop(event.dataTransfer, event.clientX);
      }}
    >
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center bg-bg/90 px-2 text-xs font-medium text-muted backdrop-blur"
        style={{ width: LABEL_WIDTH }}
      >
        {label}
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

// Ticks every 1, 2, 5, 10, 15, 30 or 60 s, whichever leaves room for the labels, with tenths
// between when zoomed far in. A touch on it scrubs at once (`data-scrub`), as a mouse does anywhere.
function Ruler({ duration, pps }: { duration: number; pps: number }) {
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 56) ?? 60;
  const ticks = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(Math.round(t * 10) / 10);
  return (
    <div aria-hidden data-scrub className="absolute inset-0 cursor-pointer touch-none">
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute top-0 bottom-0 border-l border-border pl-1 text-[11px] leading-7 text-muted tabular-nums"
          style={{ left: t * pps }}
        >
          {step < 1 && t % 1 ? `${t.toFixed(1)}` : formatClock(t)}
        </span>
      ))}
    </div>
  );
}

function Playhead({ playback, pps }: { playback: Playback; pps: number }) {
  const time = usePlayback(playback, (t) => Math.round(t * 30) / 30);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 -translate-x-1/2 bg-text"
      style={{ left: LABEL_WIDTH + time * pps }}
    >
      <span className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-xs bg-text" />
    </div>
  );
}

export type ItemTone = "accent" | "waiting" | "text" | "audio" | "neutral" | "video" | "overlay";

const TONES: Record<ItemTone, string> = {
  accent: "bg-accent/25 ring-accent/70",
  waiting: "bg-waiting-surface ring-waiting/70",
  text: "bg-[oklch(0.62_0.17_300/0.28)] ring-[oklch(0.62_0.17_300/0.8)]",
  audio: "bg-[oklch(0.68_0.14_160/0.28)] ring-[oklch(0.68_0.14_160/0.8)]",
  neutral: "bg-surface-raised ring-border",
  // Over the Scenes drawn under it.
  video: "bg-transparent ring-text/40",
  overlay: "bg-[oklch(0.66_0.13_235/0.3)] ring-[oklch(0.66_0.13_235/0.85)]",
};

let gestures = 0;

/**
 * An item on a track from `start` to `end`: dragged to move it, its edges to trim it (both snap),
 * selected by a click or tap. On a touch screen it is lifted by a long press, so that a swipe still
 * scrolls the timeline. The arrow keys move it (with Alt, further), with Shift they change its end;
 * Delete removes it. Each drag is one `group` of changes, undone as one.
 */
export function TimelineItem({
  geometry,
  start,
  end,
  min = 0,
  max,
  minSecs = 0.1,
  maxSecs = Infinity,
  trimMin,
  trim = true,
  tone,
  selected,
  label,
  onSelect,
  onChange,
  onDelete,
  children,
}: {
  geometry: TimeGeometry;
  start: number;
  end: number;
  // Where it may go.
  min?: number;
  max: number;
  minSecs?: number;
  // The longest it can be, and how early its start can be trimmed (a song's start, for music).
  maxSecs?: number;
  trimMin?: number;
  // Whether its edges can be dragged.
  trim?: boolean;
  tone: ItemTone;
  selected: boolean;
  // What a screen reader calls it.
  label: string;
  onSelect: () => void;
  onChange?: (range: { start: number; end: number; edge: "move" | "start" | "end" }, group: string) => void;
  onDelete?: () => void;
  children: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [lifted, setLifted] = useState(false);
  const drag = useRef<{
    edge: "move" | "start" | "end";
    pointer: number;
    x: number;
    y: number;
    from: { start: number; end: number };
    armed: boolean;
    moved: boolean;
    group: string;
    timer?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const { pps, snap } = geometry;

  // A lifted item's drag isn't a scroll.
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const onTouchMove = (event: TouchEvent) => {
      if (drag.current?.armed) event.preventDefault();
    };
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => node.removeEventListener("touchmove", onTouchMove);
  }, []);

  function range(edge: "move" | "start" | "end", from: { start: number; end: number }, delta: number) {
    const own = [from.start, from.end];
    if (edge === "move") {
      const length = from.end - from.start;
      let next = Math.min(Math.max(from.start + delta, min), max - length);
      const byStart = snap(next, own) - next;
      const byEnd = snap(next + length, own) - (next + length);
      const shift = [byStart, byEnd].filter((d) => d !== 0).sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;
      next = Math.min(Math.max(next + shift, min), max - length);
      return { start: next, end: next + length };
    }
    if (edge === "start") {
      const lo = Math.max(min, from.end - maxSecs, trimMin ?? -Infinity);
      const next = Math.min(Math.max(snap(from.start + delta, own), lo), from.end - minSecs);
      return { start: next, end: from.end };
    }
    const hi = Math.min(max, from.start + maxSecs);
    const next = Math.max(Math.min(snap(from.end + delta, own), hi), from.start + minSecs);
    return { start: from.start, end: next };
  }

  function stop() {
    if (drag.current?.timer) clearTimeout(drag.current.timer);
    drag.current = null;
    setLifted(false);
  }

  const handlers = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const touch = event.pointerType === "touch";
      // On a touch screen the edges show, and trim, once the item is selected.
      const grabbed = (event.target as HTMLElement).dataset.edge as "start" | "end" | undefined;
      const edge = grabbed && (selected || !touch) ? grabbed : "move";
      const gesture = {
        edge: onChange ? edge : ("move" as const),
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from: { start, end },
        armed: !touch && !!onChange,
        moved: false,
        group: `drag:${++gestures}`,
        timer: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      if (!touch) event.currentTarget.setPointerCapture(event.pointerId);
      else if (onChange) {
        const target = event.currentTarget;
        const pointer = event.pointerId;
        gesture.timer = setTimeout(() => {
          if (drag.current !== gesture) return;
          gesture.armed = true;
          setLifted(true);
          onSelect();
          try {
            target.setPointerCapture(pointer);
          } catch {
            // the touch has ended
          }
          navigator.vibrate?.(10);
        }, LONG_PRESS_MS);
      }
      drag.current = gesture;
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const gesture = drag.current;
      if (!gesture || event.pointerId !== gesture.pointer) return;
      if (!gesture.armed) {
        // A touch that moves before it is lifted scrolls instead.
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > SLOP_PX) {
          if (gesture.timer) clearTimeout(gesture.timer);
          gesture.moved = true;
        }
        return;
      }
      const delta = (event.clientX - gesture.x) / pps;
      if (!gesture.moved && Math.abs(event.clientX - gesture.x) < 2) return;
      // An item being dragged is the one selected.
      if (!gesture.moved) onSelect();
      gesture.moved = true;
      onChange?.({ ...range(gesture.edge, gesture.from, delta), edge: gesture.edge }, gesture.group);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const gesture = drag.current;
      if (!gesture || event.pointerId !== gesture.pointer) return;
      if (!gesture.moved) onSelect();
      stop();
    },
    onPointerCancel: stop,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.key === "Delete" || event.key === "Backspace") && onDelete) {
        event.preventDefault();
        onDelete();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
        return;
      }
      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || !onChange) return;
      event.preventDefault();
      const step = (event.key === "ArrowRight" ? 1 : -1) * STEP_SECS * (event.altKey ? 10 : 1);
      const edge = event.shiftKey ? "end" : "move";
      const from = { start, end };
      const next =
        edge === "move"
          ? { start: Math.min(Math.max(start + step, min), max - (end - start)), end: 0 }
          : { start, end: Math.min(Math.max(end + step, start + minSecs), Math.min(max, start + maxSecs)) };
      if (edge === "move") next.end = next.start + (from.end - from.start);
      onChange({ ...next, edge }, `key:${edge}`);
    },
  };

  const width = Math.max(4, (end - start) * pps - 1);
  return (
    <div
      ref={element}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      {...handlers}
      className={cx(
        "group absolute inset-y-1 overflow-hidden rounded-md text-left text-xs leading-none ring-1",
        "focus-visible:outline-2 focus-visible:outline-focus",
        onChange ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        TONES[tone],
        selected && "ring-2 ring-text",
        lifted && "z-10 scale-y-110 shadow-raised",
      )}
      style={{ left: start * pps, width }}
    >
      <div className="pointer-events-none flex h-full items-center gap-1 overflow-hidden px-2 whitespace-nowrap">{children}</div>
      {trim && onChange && (
        <>
          <span
            data-edge="start"
            aria-hidden
            className={cx(
              "absolute inset-y-0 left-0 w-3 cursor-ew-resize rounded-l-md bg-text/70",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-60",
            )}
          />
          <span
            data-edge="end"
            aria-hidden
            className={cx(
              "absolute inset-y-0 right-0 w-3 cursor-ew-resize rounded-r-md bg-text/70",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-60",
            )}
          />
        </>
      )}
    </div>
  );
}
