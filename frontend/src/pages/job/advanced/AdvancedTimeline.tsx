import { Minus, Plus, UnfoldHorizontal } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "../../../components/Button";
import { cx, formatClock } from "../../../format";
import { usePlayback, type Playback } from "../editor/playback";
import { MAX_ZOOM, type ZoomedView } from "./timelineView";

// The labels' column, by default (a phone's), in CSS pixels: its Tracks' names.
const LABEL_WIDTH = 64;
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
  view: TimelineView;
}

/**
 * The tracks' stretch on screen, read when drawing rather than rendered, so that a scroll redraws the
 * items' canvases and nothing else.
 */
export interface TimelineView {
  // In pixels from 0 s.
  visible: () => { left: number; right: number };
  // Calls `listener` whenever it scrolls; returns what stops it.
  subscribe: (listener: () => void) => () => void;
}

// An area on screen, in CSS pixels.
export type Area = { left: number; right: number; top: number; bottom: number };

/**
 * The Advanced Edit's multi-track Timeline, in Timeline time (seconds into the output): a ruler, the
 * tracks `children` draws, and the playhead over them. A click anywhere off the items (on the ruler
 * or the tracks) moves the playhead there, and dragging on the ruler scrubs, as in CapCut or Premiere
 * Pro. With a mouse, dragging on the tracks off the items draws a rubber band instead: on release,
 * `onBand` is given the items drawn (each by its `pickKey`) and the band (with Shift, `add`), and a
 * click there also calls `onClear`. On a touch screen a swipe on the tracks scrolls. Zoomed by its
 * buttons, by pinching (a trackpad's, or two fingers on a touch screen), or by Ctrl or Cmd with the
 * scroll wheel, about the pointer; its Fit button (or `fitRef`, called) zooms and scrolls to what
 * `toFit` gives for its width and zoom (Zoom to fit).
 */
