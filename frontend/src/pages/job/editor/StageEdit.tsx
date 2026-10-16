import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Box, Picture, RenderPlan, Transform } from "../../../api";
import { cx } from "../../../format";
import { dragged, moved as movedPicture, offsetOnPicture, type Grabbed, type Grip, type Point } from "./pictureGestures";
import { useShown, type Playback } from "./playback";
import { GUIDES_X, GUIDES_Y, guideTargets, snapMoved, snapScaled, SNAP_CSS_PX, type SmartGuides } from "./smartGuides";
import { fittedOf, gripCursor, gripsOnFrame, heldPicture, tidyTransform } from "./stagePicture";

// How far an arrow key nudges, in output pixels (with Shift, five times as far).
export const NUDGE_PX = 8;
// How far, in CSS pixels on screen, a pointer goes before a press is a drag, not a tap.
const DRAG_CSS_PX = 4;
// Two taps on one item this close together edit it.
const DOUBLE_TAP_MS = 350;

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
  // The highest and lowest its middle can be moved to (the planner keeps it there), if not the
  // frame's.
  centreY?: [number, number];
  // Moved to `area` (as drawn), and resized to `size` (null: the size kept). Each gesture is one
  // `group`.
  onPlace: (area: Box, size: number | null, group: string) => void;
  // Edited where it was double-tapped (output pixels), or from the keyboard (no point).
  onEdit?: (point?: { x: number; y: number }) => void;
}

/**
 * A picture drawn on the stage (ADR 0007): an Overlay ("overlay:<id>"), or the picture behind every
 * Overlay ("picture:<n>": the Segment under the playhead, at the plan's Scene n). It is picked, moved and nudged as the other
 * items are and, picked alone, scaled from its corners, stretched from its edges and turned by the
 * handle above it: its Grips (GLOSSARY.md), on the picture as turned.
 */
export interface StagePicture {
  id: string;
  label: string;
  // When it shows, in seconds into the Clip, and as planned: null for an automatic Scene's, which is
  // only outlined, as the frame.
  start: number;
  end: number;
  picture: Picture | null;
  // Its Transform as saved, what a gesture starts from: null where it has none to set here.
  transform: Transform | null;
  // The picture behind: the whole frame picks it, and it moves by itself, never with the others picked.
  behind?: boolean;
  // Put where a gesture leaves it, once, at its end: one `group` of changes.
  onTransform: (transform: Transform, group: string) => void;
}

// Held where a gesture put it: a text's area moved by (dx, dy) and scaled by `scale` about its
// middle, or a picture drawn by `transform` (its centre (dx, dy) from the plan's); until `plan` is
// no longer the plan, once the gesture is over.
type Held = { id: string; kind: "move" | "size"; dx: number; dy: number; scale: number; transform: Transform | null; plan: RenderPlan | null };

/**
 * How far the picked items that follow a moved one are drawn from where the plan has them, in output
 * pixels, and the one they follow.
 */
export type Drift = { lead: string; dx: number; dy: number };
type Gesture = {
  id: string;
  pointer: number;
  kind: "move" | "size";
  // The area as drawn when it was grabbed (a picture's bounds), and where the pointer was.
  from: Box;
  grab: { x: number; y: number };
  group: string;
  moved: boolean;
  // Grabbed as one of several picked, which move with it.
  together: boolean;
  // A picture's: by its body or a Grip, from its Transform when grabbed, and where it is now.
  picture?: { grip: Grip | "body"; grabbed: Grabbed; now: Transform };
};

let gestures = 0;

const centreOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * The gestures that move, resize and edit `items`, and move and transform `pictures`, on the stage.
 * While one is under way, and until a plan comes back after its last change, the item is drawn where
 * it is being put: the plan comes from the backend only once the draft changes
 * (docs/adr/0001-backend-plans-frontend-draws.md). A text's gesture saves as it goes, each change in
 * one group; a picture's saves once, when it is let go.
 *
 * `picked` are the ids picked: a click picks an item alone, or with Shift, Cmd or Ctrl (`toggle`)
 * adds it or takes it out. When several are picked, moving one draws the others moved as far
 * (`drift`), but for the picture behind, which moves alone; only one picked alone can be resized or
 * transformed by its Grips.
 *
 * A text snaps to the fixed guides. A picture moved, or scaled from a corner, snaps to its Smart
 * Guides (GLOSSARY.md): the frame, the fixed guides and the pictures `atPlayhead` (`picturesAt`)
 * but those moving with it. Alt turns snapping off; `guides` are the lines of a snap.
 */
