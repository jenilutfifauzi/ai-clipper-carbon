import { Minus, Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import type { RenderPlan, Word } from "../../../api";
import { Button, buttonClass } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { cx, formatClock, formatPrecise } from "../../../format";
import type { HookTiming } from "../HookEditor";
import { Link } from "react-router";
import { usePlayback, type PlayedSegment, type Playback } from "./playback";
import { MagneticToggle } from "./MagneticToggle";

// How much of the Source either side of the clip the timeline shows, and the longest clip (as
// app/review.py's MAX_CLIP_SECS).
const CONTEXT_SECS = 10;
const MAX_CLIP_SECS = 180;
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];
// The hook's shortest and longest time (the backend's limits), and a keyboard step.
const HOOK_MIN_SECS = 0.5;
const HOOK_MAX_SECS = 30;
const STEP_SECS = 0.1;
const LABEL_WIDTH = 72;

export interface Range {
  start: number;
  end: number;
}

/**
 * The clip on a timeline of the Source, with the playhead of the preview's playback:
 * - Clip: its range, with handles that snap to Word edges (dragged, or moved a Word at a time
 *   with the arrow keys), saved on release;
 * - Captions: the plan's lines; clicking one opens it in the caption text editor;
 * - Hook: dragged to move it, its right edge to change how long it stays;
 * - `scenes`: a track of the clip's Scenes, given by the editor.
 * Clicking the ruler moves the playhead there.
 *
 * A Clip cut into Segments in the Advanced Edit (`cut`) is shown on its own timeline instead (its
 * `range` from 0 to its length): its Segments, which are trimmed there, read-only.
 */
export function Timeline({
  words,
  range,
  saved,
  sourceDuration,
  plan,
  playback,
  timing,
  scenes,
  onTrimDraft,
  onTrim,
  onTiming,
  onCaption,
  cut,
}: {
  // The Transcript's, on the Source's timeline.
  words: Word[];
  // The clip's range as shown: saved, or being dragged.
  range: Range;
  // As saved: the view is framed on it, so that it doesn't rescale under a drag.
  saved: Range;
  sourceDuration: number;
  plan: RenderPlan | null;
  playback: Playback;
  timing: HookTiming;
  scenes?: (geometry: Geometry) => ReactNode;
  onTrimDraft: (range: Range | null) => void;
  onTrim: (change: Partial<Range>) => Promise<boolean>;
  onTiming: (timing: HookTiming) => void;
  // A caption line clicked: its start, in seconds into the Clip.
  onCaption: (at: number) => void;
  // A cut Clip's Segments as played, and the Advanced Edit's address.
  cut?: { segments: PlayedSegment[]; to: string };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(0);
  const viewStart = Math.max(0, saved.start - CONTEXT_SECS);
  const viewEnd = Math.min(sourceDuration, saved.end + CONTEXT_SECS);
  const pps = (Math.max(width - LABEL_WIDTH, 100) / Math.max(viewEnd - viewStart, 1)) * ZOOMS[zoom];
  const geometry: Geometry = { viewStart, pps, clipStart: range.start };
  const x = (time: number) => (time - viewStart) * pps;

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The time under a pointer, on the Source's timeline.
  const timeAt = (clientX: number) => {
    const element = scroller.current!;
    const left = element.getBoundingClientRect().left + LABEL_WIDTH - element.scrollLeft;
    return viewStart + (clientX - left) / pps;
  };

  const total = (viewEnd - viewStart) * pps;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">Timeline</h4>
        {cut && (
          <Link to={cut.to} className={buttonClass("secondary", "xs", "mr-auto")}>
            <SlidersHorizontal aria-hidden size={14} />
            Edit in Advanced
          </Link>
        )}
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <Button size="icon" variant="ghost" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Zoom out">
            <Minus aria-hidden size={16} />
          </Button>
          <span className="w-10 text-center text-sm text-muted tabular-nums">{ZOOMS[zoom]}×</span>
          <Button size="icon" variant="ghost" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">
            <Plus aria-hidden size={16} />
          </Button>
        </div>
      </div>
      <div ref={scroller} className="relative overflow-x-auto overscroll-x-contain rounded-control bg-fill select-none">
        <div className="relative flex flex-col" style={{ width: total + LABEL_WIDTH }}>
          <Track label="">
            <Ruler viewStart={viewStart} viewEnd={viewEnd} pps={pps} onSeek={(time) => playback.seek(time - range.start)} timeAt={timeAt} />
          </Track>
          <Track label="Clip">
            {cut ? (
              <CutTrack segments={cut.segments} x={x} />
            ) : (
              <ClipTrack
                words={words}
                range={range}
                x={x}
                timeAt={timeAt}
                sourceDuration={sourceDuration}
                onTrimDraft={onTrimDraft}
                onTrim={onTrim}
              />
            )}
          </Track>
          {scenes && <Track label="Scenes">{scenes(geometry)}</Track>}
          <Track label="Captions">
            {plan?.captions.map((event, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  playback.seek(event.start);
                  onCaption(event.start);
                }}
                title={event.text}
                className="absolute inset-y-1 overflow-hidden rounded-md bg-surface-raised px-1 text-left text-xs leading-7 text-ellipsis whitespace-nowrap ring-1 ring-border hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
                style={{ left: x(range.start + event.start), width: Math.max(2, (event.end - event.start) * pps - 1) }}
              >
                {event.text}
              </button>
            ))}
          </Track>
          <Track label="Hook">
            {plan?.hook && (
              <HookBlock
                timing={timing}
                duration={range.end - range.start}
                left={x(range.start + plan.hook.start)}
                width={(plan.hook.end - plan.hook.start) * pps}
                pps={pps}
                text={plan.hook.lines.join(" ")}
                onTiming={onTiming}
              />
            )}
          </Track>
          <Playhead playback={playback} x={(time) => LABEL_WIDTH + x(range.start + time)} />
        </div>
      </div>
      {cut ? (
        <Hint more="Its Segments are trimmed, reordered and joined in the Advanced Edit.">
          Drag the hook to move it, its right edge to change how long it stays.
        </Hint>
      ) : (
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm text-muted">
            Drag the clip's edges to trim it (they snap to words), or focus one and use the arrow keys. Drag the hook to move it, its right edge to
            change how long it stays. With the Magnetic timeline on, a trim moves the hook and the Advanced Edit's layers with it.
          </p>
          <MagneticToggle />
        </div>
      )}
    </div>
  );
}

