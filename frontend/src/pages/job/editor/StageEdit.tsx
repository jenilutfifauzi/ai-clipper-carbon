import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Box, RenderPlan } from "../../../api";
import { cx } from "../../../format";
import { usePlayback, type Playback } from "./playback";

// How far an arrow key nudges, in output pixels (with Shift, five times as far).
export const NUDGE_PX = 8;
// How near, in CSS pixels on screen, an edge or middle comes to a guide before it snaps to it.
const SNAP_CSS_PX = 6;
// Two taps on one item this close together edit it.
const DOUBLE_TAP_MS = 350;
// The guides: the frame's middle, and the platforms' safe area's top, bottom and right edges
// (planner.py's SAFE_AREA, y 232–1536 and x 0–950).
const GUIDES_X = { middle: 540, end: 950 };
const GUIDES_Y = { start: 232, middle: 960, end: 1536 };

const percent = (value: number) => `${value * 100}%`;

/**
 * Something drawn on the stage that can be selected, moved and nudged, resized from a corner when it
 * has a `size`, and edited (a double-click or double-tap, or Enter) when it has `onEdit`.
 */
export interface StageItem {
  id: string;
  // What it is called to a screen reader: "Hook", "Captions", "Text: …".
  label: string;
  // Where it is drawn and when, as planned, in output pixels and seconds into the Clip (one per
  // caption line for the captions).
  shows: { start: number; end: number; area: Box }[];
  // Its size now and the sizes it can be set to.
  size?: { now: number; min: number; max: number };
  // The highest and lowest its middle can be moved to (the planner keeps it there), if not the frame's.
  centreY?: [number, number];
  // Moved to `area` (as drawn), and resized to `size` (null: the size kept). Each gesture is one `group`.
  onPlace: (area: Box, size: number | null, group: string) => void;
  // Edited where it was double-tapped (output pixels), or from the keyboard (no point).
  onEdit?: (point?: { x: number; y: number }) => void;
}

type Held = { id: string; dx: number; dy: number; scale: number; plan: RenderPlan | null };
type Gesture = {
  id: string;
  pointer: number;
  kind: "move" | "size";
  // The area as drawn when it was grabbed, and where the pointer was.
  from: Box;
  grab: { x: number; y: number };
  group: string;
  moved: boolean;
};

let gestures = 0;

const centreOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * The gestures that move, resize and edit `items` on the stage. While one is under way, and until a
 * plan comes back after its last change, the item is drawn where it is being put: the plan comes from
 * the backend only once the draft changes (docs/adr/0001-backend-plans-frontend-draws.md).
 */