export function AdvancedTimeline({
  duration,
  playback,
  snapPoints,
  tools,
  onBand,
  onClear,
  toFit,
  fitRef,
  labelWidth = LABEL_WIDTH,
  children,
}: {
  duration: number;
  playback: Playback;
  // Edges items snap to, besides the playhead and the Clip's ends.
  snapPoints: number[];
  // Buttons for the bar above the tracks (split, delete, ...).
  tools?: ReactNode;
  onBand?: (items: (Area & { key: string })[], band: Area, add: boolean) => void;
  onClear?: () => void;
  // The view Zoom to fit gives on a Timeline `width` CSS pixels wide for its times, now at `zoom`;
  // and, set to Zoom to fit, a ref for its shortcut.
  toFit: (timeline: { width: number; zoom: number }) => ZoomedView;
  fitRef: Ref<() => void>;
  // The labels' column's width, in pixels: wider on a desktop, where it holds the Tracks' buttons.
  labelWidth?: number;
  children: (geometry: TimeGeometry) => ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // A press on the tracks or the ruler that moves the playhead: at once and while dragged (`now`), or
  // when it lifts where it went down (a tap, which may yet turn into a scroll).
  const scrub = useRef<{ pointer: number; x: number; y: number; now: boolean } | null>(null);
  // A mouse's press on the tracks off the items: a click, or a rubber band once it moves.
  const banding = useRef<{ pointer: number; x: number; y: number; add: boolean; moved: boolean } | null>(null);
  // The rubber band as drawn, over the tracks.
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  // A zoom about a point: the time under it and where it is in the view, kept there after the zoom.
  const anchor = useRef<{ time: number; offset: number } | null>(null);
  // The tracks' width for the whole Clip at 1×, and its pixels a second then.
  const usable = Math.max(width - labelWidth - 16, 100);
  const fit = usable / Math.max(duration, 1);
  const pps = fit * zoom;
  const total = Math.max(duration * pps, 0);
  const labels = useRef(labelWidth);
  labels.current = labelWidth;
  const view = useMemo<TimelineView>(
    () => ({
      visible: () => {
        const element = scroller.current;
        if (!element) return { left: 0, right: 0 };
        return { left: element.scrollLeft, right: element.scrollLeft + element.clientWidth - labels.current };
      },
      subscribe: (listener) => {
        const element = scroller.current;
        element?.addEventListener("scroll", listener, { passive: true });
        return () => element?.removeEventListener("scroll", listener);
      },
    }),
    [],
  );

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
    const left = element.getBoundingClientRect().left + labelWidth - element.scrollLeft;
    return Math.min(Math.max((clientX - left) / pps, 0), duration);
  };

  const zoomRef = useRef({ zoom, timeAt });
  zoomRef.current = { zoom, timeAt };
  function zoomTo(next: number, clientX?: number) {
    const element = scroller.current;
    const clamped = Math.min(Math.max(next, 1), MAX_ZOOM);
    if (element) {
      const rect = element.getBoundingClientRect();
      const x = clientX ?? rect.left + labelWidth + (rect.width - labelWidth) / 2;
      anchor.current = { time: zoomRef.current.timeAt(x), offset: x - rect.left - labelWidth };
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

  // Zoom to fit: at a new zoom, the scroll is kept for once it is drawn.
  function fitView() {
    const view = toFit({ width: usable, zoom });
    if (view.zoom === zoom) {
      scroller.current?.scrollTo({ left: view.scroll });
      return;
    }
    anchor.current = { time: view.scroll / (fit * view.zoom), offset: 0 };
    setZoom(view.zoom);
  }
  useImperativeHandle(fitRef, () => fitView);

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
    view,
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
        {/* On a phone the tools scroll sideways, so that the zoom's buttons always show. */}
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">{tools}</div>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Zoom">
          <Button size="icon" variant="ghost" onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= 1} aria-label="Zoom out">
            <Minus aria-hidden size={16} />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
            <Plus aria-hidden size={16} />
          </Button>
          <Button size="icon" variant="ghost" onClick={fitView} aria-label="Zoom to fit" aria-keyshortcuts="Shift+Z" title="Zoom to fit (Shift+Z): what is picked, or with nothing picked, the whole Clip">
            <UnfoldHorizontal aria-hidden size={16} />
          </Button>
        </div>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-contain select-none">
        <div
          className="relative flex min-h-full flex-col pb-2"
          style={{ width: total + labelWidth + 16, "--track-label": `${labelWidth}px` } as CSSProperties}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            // Items and buttons are picked and dragged as they are; the labels' column isn't time.
            if (event.button !== 0 || target.closest("button, a, input, [role=button]")) return;
            const left = scroller.current!.getBoundingClientRect().left + labelWidth;
            if (event.clientX < left) return;
            const ruler = !!target.closest("[data-scrub]");
            if (event.pointerType !== "touch" && !ruler && onBand) {
              event.currentTarget.setPointerCapture(event.pointerId);
              banding.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, add: event.shiftKey, moved: false };
              return;
            }
            // A touch on the tracks may be a swipe that scrolls: it moves the playhead when it ends
            // where it started. A mouse, or a touch on the ruler, moves it at once and scrubs.
            const now = event.pointerType !== "touch" || ruler;
            scrub.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, now };
            if (now) {
              event.currentTarget.setPointerCapture(event.pointerId);
              playback.seek(timeAt(event.clientX));
            }
          }}
          onPointerMove={(event) => {
            const pressed = banding.current;
            if (pressed?.pointer === event.pointerId) {
              if (!pressed.moved && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) <= TAP_SLOP_PX) return;
              pressed.moved = true;
              const rect = event.currentTarget.getBoundingClientRect();
              setBand({
                left: Math.min(pressed.x, event.clientX) - rect.left,
                top: Math.min(pressed.y, event.clientY) - rect.top,
                width: Math.abs(event.clientX - pressed.x),
                height: Math.abs(event.clientY - pressed.y),
              });
              return;
            }
            const current = scrub.current;
            if (!current || current.pointer !== event.pointerId) return;
            if (current.now) playback.seek(timeAt(event.clientX));
            else if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > TAP_SLOP_PX) scrub.current = null;
          }}
          onPointerUp={(event) => {
            const pressed = banding.current;
            if (pressed?.pointer === event.pointerId) {
              banding.current = null;
              setBand(null);
              if (!pressed.moved) {
                playback.seek(timeAt(event.clientX));
                onClear?.();
                return;
              }
              const drawn = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-pick]")].map((node) => {
                const { left, right, top, bottom } = node.getBoundingClientRect();
                return { key: node.dataset.pick!, left, right, top, bottom };
              });
              const area = {
                left: Math.min(pressed.x, event.clientX),
                right: Math.max(pressed.x, event.clientX),
                top: Math.min(pressed.y, event.clientY),
                bottom: Math.max(pressed.y, event.clientY),
              };
              onBand?.(drawn, area, pressed.add);
              return;
            }
            const current = scrub.current;
            if (current?.pointer === event.pointerId && !current.now) playback.seek(timeAt(event.clientX));
            scrub.current = null;
          }}
          onPointerCancel={() => {
            scrub.current = null;
            banding.current = null;
            setBand(null);
          }}
        >
          <TrackRow label="" height="h-7">
            <Ruler duration={duration} pps={pps} />
          </TrackRow>
          {children(geometry)}
          <Playhead playback={playback} pps={pps} labelWidth={labelWidth} />
          {band && (
            <div
              aria-hidden
              className="pointer-events-none absolute z-30 rounded-sm border border-accent bg-accent/15"
              style={{ left: band.left, top: band.top, width: band.width, height: band.height }}
            />
          )}
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
  dimmed = false,
  locked = false,
  children,
}: {
  label: ReactNode;
  // A Tailwind height class.
  height?: string;
  // Its items faded: its Track is hidden in the preview.
  dimmed?: boolean;
  // Its items out of reach (inert): its Track is locked. Drops still come, to be refused.
  locked?: boolean;
  drop?: { types: string[]; onDrop: (data: DataTransfer, clientX: number) => void };
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const items = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (items.current) items.current.inert = locked;
  }, [locked]);
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
        style={{ width: `var(--track-label, ${LABEL_WIDTH}px)` }}
      >
        {label}
      </div>
      <div ref={items} className={cx("relative flex-1", dimmed && "opacity-40", locked && "pointer-events-none")}>
        {children}
      </div>
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

