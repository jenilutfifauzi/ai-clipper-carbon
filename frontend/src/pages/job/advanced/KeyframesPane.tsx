import { useRef, useState, type PointerEvent } from "react";
import type { Ease, Keyframe, KeyProperty, MediaItem } from "../../../api";
import { Button } from "../../../components/Button";
import { cx } from "../../../format";
import { valueAt } from "../editor/keyframes";
import { usePlayback } from "../editor/playback";
import { curvePath, curveRange, easeHandles, handleShares, plotPoint, plotValue, type Plot, type PlotPoint } from "./curves";
import { easedKey, easeName, handleEase, keyAt, keyedRange, moveKey, setEase, type EaseName, type KeyGrid } from "./keyActions";
import { applyKeyed, KeyCluster, useKeyTime, usePickedKeyed, type Keying } from "./KeyCluster";
import { EaseSelect, KEY_FIELDS } from "./KeyEase";
import { activeKey, clearItemKeys, heldKeyTime, keyedGroup, keyedItem, keyRows, keyTime, refName, setItemKeys, writeItemKey, type KeyedItem, type KeyedRef } from "./keying";
import { onFrame } from "./playhead";

/**
 * The Keyframes pane (ADR 0008), the desktop's bottom tab beside the Timeline: the Keyframes of the
 * one picked Overlay, Music Clip, video Segment or Manual Scene, with room to work on them. A row per property it can key (its
 * value at the playhead, and its own ‹ ◆ ›), and over the item's own seconds either the Dopesheet (a
 * lane per row, its diamonds dragged to retime them) or the Curves (each keyed row's value over time;
 * the active row's Keyframes dragged in time and value, and its Eases' handles). Its tool strip
 * switches the view, keys the active row, sets the Ease of the Keyframe at the playhead (or of the
 * next eased one) and clears every Keyframe. Each drag, and Clear all, is one step of undo; the
 * edits are off while the playhead is outside the item, and pressing a Keyframe brings it there.
 */
export function KeyframesPane({ keying, fps, mediaById }: { keying: Keying; fps: number; mediaById: Map<string, MediaItem> }) {
  // A Segment of the Source picked: its Manual Scene under the playhead, framed by its own override.
  const ref = usePickedKeyed(keying, keying.playback);
  // A Segment of the Source has none: keyedItem gives null for it.
  const item = ref && keyedItem(keying.edits, ref, keying.track, keying.plan);
  if (!ref || !item) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-4">
        <p className="text-sm text-muted">Pick one item to edit its Keyframes</p>
      </div>
    );
  }
  return <Pane key={refName(ref)} keying={keying} fps={fps} item={ref} keyed={item} rows={keyRows(keying.edits, ref, mediaById)} />;
}

// A row's height, in CSS pixels: the rows' column and the Dopesheet's lanes line up by it.
const ROW_PX = 32;

let gestures = 0;

// A drag under way: of a Keyframe (in a lane, or a dot of the Curves) or an Ease handle, from the
// Keyframes it began with, and the plot it began over (held still while it lasts).
type Drag = {
  pointer: number;
  group: string;
  prop: KeyProperty;
  index: number;
  list: Keyframe[];
  x: number;
  y: number;
  // The lane's or the plot's box on screen.
  box: DOMRect;
  plot: Plot;
  handle?: 1 | 2;
  // Whether it has gone further than a click's wobble: until then, nothing changes.
  moved: boolean;
};

// A press that moves less than this, in CSS pixels, is a click.
const SLOP_PX = 3;