export function useStageEdit(
  plan: RenderPlan | null,
  stage: React.RefObject<HTMLDivElement | null>,
  items: StageItem[],
  selected: string | null,
  onSelect: (id: string) => void,
) {
  const [held, setHeld] = useState<Held | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  // Held while it is moved, and until a plan made after its last change comes.
  const holding = held && (gesture.current?.id === held.id || held.plan === plan) ? held : null;

  // The area as drawn: moved and scaled about its middle while held.
  function shown(id: string, area: Box): Box {
    if (holding?.id !== id) return area;
    const { scale, dx, dy } = holding;
    const width = area.width * scale;
    const height = area.height * scale;
    return { x: area.x + dx + (area.width - width) / 2, y: area.y + dy + (area.height - height) / 2, width, height };
  }

  // An SVG transform for what is drawn in `area` of item `id`, while it is held.
  function transform(id: string, area: Box): string | undefined {
    if (holding?.id !== id) return undefined;
    const { x, y } = centreOf(area);
    return `translate(${x + holding.dx} ${y + holding.dy}) scale(${holding.scale}) translate(${-x} ${-y})`;
  }

  // Where the pointer is, in output pixels, and how many of them a CSS pixel is.
  function at(pointer: PointerEvent): { x: number; y: number; unit: number } | null {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || !plan || !rect.width) return null;
    return {
      x: ((pointer.clientX - rect.left) / rect.width) * plan.width,
      y: ((pointer.clientY - rect.top) / rect.height) * plan.height,
      unit: plan.width / rect.width,
    };
  }

  // `item` put at `area` (from the plan's `planned` area), with `size`.
  function place(item: StageItem, planned: Box, area: Box, size: number | null, group: string) {
    const dx = area.x + area.width / 2 - (planned.x + planned.width / 2);
    const dy = area.y + area.height / 2 - (planned.y + planned.height / 2);
    const scale = area.width / planned.width;
    setHeld({ id: item.id, dx, dy, scale, plan });
    item.onPlace(
      { x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.width), height: Math.round(area.height) },
      size,
      group,
    );
  }

  // `from` moved by (dx, dy), kept in the frame (and its middle in `centreY`), and snapped to the
  // nearest guide within `reach`.
  function moved(from: Box, dx: number, dy: number, reach: number | null, centreY?: [number, number]) {
    if (!plan) return { area: from, snapped: { x: null, y: null } };
    const keepY = (y: number) => {
      const top = Math.min(Math.max(y, 0), plan.height - from.height);
      return centreY ? Math.min(Math.max(top, centreY[0] - from.height / 2), centreY[1] - from.height / 2) : top;
    };
    let x = Math.min(Math.max(from.x + dx, 0), plan.width - from.width);
    let y = keepY(from.y + dy);
    const snapped: { x: number | null; y: number | null } = { x: null, y: null };
    if (reach !== null) {
      // The guide nearest an edge or the middle, and how far that has to move to meet it.
      const nearest = (start: number, length: number, lines: { start?: number; middle: number; end: number }) => {
        let best: { line: number; by: number } | null = null;
        const pairs: [number | undefined, number][] = [
          [lines.start, start],
          [lines.middle, start + length / 2],
          [lines.end, start + length],
        ];
        for (const [line, edge] of pairs) {
          if (line === undefined || Math.abs(line - edge) > reach) continue;
          if (!best || Math.abs(line - edge) < Math.abs(best.by)) best = { line, by: line - edge };
        }
        return best;
      };
      const sx = nearest(x, from.width, GUIDES_X);
      const sy = nearest(y, from.height, GUIDES_Y);
      if (sx) [x, snapped.x] = [x + sx.by, sx.line];
      if (sy && keepY(y + sy.by) === y + sy.by) [y, snapped.y] = [y + sy.by, sy.line];
    }
    return { area: { ...from, x, y }, snapped };
  }

  function handlers(item: StageItem, planned: Box) {
    const start = (pointer: PointerEvent<HTMLElement>, kind: Gesture["kind"]) => {
      const point = at(pointer);
      if (!point || pointer.button !== 0) return;
      pointer.preventDefault();
      pointer.stopPropagation();
      pointer.currentTarget.setPointerCapture(pointer.pointerId);
      onSelect(item.id);
      gesture.current = {
        id: item.id,
        pointer: pointer.pointerId,
        kind,
        from: shown(item.id, planned),
        grab: point,
        group: `stage-${kind}:${++gestures}`,
        moved: false,
      };
    };
    const move = (pointer: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      const point = at(pointer);
      if (!current || current.id !== item.id || pointer.pointerId !== current.pointer || !point) return;
      current.moved = true;
      const { from, grab } = current;
      if (current.kind === "move") {
        const next = moved(from, point.x - grab.x, point.y - grab.y, pointer.altKey ? null : SNAP_CSS_PX * point.unit, item.centreY);
        setGuides(next.snapped);
        place(item, planned, next.area, null, current.group);
        return;
      }
      if (!item.size) return;
      // Grown by how much further from its middle the pointer is than where it was grabbed.
      const middle = centreOf(from);
      const reach = Math.max(Math.hypot(grab.x - middle.x, grab.y - middle.y), 1);
      const ratio = Math.hypot(point.x - middle.x, point.y - middle.y) / reach;
      const { now, min, max } = item.size;
      const shownScale = from.width / planned.width;
      const size = Math.round(Math.min(Math.max(now * shownScale * ratio, min), max));
      const scale = size / (now * shownScale);
      const width = from.width * scale;
      const height = from.height * scale;
      place(item, planned, { x: middle.x - width / 2, y: middle.y - height / 2, width, height }, size, current.group);
    };
    const end = (pointer: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (current?.pointer !== pointer.pointerId) return;
      gesture.current = null;
      setGuides(null);
      // Re-drawn now that the gesture is over: held only until the next plan.
      setHeld((old) => (old ? { ...old } : old));
      if (current.moved || current.kind !== "move" || !item.onEdit) return;
      const now = performance.now();
      if (lastTap.current?.id === item.id && now - lastTap.current.at < DOUBLE_TAP_MS) {
        lastTap.current = null;
        const point = at(pointer);
        item.onEdit(point ? { x: point.x, y: point.y } : undefined);
      } else {
        lastTap.current = { id: item.id, at: now };
      }
    };
    const cancel = () => {
      gesture.current = null;
      setGuides(null);
      setHeld(null);
    };
    return {
      move: {
        onPointerDown: (pointer: PointerEvent<HTMLElement>) => start(pointer, "move"),
        onPointerMove: move,
        onPointerUp: end,
        onPointerCancel: cancel,
        onKeyDown: (key: KeyboardEvent<HTMLElement>) => {
          if (key.key === "Enter" && item.onEdit) {
            key.preventDefault();
            item.onEdit();
            return;
          }
          const step = key.shiftKey ? NUDGE_PX * 5 : NUDGE_PX;
          const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key.key];
          if (!delta) return;
          key.preventDefault();
          const from = shown(item.id, planned);
          const next = moved(from, delta[0], delta[1], null, item.centreY).area;
          if (next.x !== from.x || next.y !== from.y) place(item, planned, next, null, `stage-nudge:${item.id}`);
        },
      },
      size: {
        onPointerDown: (pointer: PointerEvent<HTMLElement>) => start(pointer, "size"),
        onPointerMove: move,
        onPointerUp: end,
        onPointerCancel: cancel,
      },
    };
  }

  return { items, selected, guides, shown, transform, handlers };
}