export function useStageEdit(
  plan: RenderPlan | null,
  stage: React.RefObject<HTMLDivElement | null>,
  items: StageItem[],
  pictures: StagePicture[],
  picked: string[],
  onSelect: (id: string, toggle: boolean) => void,
  atPlayhead: () => { id: string; picture: Picture }[] = () => [],
) {
  const [held, setHeld] = useState<Held | null>(null);
  const [guides, setGuides] = useState<SmartGuides | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  // Held while it is moved, and until a plan made after its last change comes.
  const holding = held && (gesture.current?.id === held.id || held.plan === plan) ? held : null;
  const alone = new Set(pictures.filter((picture) => picture.behind).map((picture) => picture.id));
  const drift: Drift | null =
    holding?.kind === "move" && picked.length > 1 && picked.includes(holding.id) && !alone.has(holding.id)
      ? { lead: holding.id, dx: holding.dx, dy: holding.dy }
      : null;
  const follows = (id: string) => !!drift && drift.lead !== id && picked.includes(id) && !alone.has(id);

  // The area as drawn: moved and scaled about its middle while held, or moved with the one held.
  function shown(id: string, area: Box): Box {
    if (follows(id)) return { ...area, x: area.x + drift!.dx, y: area.y + drift!.dy };
    if (holding?.id !== id) return area;
    const { scale, dx, dy } = holding;
    const width = area.width * scale;
    const height = area.height * scale;
    return { x: area.x + dx + (area.width - width) / 2, y: area.y + dy + (area.height - height) / 2, width, height };
  }

  // Picture `id` of the plan as drawn: from the Transform it is held at, or moved with the one held.
  function shownPicture(id: string, picture: Picture): Picture {
    if (follows(id)) {
      const { dx, dy } = drift!;
      const bounds = { ...picture.bounds, x: picture.bounds.x + dx, y: picture.bounds.y + dy };
      return { ...picture, centre: [picture.centre[0] + dx, picture.centre[1] + dy], bounds };
    }
    if (holding?.id !== id || !holding.transform || !plan) return picture;
    return heldPicture(picture, holding.transform, plan);
  }

  // An SVG transform for what is drawn in `area` of item `id`, while it is held.
  function transform(id: string, area: Box): string | undefined {
    if (follows(id)) return `translate(${drift!.dx} ${drift!.dy})`;
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
    setHeld({ id: item.id, kind: size === null ? "move" : "size", dx, dy, scale, transform: null, plan });
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
      if (pointer.shiftKey || pointer.metaKey || pointer.ctrlKey) {
        onSelect(item.id, true);
        return;
      }
      pointer.currentTarget.setPointerCapture(pointer.pointerId);
      const together = picked.length > 1 && picked.includes(item.id);
      if (!together) onSelect(item.id, false);
      gesture.current = {
        id: item.id,
        pointer: pointer.pointerId,
        kind,
        from: shown(item.id, planned),
        grab: point,
        group: `drag:stage-${kind}:${++gestures}`,
        moved: false,
        together,
      };
    };
    const move = (pointer: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      const point = at(pointer);
      if (!current || current.id !== item.id || pointer.pointerId !== current.pointer || !point) return;
      const { from, grab } = current;
      // A tap's jitter (a finger's, a shaky mouse's) leaves it where it is.
      if (!current.moved && Math.hypot(point.x - grab.x, point.y - grab.y) < DRAG_CSS_PX * point.unit) return;
      current.moved = true;
      if (current.kind === "move") {
        const next = moved(from, point.x - grab.x, point.y - grab.y, pointer.altKey ? null : SNAP_CSS_PX * point.unit, item.centreY);
        const { x, y } = next.snapped;
        setGuides({ x: x === null ? [] : [x], y: y === null ? [] : [y] });
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
      // A click on one of several picked picks it alone.
      if (!current.moved && current.together) onSelect(item.id, false);
      if (current.moved || current.kind !== "move" || !item.onEdit) return;
      const now = performance.now();
      if (lastTap.current?.id === item.id && now - lastTap.current.at < DOUBLE_TAP_MS) {
        lastTap.current = null;
        // Where that is on what the plan draws, if it is drawn elsewhere until the next plan.
        const point = at(pointer);
        const off = holding?.id === item.id ? holding : { dx: 0, dy: 0 };
        item.onEdit(point ? { x: point.x - off.dx, y: point.y - off.dy } : undefined);
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

  // `item` drawn by `transform` (moved, or resized: `kind`), until the next plan once it is let go.
  function hold(item: StagePicture, transform: Transform, kind: Held["kind"]) {
    const [x, y] = item.picture?.centre ?? [transform.x, transform.y];
    setHeld({ id: item.id, kind, dx: transform.x - x, dy: transform.y - y, scale: 1, transform, plan });
  }

  // `item` put at `transform` and saved, as `group`: nothing when it is there already.
  function commit(item: StagePicture, transform: Transform, kind: Held["kind"], group: string) {
    const next = tidyTransform(transform);
    if (item.transform && JSON.stringify(next) === JSON.stringify(item.transform)) {
      setHeld(null);
      return;
    }
    hold(item, next, kind);
    item.onTransform(next, group);
  }

  function pictureHandlers(item: StagePicture) {
    // Whether `point` is on the picture as drawn, not on the frame around it.
    const onPicture = (point: { x: number; y: number }) => {
      if (!item.picture) return false;
      const drawn = shownPicture(item.id, item.picture);
      const [x, y] = drawn.centre;
      const { along, down } = offsetOnPicture({ x, y, rotation: drawn.rotation }, point);
      return Math.abs(along) <= drawn.width / 2 && Math.abs(down) <= drawn.height / 2;
    };
    const start = (pointer: PointerEvent<HTMLElement>, grip: Grip | "body") => {
      const point = at(pointer);
      if (!point || !plan || pointer.button !== 0) return;
      pointer.preventDefault();
      pointer.stopPropagation();
      if (pointer.shiftKey || pointer.metaKey || pointer.ctrlKey) {
        onSelect(item.id, true);
        return;
      }
      const together = !item.behind && picked.length > 1 && picked.includes(item.id);
      if (!together) onSelect(item.id, false);
      // Only picked: an automatic Scene's picture, or the frame around the picture behind.
      if (!item.transform || !item.picture || (grip === "body" && !onPicture(point))) return;
      pointer.currentTarget.setPointerCapture(pointer.pointerId);
      gesture.current = {
        id: item.id,
        pointer: pointer.pointerId,
        kind: grip === "body" ? "move" : "size",
        from: item.picture.bounds,
        grab: point,
        group: `drag:stage-picture:${++gestures}`,
        moved: false,
        together,
        picture: { grip, grabbed: { transform: item.transform, fitted: fittedOf(item.picture, plan), frame: plan }, now: item.transform },
      };
    };
    const move = (pointer: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      const point = at(pointer);
      if (!current?.picture || current.id !== item.id || pointer.pointerId !== current.pointer || !point) return;
      const { grab } = current;
      // A tap's jitter leaves it where it is.
      if (!current.moved && Math.hypot(point.x - grab.x, point.y - grab.y) < DRAG_CSS_PX * point.unit) return;
      current.moved = true;
      const { grabbed, grip } = current.picture;
      const next = dragged(grabbed, grip, grab, point, { shift: pointer.shiftKey, alt: pointer.altKey });
      // Moved or scaled from a corner, it snaps to the pictures that stay where they are; stretched
      // or turned, it doesn't.
      const snap = grip === "body" ? snapMoved : grip.includes("-") ? snapScaled : null;
      if (snap && plan) {
        const moving = new Set(current.together ? picked.filter((id) => !alone.has(id)) : []);
        const others = atPlayhead()
          .filter(({ id }) => !moving.has(id))
          .map(({ id, picture }) => ({ id, bounds: shownPicture(id, picture).bounds }));
        const snapped = snap(next, grabbed.fitted, guideTargets(plan, others, item.id), { unit: point.unit, alt: pointer.altKey });
        current.picture.now = snapped.transform;
        setGuides(snapped.guides);
      } else {
        current.picture.now = next;
      }
      hold(item, current.picture.now, current.kind);
    };
    const end = (pointer: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (current?.pointer !== pointer.pointerId) return;
      gesture.current = null;
      setGuides(null);
      // Let go over another picture than it took hold of (the next Scene's, played into): dropped.
      if (current.id !== item.id) setHeld(null);
      else if (current.moved && current.picture) commit(item, current.picture.now, current.kind, current.group);
      // A click on one of several picked picks it alone.
      else if (current.together) onSelect(item.id, false);
    };
    const cancel = () => {
      gesture.current = null;
      setGuides(null);
      setHeld(null);
    };
    const pointers = { onPointerMove: move, onPointerUp: end, onPointerCancel: cancel };
    return {
      body: {
        onPointerDown: (pointer: PointerEvent<HTMLElement>) => start(pointer, "body"),
        ...pointers,
        onKeyDown: (key: KeyboardEvent<HTMLElement>) => {
          const step = key.shiftKey ? NUDGE_PX * 5 : NUDGE_PX;
          const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key.key];
          if (!delta || !item.transform || !item.picture || !plan) return;
          key.preventDefault();
          const grabbed = { transform: item.transform, fitted: fittedOf(item.picture, plan), frame: plan };
          commit(item, movedPicture(grabbed, { x: 0, y: 0 }, { x: delta[0], y: delta[1] }), "move", `stage-nudge:${item.id}`);
        },
      },
      grip: (grip: Grip) => ({ onPointerDown: (pointer: PointerEvent<HTMLElement>) => start(pointer, grip), ...pointers }),
    };
  }

  return { items, pictures, picked, drift, guides, moving: !!holding || !!drift, shown, shownPicture, transform, handlers, pictureHandlers };
}

export type StageEdit = ReturnType<typeof useStageEdit>;

/**
 * A handle over each item on screen now (and over each picked one, faded, when it has one place and
 * isn't on screen), to pick, move, nudge and edit it; the picked ones outlined, and one picked alone
 * with a corner to resize it by when it has a size. Under them, the pictures' handles (each on its
 * picture as turned), and over everything the Grips of one picked alone. The guides it snaps to
 * (a picture's Smart Guides), while it does. `scale` is the stage's CSS pixels per output pixel.
 */
export function StageHandles({ plan, playback, edit, scale }: { plan: RenderPlan; playback: Playback; edit: StageEdit; scale: number }) {
  const on = useShown(playback, (time) =>
    [
      ...edit.pictures.map((picture) => (picture.behind || (picture.start <= time && time < picture.end) ? 0 : -1)),
      ...edit.items.map((item) => item.shows.findIndex((show) => show.start <= time && time < show.end)),
    ].join(","),
  );
  const shownAt = on.split(",").map(Number);
  const picturesOn = shownAt.splice(0, edit.pictures.length);
  // The one picture picked alone, with a Transform to set: its Grips.
  const gripped = edit.picked.length === 1 ? edit.pictures.find((picture) => picture.id === edit.picked[0] && picture.transform && picture.picture) : undefined;
  return (
    <>
      {edit.pictures.map((picture, i) => (
        // The picture behind keeps its handle from one Scene to the next, and so the pointer it holds.
        <PictureHandle key={picture.behind ? "behind" : picture.id} plan={plan} edit={edit} item={picture} on={picturesOn[i] === 0} />
      ))}
      {edit.items.map((item, i) => {
        const selected = edit.picked.includes(item.id);
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
              edit.picked.length === 1 &&
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
      {gripped && <Grips plan={plan} edit={edit} item={gripped} scale={scale} />}
      {edit.guides?.x.map((x) => (
        <div key={`x${x}`} aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: percent(x / plan.width) }} />
      ))}
      {edit.guides?.y.map((y) => (
        <div key={`y${y}`} aria-hidden className="pointer-events-none absolute inset-x-0 h-px bg-accent" style={{ top: percent(y / plan.height) }} />
      ))}
    </>
  );
}

// The box of `picture` on the stage as turned (not flipped: its Grips are of its own box), in shares of the frame.
function turnedBox(picture: Picture, plan: RenderPlan): CSSProperties {
  return {
    left: percent(picture.centre[0] / plan.width),
    top: percent(picture.centre[1] / plan.height),
    width: percent(picture.width / plan.width),
    height: percent(picture.height / plan.height),
    transform: `translate(-50%, -50%) rotate(${picture.rotation}deg)`,
  };
}

/**
 * A picture's handle: an Overlay's box as turned, to pick, move and nudge it; for the picture behind,
 * the whole frame, which picks it (and moves it where the picture is), with its box, or for an
 * automatic Scene the frame, outlined while picked. Shown while `on` screen, or faded while picked.
 */
function PictureHandle({ plan, edit, item, on }: { plan: RenderPlan; edit: StageEdit; item: StagePicture; on: boolean }) {
  const selected = edit.picked.includes(item.id);
  if (!on && !selected) return null;
  const { body } = edit.pictureHandlers(item);
  const picture = item.picture && edit.shownPicture(item.id, item.picture);
  const outline = selected ? "outline-2 outline-white outline-dashed" : "hover:outline-1 hover:outline-white/70 hover:outline-dashed";
  const box = picture && item.transform && (!item.behind || selected) && (
    <div
      role="button"
      tabIndex={0}
      aria-roledescription="movable picture"
      aria-label={`${item.label}: drag to move it, or use the arrow keys${selected ? "; its corners scale it, its edges stretch it, the handle above turns it" : ""}`}
      aria-pressed={selected}
      {...body}
      className={cx(
        "absolute cursor-move touch-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-solid",
        outline,
        !on && "opacity-40",
      )}
      style={turnedBox(picture, plan)}
    />
  );
  if (!item.behind) return box || null;
  return (
    <>
      {/* The frame: what of the Segment under the playhead isn't under anything else picks it. */}
      <div aria-hidden onPointerDown={body.onPointerDown} onPointerMove={body.onPointerMove} onPointerUp={body.onPointerUp} onPointerCancel={body.onPointerCancel} className="absolute inset-0 touch-none" />
      {box || (selected && <div aria-hidden className="pointer-events-none absolute inset-0 rounded-control outline-2 -outline-offset-2 outline-white outline-dashed" />)}
    </>
  );
}

// The Grips, the edges' drawn as bars along them.
const GRIPS: { grip: Exclude<Grip, "rotate">; look: string }[] = [
  { grip: "top-left", look: "size-3 rounded-full" },
  { grip: "top", look: "h-2 w-4 rounded-full" },
  { grip: "top-right", look: "size-3 rounded-full" },
  { grip: "right", look: "h-4 w-2 rounded-full" },
  { grip: "bottom-right", look: "size-3 rounded-full" },
  { grip: "bottom", look: "h-2 w-4 rounded-full" },
  { grip: "bottom-left", look: "size-3 rounded-full" },
  { grip: "left", look: "h-4 w-2 rounded-full" },
];

// A Grip's dot, with a hit area larger than it, larger still under a finger.
const GRIP_DOT =
  "pointer-events-auto absolute touch-none border-2 border-white bg-accent shadow-sm before:absolute before:-inset-2 before:content-[''] pointer-coarse:before:-inset-3.5";
// How far above the picture the rotate handle is, and how far inside the stage a Grip is kept, in CSS pixels.
const ROTATE_REACH_CSS_PX = 24;
const GRIP_INSET_CSS_PX = 10;

/**
 * The Grips of the picture picked alone, over everything else on the stage, on the picture as turned
 * (or, off the stage, pulled in towards its centre: `gripsOnFrame`): its corners scale it about its
 * centre, its edges stretch it, and the handle above it turns it (Shift: in 15° steps; Alt: without
 * snapping to a quarter turn). `scale` is the stage's CSS pixels per output pixel.
 */
function Grips({ plan, edit, item, scale }: { plan: RenderPlan; edit: StageEdit; item: StagePicture; scale: number }) {
  const picture = edit.shownPicture(item.id, item.picture!);
  const { grip } = edit.pictureHandlers(item);
  const [x, y] = picture.centre;
  const unit = 1 / scale;
  const on = gripsOnFrame({ x, y, width: picture.width, height: picture.height, rotation: picture.rotation }, plan, ROTATE_REACH_CSS_PX * unit, GRIP_INSET_CSS_PX * unit);
  const place = (point: Point): CSSProperties => ({
    left: percent(point.x / plan.width),
    top: percent(point.y / plan.height),
    transform: `translate(-50%, -50%) rotate(${picture.rotation}deg)`,
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <svg viewBox={`0 0 ${plan.width} ${plan.height}`} className="absolute inset-0 size-full">
        <line x1={on.top.x} y1={on.top.y} x2={on.rotate.x} y2={on.rotate.y} stroke="white" strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />
      </svg>
      {GRIPS.map(({ grip: at, look }) => (
        <span key={at} {...grip(at)} className={cx(GRIP_DOT, look)} style={{ ...place(on[at]), cursor: gripCursor(at, picture.rotation) }} />
      ))}
      <span {...grip("rotate")} className={cx(GRIP_DOT, "size-3.5 rounded-full bg-white")} style={{ ...place(on.rotate), cursor: gripCursor("rotate", picture.rotation) }} />
    </div>
  );
}