function Playhead({ playback, pps, labelWidth }: { playback: Playback; pps: number; labelWidth: number }) {
  const time = usePlayback(playback, (t) => Math.round(t * 30) / 30);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 -translate-x-1/2 bg-text"
      style={{ left: labelWidth + time * pps }}
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
 * picked by a click or tap (with Shift, Cmd or Ctrl, added to the Pick or taken out of it; dragging a
 * picked item keeps the Pick). On a touch screen it is lifted by a long press, so that a swipe still
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
  pickKey,
  changed = false,
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
  // How a rubber band names it, when it can pick it.
  pickKey?: string;
  // Just changed in another editor (another tab, the agent): shown for a moment.
  changed?: boolean;
  // What a screen reader calls it.
  label: string;
  // Picked alone, or (`toggle`) added to the Pick or taken out of it.
  onSelect: (toggle: boolean) => void;
  onChange?: (range: { start: number; end: number; edge: "move" | "start" | "end" }, group: string) => void;
  onDelete?: (rippled: boolean) => void;
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
    // Lifted by a long press, which picked it.
    lifted: boolean;
    moved: boolean;
    // A click with Shift, Cmd or Ctrl.
    toggle: boolean;
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
        lifted: false,
        moved: false,
        toggle: event.shiftKey || event.metaKey || event.ctrlKey,
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
          gesture.lifted = true;
          setLifted(true);
          if (!selected) onSelect(false);
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
      // An item being dragged is picked (with the rest of the Pick, when it is in it).
      if (!gesture.moved && !selected) onSelect(false);
      gesture.moved = true;
      onChange?.({ ...range(gesture.edge, gesture.from, delta), edge: gesture.edge }, gesture.group);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const gesture = drag.current;
      if (!gesture || event.pointerId !== gesture.pointer) return;
      if (!gesture.moved && !gesture.lifted) onSelect(gesture.toggle);
      stop();
    },
    onPointerCancel: stop,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if ((event.key === "Delete" || event.key === "Backspace") && onDelete) {
        event.preventDefault();
        onDelete(event.shiftKey);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(event.shiftKey || event.metaKey || event.ctrlKey);
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
      data-pick={pickKey}
      {...handlers}
      className={cx(
        "group absolute inset-y-1 overflow-hidden rounded-md text-left text-xs leading-none ring-1",
        "focus-visible:outline-2 focus-visible:outline-focus",
        onChange ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        TONES[tone],
        selected && "ring-2 ring-text",
        changed && "motion-safe:animate-[changed_1.6s_var(--ease-out)] motion-reduce:ring-2 motion-reduce:ring-accent",
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