export type StageEdit = ReturnType<typeof useStageEdit>;

/**
 * A handle over each item on screen now (and over the selected one, faded, when it has one place and
 * isn't on screen), to select, move, nudge and edit it; the selected one outlined, with a corner to
 * resize it by when it has a size. The guides it snaps to, while it does.
 */
export function StageHandles({ plan, playback, edit }: { plan: RenderPlan; playback: Playback; edit: StageEdit }) {
  const on = usePlayback(playback, (time) =>
    edit.items.map((item) => item.shows.findIndex((show) => show.start <= time && time < show.end)).join(","),
  );
  const shownAt = on.split(",").map(Number);
  return (
    <>
      {edit.items.map((item, i) => {
        const selected = item.id === edit.selected;
        const index = shownAt[i] ?? -1;
        const show = index >= 0 ? item.shows[index] : selected && item.shows.length === 1 ? item.shows[0] : null;
        if (!show) return null;
        const area = edit.shown(item.id, show.area);
        const { move, size } = edit.handlers(item, show.area);
        const hints = ["drag to move it, or use the arrow keys", item.onEdit && "double-click or press Enter to edit its words"];
        return (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            aria-roledescription="movable item"
            aria-label={`${item.label}: ${hints.filter(Boolean).join("; ")}`}
            aria-pressed={selected}
            {...move}
            className={cx(
              "absolute cursor-move touch-none rounded-[4px] focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-solid",
              selected ? "outline-2 outline-white outline-dashed" : "hover:outline-1 hover:outline-white/70 hover:outline-dashed",
              index < 0 && "opacity-40",
            )}
            style={{
              left: percent(area.x / plan.width),
              top: percent(area.y / plan.height),
              width: percent(area.width / plan.width),
              height: percent(area.height / plan.height),
            }}
          >
            {selected &&
              item.size &&
              (["-top-1.5 -left-1.5 cursor-nwse-resize", "-top-1.5 -right-1.5 cursor-nesw-resize", "-bottom-1.5 -left-1.5 cursor-nesw-resize", "-right-1.5 -bottom-1.5 cursor-nwse-resize"] as const).map(
                (corner) => (
                  <span
                    key={corner}
                    aria-hidden
                    data-corner
                    {...size}
                    className={cx(
                      "absolute size-3 touch-none rounded-full border-2 border-white bg-accent shadow-sm",
                      // A hit area larger than the dot, larger still under a finger.
                      "before:absolute before:-inset-2 before:content-[''] pointer-coarse:before:-inset-3.5",
                      corner,
                    )}
                  />
                ),
              )}
          </div>
        );
      })}
      {edit.guides?.x != null && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: percent(edit.guides.x / plan.width) }} />
      )}
      {edit.guides?.y != null && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 h-px bg-accent" style={{ top: percent(edit.guides.y / plan.height) }} />
      )}
    </>
  );
}