export interface Geometry {
  viewStart: number;
  // Pixels per second.
  pps: number;
  // The clip's start on the Source's timeline.
  clipStart: number;
}

function Track({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-9 border-b border-border last:border-b-0">
      <div className="sticky left-0 z-10 flex w-[72px] shrink-0 items-center bg-surface px-2 text-xs font-medium text-muted backdrop-blur">
        {label}
      </div>
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

// Ticks every 1, 5, 10 or 30 s, whichever leaves room for the labels; clicking moves the playhead.
function Ruler({
  viewStart,
  viewEnd,
  pps,
  onSeek,
  timeAt,
}: {
  viewStart: number;
  viewEnd: number;
  pps: number;
  onSeek: (time: number) => void;
  timeAt: (clientX: number) => number;
}) {
  const step = [1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 56) ?? 60;
  const ticks = [];
  for (let t = Math.ceil(viewStart / step) * step; t <= viewEnd; t += step) ticks.push(t);
  return (
    <div
      className="absolute inset-0 cursor-pointer"
      onPointerDown={(event) => onSeek(timeAt(event.clientX))}
      aria-hidden
    >
      {ticks.map((t) => (
        <span
          key={t}
          className="absolute top-0 bottom-0 border-l border-border pl-1 text-[11px] leading-9 text-muted tabular-nums"
          style={{ left: (t - viewStart) * pps }}
        >
          {formatClock(t)}
        </span>
      ))}
    </div>
  );
}

function Playhead({ playback, x }: { playback: Playback; x: (time: number) => number }) {
  const time = usePlayback(playback, (t) => Math.round(t * 20) / 20);
  return <div aria-hidden className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-accent" style={{ left: x(time) }} />;
}

/** The clip's range, with a handle at each edge that snaps to Word edges. */
function ClipTrack({
  words,
  range,
  x,
  timeAt,
  sourceDuration,
  onTrimDraft,
  onTrim,
}: {
  words: Word[];
  range: Range;
  x: (time: number) => number;
  timeAt: (clientX: number) => number;
  sourceDuration: number;
  onTrimDraft: (range: Range | null) => void;
  onTrim: (change: Partial<Range>) => Promise<boolean>;
}) {
  // The edge being dragged, and where it was when the drag began.
  const dragging = useRef<{ edge: "start" | "end"; from: number } | null>(null);

  // The Word edge for `edge` nearest `time` that keeps the clip a clip: a start before the end, an
  // end after the start, at most MAX_CLIP_SECS long.
  function snap(edge: "start" | "end", time: number): number | null {
    const edges =
      edge === "start"
        ? words.map((w) => w.start).filter((t) => t < range.end - 0.1 && range.end - t <= MAX_CLIP_SECS)
        : words.map((w) => Math.min(w.end, sourceDuration)).filter((t) => t > range.start + 0.1 && t - range.start <= MAX_CLIP_SECS);
    if (edges.length === 0) return null;
    return edges.reduce((best, t) => (Math.abs(t - time) < Math.abs(best - time) ? t : best));
  }

  // The Word edge one before or after the current one.
  function stepped(edge: "start" | "end", direction: 1 | -1): number | null {
    const current = range[edge];
    const edges = (edge === "start" ? words.map((w) => w.start) : words.map((w) => w.end)).filter((t) =>
      direction > 0 ? t > current + 0.01 : t < current - 0.01,
    );
    const next = direction > 0 ? edges[0] : edges[edges.length - 1];
    return next === undefined ? null : snap(edge, next);
  }

  async function commit(edge: "start" | "end", time: number) {
    await onTrim({ [edge]: time });
    onTrimDraft(null);
  }

  function handle(edge: "start" | "end") {
    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = { edge, from: range[edge] };
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
      if (dragging.current?.edge !== edge) return;
      const time = snap(edge, timeAt(event.clientX));
      if (time !== null) onTrimDraft({ ...range, [edge]: time });
    };
    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
      const drag = dragging.current;
      if (drag?.edge !== edge) return;
      dragging.current = null;
      const time = snap(edge, timeAt(event.clientX));
      if (time !== null && Math.abs(time - drag.from) > 0.005) void commit(edge, time);
      else onTrimDraft(null);
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const time = stepped(edge, event.key === "ArrowRight" ? 1 : -1);
      if (time !== null) {
        onTrimDraft({ ...range, [edge]: time });
        void commit(edge, time);
      }
    };
    return { onPointerDown, onPointerMove, onPointerUp, onKeyDown };
  }

  const left = x(range.start);
  const width = x(range.end) - left;
  return (
    <>
      <div className="absolute inset-y-1 rounded-md bg-accent/25 ring-1 ring-accent" style={{ left, width }} />
      {(["start", "end"] as const).map((edge) => (
        <div
          key={edge}
          role="slider"
          tabIndex={0}
          aria-label={edge === "start" ? "Clip start" : "Clip end"}
          aria-valuemin={0}
          aria-valuemax={sourceDuration}
          aria-valuenow={range[edge]}
          aria-valuetext={formatPrecise(range[edge])}
          {...handle(edge)}
          className={cx(
            "absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize touch-none rounded-sm",
            "after:absolute after:inset-y-1.5 after:left-1/2 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-accent",
            "focus-visible:outline-2 focus-visible:outline-focus",
          )}
          style={{ left: edge === "start" ? left : left + width }}
        />
      ))}
    </>
  );
}