function Pane({ keying, fps, item: ref, keyed, rows }: { keying: Keying; fps: number; item: KeyedRef; keyed: KeyedItem; rows: KeyProperty[] }) {
  const [view, setView] = useState<"dopesheet" | "curves">("dopesheet");
  const time = useKeyTime(keying.playback);
  const at = keyTime(keyed, time);
  const held = at ?? heldKeyTime(keyed, time);
  const active = activeKey(rows, keyed.keys, keying.touched ?? null);
  const drag = useRef<Drag | null>(null);
  const grid: KeyGrid = { fps, start: keyed.start, secs: keyed.secs };
  const listOf = (prop: KeyProperty) => keyed.keys[prop] ?? [];
  // Each keyed row's plot, its own range; the one being dragged over keeps the one it began with.
  const plotOf = (prop: KeyProperty): Plot => {
    if (drag.current?.prop === prop) return drag.current.plot;
    const [low, high] = curveRange(prop, listOf(prop));
    return { secs: keyed.secs, low, high };
  };
  const seek = (secs: number) => keying.playback.seek(keyed.start + Math.min(Math.max(secs, keyed.first ?? 0), keyed.secs));
  const save = (prop: KeyProperty, list: Keyframe[], group?: string) => {
    const outcome = setItemKeys(keying, ref, prop, list);
    if (outcome) keying.onEdits(outcome.edits, group);
  };

  // The Ease the strip shows: of the active row's Keyframe at the playhead, or the next eased one.
  const activeList = listOf(active);
  const eased = easedKey(activeList, held);
  const easeShown: EaseName | null = eased >= 0 ? easeName(activeList[eased].ease) : null;
  const anyKeys = rows.some((prop) => listOf(prop).length);

  // A press on a Keyframe or a handle: the drag starts from where it is, and the playhead goes to the Keyframe.
  function startDrag(event: PointerEvent, prop: KeyProperty, index: number, box: Element, handle?: 1 | 2) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    keying.onTouch?.(prop);
    const list = listOf(prop);
    drag.current = { pointer: event.pointerId, group: `drag:keyframes:${++gestures}`, prop, index, list, x: event.clientX, y: event.clientY, box: box.getBoundingClientRect(), plot: plotOf(prop), handle, moved: false };
    if (!handle) seek(list[index].at);
  }
  function moveDrag(event: PointerEvent, curves: boolean) {
    const gesture = drag.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    const { box, plot, list, index, prop } = gesture;
    gesture.moved ||= Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > SLOP_PX;
    if (!gesture.moved) return;
    if (gesture.handle) {
      const point: PlotPoint = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
      const shares = handleShares(list, index, plot, point);
      const ease: Ease = list[index].ease;
      const y = shares.y ?? ease[gesture.handle === 1 ? 1 : 3];
      save(prop, setEase(list, index, handleEase(ease, gesture.handle, shares.x, y)), gesture.group);
      return;
    }
    const to = list[index].at + ((event.clientX - gesture.x) / box.width) * keyed.secs;
    const start = plotPoint(plot, list[index].at, list[index].value).y;
    // In the Curves, its value too: held to the plot, to a thousandth of its range (a power of ten).
    const digits = Math.max(0, -Math.floor(Math.log10(Math.max(plot.high - plot.low, 1e-6) / 1000)));
    const dragged = plotValue(plot, Math.min(Math.max(start + (event.clientY - gesture.y) / box.height, 0), 1));
    const value = curves ? { prop, value: Number(dragged.toFixed(digits)) } : undefined;
    const moved = moveKey(list, index, to, grid, value);
    save(prop, moved, gesture.group);
    seek(moved[index].at);
  }
  const endDrag = (event: PointerEvent) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };
  const dragging = (curves: boolean) => ({
    onPointerMove: (event: PointerEvent) => moveDrag(event, curves),
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onMouseDown={(event) => {
        // As on the Timeline: a press on a button here doesn't take the keyboard focus, so that the
        // arrow keys and Space stay the playhead's.
        if (!(event.target as HTMLElement).closest("button")) return;
        event.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <div className="flex min-h-11 shrink-0 items-center gap-3 border-b border-border px-2">
        <div role="group" aria-label="View" className="flex rounded-[10px] bg-fill p-0.5">
          {(["dopesheet", "curves"] as const).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={view === name}
              onClick={() => setView(name)}
              className={cx("min-h-8 rounded-lg px-2.5 text-sm font-medium", view === name ? "raised text-text" : "text-muted hover:text-text")}
            >
              {name === "dopesheet" ? "Dopesheet" : "Curves"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted">{KEY_FIELDS[active].label}</span>
          <KeyCluster item={ref} property={active} label={KEY_FIELDS[active].label} />
        </div>
        <EaseSelect
          value={easeShown}
          disabled={easeShown === null || at === null}
          onChange={(ease) => save(active, setEase(activeList, eased, ease))}
        />
        {at === null && <p className="text-sm text-muted">Put the playhead on the item to change its Keyframes.</p>}
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          disabled={!anyKeys || at === null}
          onClick={() => {
            const outcome = clearItemKeys(keying, ref, time);
            if (outcome) keying.onEdits(outcome.edits);
          }}
        >
          Clear all Keyframes
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full">
          <div className="w-72 shrink-0 border-r border-border">
            <div className="h-7 border-b border-border" />
            {rows.map((prop) => (
              <Row
                key={prop}
                keying={keying}
                item={ref}
                keyed={keyed}
                prop={prop}
                active={prop === active}
                value={valueAt(listOf(prop), held, keyed.constant(prop))}
                off={!!listOf(prop).length && at === null}
                at={at}
                time={time}
              />
            ))}
          </div>
          <div className="relative flex min-w-0 flex-1 flex-col px-4">
            <Ruler secs={keyed.secs} onSeek={seek} />
            {view === "dopesheet" ? (
              rows.map((prop) => (
                <div
                  key={prop}
                  className={cx("relative border-b border-border/60", prop === active && "bg-accent/5")}
                  style={{ height: ROW_PX }}
                  onPointerDown={() => keying.onTouch?.(prop)}
                >
                  <div className={cx("absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full", listOf(prop).length ? "bg-border" : "bg-border/40")} />
                  {listOf(prop).map((key, index) => (
                    <button
                      key={index}
                      type="button"
                      aria-label={`${KEY_FIELDS[prop].label} Keyframe at ${key.at.toFixed(2)} s`}
                      title="Click to go to it, drag to move it"
                      className="absolute top-1/2 grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none place-items-center text-accent-text"
                      style={{ left: `${(key.at / keyed.secs) * 100}%` }}
                      onClick={() => seek(key.at)}
                      onPointerDown={(event) => startDrag(event, prop, index, event.currentTarget.parentElement!)}
                      {...dragging(false)}
                    >
                      <DiamondMark filled={at !== null && keyAt(listOf(prop), at) === index} />
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <Curves
                rows={rows}
                active={active}
                listOf={listOf}
                plotOf={plotOf}
                at={at}
                onSeek={seek}
                startDrag={startDrag}
                dragging={dragging(true)}
                minHeight={rows.length * ROW_PX}
              />
            )}
            <PaneHead playback={keying.playback} fps={fps} keyed={keyed} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DiamondMark({ filled, small }: { filled: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx("block rotate-45 rounded-[2px] border-[1.5px] border-current", small ? "size-2" : "size-2.5", filled ? "bg-current" : "bg-surface-raised")}
    />
  );
}

// The playhead over the ruler and the views, where it is in the item; not drawn outside it.
function PaneHead({ playback, fps, keyed }: { playback: Keying["playback"]; fps: number; keyed: KeyedItem }) {
  const time = usePlayback(playback, (t) => onFrame(t, fps));
  const share = (time - keyed.start) / keyed.secs;
  if (!(share >= 0 && share <= 1)) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 right-4 left-4">
      <div className="absolute inset-y-0 z-20 w-0.5 -translate-x-1/2 bg-text" style={{ left: `${share * 100}%` }}>
        <span className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-xs bg-text" />
      </div>
    </div>
  );
}

/** The ruler in the item's own seconds: a press or a drag on it moves the playhead there. */
function Ruler({ secs, onSeek }: { secs: number; onSeek: (secs: number) => void }) {
  const pointer = useRef<number | null>(null);
  const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => secs / s <= 8) ?? 60;
  const ticks = [];
  for (let t = 0; t <= secs + 1e-6; t += step) ticks.push(Math.round(t * 100) / 100);
  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - box.left) / box.width) * secs);
  };
  return (
    <div
      aria-hidden
      className="relative h-7 shrink-0 cursor-pointer touch-none border-b border-border"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = event.pointerId;
        seekAt(event);
      }}
      onPointerMove={(event) => pointer.current === event.pointerId && seekAt(event)}
      onPointerUp={() => (pointer.current = null)}
      onPointerCancel={() => (pointer.current = null)}
    >
      {ticks.map((t) => (
        <span key={t} className="absolute top-0 bottom-0 border-l border-border pl-1 text-[11px] leading-7 text-muted tabular-nums" style={{ left: `${(t / secs) * 100}%` }}>
          {step < 1 ? t.toFixed(step < 0.25 ? 1 : 2).replace(/0$/, "") : t}s
        </span>
      ))}
    </div>
  );
}

/**
 * The Curves: every keyed row's curve, faint, each over its own range, and the active row's bold,
 * with its range's labels, its Keyframes as dots dragged in time and value, and two Ease handles per
 * span. A dot pressed takes the playhead to it.
 */
function Curves({
  rows,
  active,
  listOf,
  plotOf,
  at,
  onSeek,
  startDrag,
  dragging,
  minHeight,
}: {
  rows: KeyProperty[];
  active: KeyProperty;
  listOf: (prop: KeyProperty) => Keyframe[];
  plotOf: (prop: KeyProperty) => Plot;
  at: number | null;
  onSeek: (secs: number) => void;
  startDrag: (event: PointerEvent, prop: KeyProperty, index: number, box: Element, handle?: 1 | 2) => void;
  dragging: { onPointerMove: (event: PointerEvent) => void; onPointerUp: (event: PointerEvent) => void; onPointerCancel: (event: PointerEvent) => void };
  minHeight: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const list = listOf(active);
  const plot = plotOf(active);
  const { label, unit, scale } = KEY_FIELDS[active];
  const shown = (value: number) => `${Math.round(value * scale * 10) / 10}${unit}`;
  const percent = (point: PlotPoint) => ({ left: `${point.x * 100}%`, top: `${point.y * 100}%` });
  const spans = list.map((_, index) => easeHandles(list, index, plot)).filter((span) => span !== null);
  return (
    <div className="relative flex-1 py-4" style={{ minHeight }}>
      <div ref={box} className="relative h-full">
        <svg aria-hidden className="absolute inset-0 size-full overflow-visible" viewBox="0 0 1 1" preserveAspectRatio="none">
          {[0, 0.25, 0.5, 0.75, 1].map((y) => (
            <line key={y} x1={0} x2={1} y1={y} y2={y} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={y % 1 ? 0.5 : 1} />
          ))}
          {rows
            .filter((prop) => prop !== active && listOf(prop).length)
            .map((prop) => (
              <path key={prop} d={curvePath(listOf(prop), plotOf(prop))} fill="none" className="stroke-accent" strokeWidth={1} opacity={0.3} vectorEffect="non-scaling-stroke" />
            ))}
          {list.length > 0 && <path d={curvePath(list, plot)} fill="none" className="stroke-accent" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
          {spans.map((span, index) => (
            <g key={index} className="stroke-muted" strokeWidth={1} vectorEffect="non-scaling-stroke">
              <line x1={span.from.x} y1={span.from.y} x2={span.first.x} y2={span.first.y} vectorEffect="non-scaling-stroke" />
              <line x1={span.to.x} y1={span.to.y} x2={span.second.x} y2={span.second.y} vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
        {list.length > 0 ? (
          <>
            <span className="pointer-events-none absolute top-0 left-1 -translate-y-full text-[11px] text-muted tabular-nums">{shown(plot.high)}</span>
            <span className="pointer-events-none absolute bottom-0 left-1 translate-y-full text-[11px] text-muted tabular-nums">{shown(plot.low)}</span>
          </>
        ) : (
          <p className="absolute inset-0 grid place-items-center text-sm text-muted">{label} has no Keyframes: its ◆ adds one at the playhead.</p>
        )}
        {/* A handle can sit on its Keyframe's dot (a Linear span's do): it is over the dot, and smaller, so both can be taken. */}
        {spans.map((span, index) =>
          ([1, 2] as const).map((handle) => (
            <button
              key={`${index}:${handle}`}
              type="button"
              aria-label={`${label}: Ease handle ${handle} of the span to Keyframe ${index + 2}`}
              title="Drag to shape the Ease"
              className="absolute z-20 grid size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none place-items-center"
              style={percent(handle === 1 ? span.first : span.second)}
              onPointerDown={(event) => startDrag(event, active, index + 1, box.current!, handle)}
              {...dragging}
            >
              <span aria-hidden className="block size-2 rounded-[2px] bg-muted" />
            </button>
          )),
        )}
        {list.map((key, index) => (
          <button
            key={index}
            type="button"
            aria-label={`${label} Keyframe at ${key.at.toFixed(2)} s, ${shown(key.value)}`}
            title="Click to go to it, drag to move it in time and value"
            className="absolute z-10 grid size-6 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none place-items-center text-accent-text"
            style={percent(plotPoint(plot, key.at, key.value))}
            onClick={() => onSeek(key.at)}
            onPointerDown={(event) => startDrag(event, active, index, box.current!)}
            {...dragging}
          >
            <span aria-hidden className={cx("block size-3 rounded-full border-2 border-current", at !== null && keyAt(list, at) === index ? "bg-current" : "bg-surface-raised")} />
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A row of the pane: its property's value at the playhead, typed in (auto-keyed as in the inspector:
 * a Keyframe at the playhead once it has some, else its constant), and its own ‹ ◆ ›. Clicking it
 * makes it the active row.
 */
function Row({
  keying,
  item,
  keyed,
  prop,
  active,
  value,
  off,
  at,
  time,
}: {
  keying: Keying;
  item: KeyedRef;
  keyed: KeyedItem;
  prop: KeyProperty;
  active: boolean;
  value: number;
  off: boolean;
  at: number | null;
  time: number;
}) {
  const { label, unit, scale } = KEY_FIELDS[prop];
  const isKeyed = !!keyed.keys[prop]?.length;
  // A keyed turn may go further than the Transform's own ±360°.
  const [low, high] = keyedRange(prop, isKeyed);
  const write = (shown: number) => {
    const outcome = writeItemKey(keying, item, prop, Math.min(Math.max(shown / scale, low), high), time);
    applyKeyed(keying, outcome, keyedGroup(`keyframes:${refName(item)}:${prop}`, isKeyed, at));
  };
  return (
    <div
      className={cx("flex items-center gap-2 border-b border-border/60 pr-1 pl-3", active && "bg-accent/10")}
      style={{ height: ROW_PX }}
      onPointerDown={() => keying.onTouch?.(prop)}
    >
      <span className={cx("w-16 shrink-0 text-sm", active ? "font-semibold text-text" : "text-muted")}>{label}</span>
      <ValueField label={label} unit={unit} value={value * scale} range={[low * scale, high * scale]} disabled={off} onChange={write} />
      <KeyCluster item={item} property={prop} label={label} />
    </div>
  );
}

/** A number typed in, as the inspector's: kept within `range`, shown to a tenth, what is typed kept while it has the focus. */
function ValueField({
  label,
  unit,
  value,
  range,
  disabled,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  range: readonly [number, number];
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className="relative min-w-0 flex-1">
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        min={range[0]}
        max={range[1]}
        disabled={disabled}
        value={typed ?? String(Math.round(value * 10) / 10)}
        onChange={(event) => {
          setTyped(event.target.value);
          const number = event.target.valueAsNumber;
          if (Number.isFinite(number)) onChange(Math.min(Math.max(number, range[0]), range[1]));
        }}
        onBlur={() => setTyped(null)}
        className="h-7 w-full min-w-0 rounded-lg border border-border bg-fill py-1 pr-7 pl-2 text-sm text-text tabular-nums disabled:opacity-50"
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2 grid place-items-center text-xs text-muted">
        {unit}
      </span>
    </div>
  );
}