/** A cut Clip's Segments, read-only, each labelled with where it starts in the episode. */
function CutTrack({ segments, x }: { segments: PlayedSegment[]; x: (time: number) => number }) {
  return (
    <>
      {segments.map((segment, i) => (
        <div
          key={i}
          title={segment.media ? "A video from the Media Library" : `${formatPrecise(segment.source_start)} – ${formatPrecise(segment.source_end)}`}
          className="absolute inset-y-1 overflow-hidden rounded-md bg-accent/20 px-1 text-xs leading-7 whitespace-nowrap ring-1 ring-accent/60"
          style={{ left: x(segment.start), width: Math.max(2, x(segment.end) - x(segment.start) - 1) }}
        >
          {segment.media ? "Video" : formatPrecise(segment.source_start)}
        </div>
      ))}
    </>
  );
}

/** The hook's time: dragged to move it, its right edge to resize it; arrow keys move it, with Shift resize it. */
function HookBlock({
  timing,
  duration,
  left,
  width,
  pps,
  text,
  onTiming,
}: {
  timing: HookTiming;
  duration: number;
  left: number;
  width: number;
  pps: number;
  text: string;
  onTiming: (timing: HookTiming) => void;
}) {
  const drag = useRef<{ kind: "move" | "resize"; x: number; from: HookTiming } | null>(null);
  const clampStart = (start: number) => Math.round(Math.min(Math.max(0, start), Math.max(0, duration - HOOK_MIN_SECS)) * 10) / 10;
  const clampSecs = (secs: number) => Math.round(Math.min(Math.max(HOOK_MIN_SECS, secs), HOOK_MAX_SECS) * 10) / 10;

  const start = (kind: "move" | "resize") => (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, x: event.clientX, from: timing };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const delta = (event.clientX - current.x) / pps;
    onTiming(
      current.kind === "move"
        ? { ...current.from, hook_start: clampStart(current.from.hook_start + delta) }
        : { ...current.from, hook_secs: clampSecs(current.from.hook_secs + delta) },
    );
  };
  const end = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? STEP_SECS : -STEP_SECS;
    onTiming(
      event.shiftKey
        ? { ...timing, hook_secs: clampSecs(timing.hook_secs + step) }
        : { ...timing, hook_start: clampStart(timing.hook_start + step) },
    );
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Hook: arrow keys move it, Shift with arrow keys changes how long it stays"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={timing.hook_start}
      aria-valuetext={`from ${timing.hook_start.toFixed(1)} s for ${timing.hook_secs.toFixed(1)} s`}
      onPointerDown={start("move")}
      onPointerMove={move}
      onPointerUp={end}
      onKeyDown={onKeyDown}
      className="absolute inset-y-1 cursor-grab touch-none overflow-hidden rounded-md bg-waiting-surface px-1 text-xs leading-7 whitespace-nowrap text-ellipsis ring-1 ring-waiting focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing"
      style={{ left, width: Math.max(8, width) }}
      title={text}
    >
      {text}
      <span
        aria-hidden
        onPointerDown={start("resize")}
        onPointerMove={move}
        onPointerUp={end}
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-waiting/40"
      />
    </div>
  );
}
