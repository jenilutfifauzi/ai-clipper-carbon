import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Box, Crop, Picture, RenderPlan, Transform } from "../../../api";
import { cx } from "../../../format";
import { cropDragged, keptPart, wholePicture, type CropEntry } from "./cropGestures";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import {
  cornersOf,
  endDragged,
  fingerDown,
  fingerMoved,
  fingersHeld,
  fingersOn,
  fingerUp,
  moved as movedPicture,
  offsetOnPicture,
  resized,
  type Corner,
  type Edge,
  type Fingers,
  type Grip,
  type Placed,
  type Point,
  type Size,
  type Sized,
} from "./pictureGestures";
import { agentOutlines } from "../advanced/agent/follow";
import { NO_IDS, usePresence, type PresenceState } from "../advanced/agent/presence";
import { useShown, type Playback } from "./playback";
import { fixedGuides, guideTargets, snapMoved, snapScaled, SNAP_CSS_PX, type GuideLines, type SmartGuides } from "./smartGuides";
import { croppedPicture, cropKept, fittedOf, gripCursor, gripsIn, gripsOnFrame, heldPicture, pressTogglesPick, tidyTransform, wholeOnStage, type GripSet } from "./stagePicture";
import type { BoxEdge } from "./textBox";
import { TextBoxGrips } from "./TextBoxGrips";

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
 * A picture drawn on the stage (ADR 0007): an Overlay ("overlay:<id>"), a Text Layer ("text:<id>",
 * by its area: textStage.ts), or the picture behind every Overlay ("picture:<n>": the Segment under
 * the playhead, at the plan's Scene n). It is picked, moved and nudged as the other items are and,
 * picked alone, scaled from its corners, stretched from its edges and turned by the handle above
 * it: its Grips (GLOSSARY.md), on the picture as turned.
 */
export interface StagePicture {
  id: string;
  label: string;
  // When it shows, in seconds into the Clip, and as planned: null for an automatic Scene's, which is
  // only outlined, as the frame.
  start: number;
  end: number;
  picture: Picture | null;
  // Its size at scale 1, when it isn't its crop's fitted to the frame (a Text Layer's area).
  fitted?: Size;
  // Its Transform as saved, what a gesture starts from: null where it has none to set here.
  transform: Transform | null;
  // The picture behind: the whole frame picks it, and it moves by itself, never with the others picked.
  behind?: boolean;
  // The picture behind's: the Behind Overlay ("overlay:<id>") a press at `point` reaches instead,
  // where the picture doesn't show over it (ClipPreview's stagePictures); null: none.
  through?: (point: Point) => string | null;
  // A Behind Overlay (ADR 0015), drawn under the picture behind: its handle is under that one's but
  // while it is picked. Picked, a click (not a drag) on it where the picture behind shows over it
  // (`coveredBy`, that one's id) picks that one.
  under?: boolean;
  coveredBy?: (point: Point) => string | null;
  // Its Grips: all of them (by default), only its corners (the clip editor's), or its corners and
  // the rotate handle (a Text Layer's).
  grips?: GripSet;
  // Edited where it was double-tapped (output pixels), or from the keyboard (no point), in place of
  // Crop mode: a Text Layer's words, retyped.
  onEdit?: (point?: { x: number; y: number }) => void;
  // Put where a gesture leaves it, once, at its end: one `group` of changes.
  onTransform: (transform: Transform, group: string) => void;
  // A Text Layer's: its box's wrap width (the sides) or fixed height (the top and bottom) set to
  // `length` of its own pixels by the box Grip on `edge` (TextBoxGrips), once a drag ends: one `group`.
  onBox?: (edge: BoxEdge, length: number, group: string) => void;
  // A Shape's (docs/adr/0011): its edges (with all its Grips) or a line's or an arrow's two ends (with
  // `grips` "ends") set its box, its size at scale 1, instead of stretching it (`resized`,
  // `endDragged`), its last picture stretched while the drag lasts. Once it ends, the box (its own
  // pixels) and the Transform that keeps its other edge or end in place, together: one `group`.
  // `aboutCentre`: an edge resizes it about its centre instead, which stays put.
  resize?: { aboutCentre: boolean; onResize: (box: Size, transform: Transform, group: string) => void };
  // Its Crop as saved, what Crop mode opens on, and where Crop mode leaves it, with the Transform
  // that keeps the kept part in place, together: one `group`. Without them it has no Crop mode.
  crop?: Crop | null;
  onCrop?: (crop: Crop, transform: Transform, group: string) => void;
}

// Held where a gesture put it: a text's area moved by (dx, dy) and scaled by `scale` about its
// middle, or a picture drawn by `transform` (its centre (dx, dy) from the plan's), and cut by `crop`
// when Crop mode set one, at `fitted` (its size at scale 1) when a Shape's Grip set one; until
// `plan` is no longer the plan, once the gesture is over.
type Held = {
  id: string;
  kind: "move" | "size";
  dx: number;
  dy: number;
  scale: number;
  transform: Transform | null;
  crop?: Crop;
  fitted?: Size;
  plan: RenderPlan | null;
};

// Crop mode (GLOSSARY.md) on picture `id`: as it opened, and the Crop it is at now.
type Cropping = { id: string; entry: CropEntry; crop: Crop };
// A crop handle held: by which pointer, from where, and the Crop then.
type CropGrab = { pointer: number; handle: Corner | Edge; from: Point; grabbed: Crop };

// Whether a key pressed in `target` is typed into it.
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.matches("textarea, select, input:not([type=button], [type=checkbox], [type=radio])"));

/**
 * How far the picked items that follow a moved one are drawn from where the plan has them, in output
 * pixels, and the one they follow.
 */
export type Drift = { lead: string; dx: number; dy: number };
type Gesture = {
  id: string;
  // The pointer it began with, a finger's (`touch`) or not, and the element that holds it.
  pointer: number;
  touch: boolean;
  target: HTMLElement;
  kind: "move" | "size";
  // The area as drawn when it was grabbed (a picture's bounds), and where the pointer was.
  from: Box;
  grab: { x: number; y: number };
  group: string;
  moved: boolean;
  // Grabbed as one of several picked, which move with it.
  together: boolean;
  // A picture's: the fingers (or the one pointer) on its body or a Grip, from its Transform then, and
  // where it is now; a Shape's edge or end (`resizing`, one finger only), with the box it sets.
  picture?: { fingers: Fingers; now: Transform; resizing: boolean; box?: Size };
};

let gestures = 0;

const centreOf = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * The gestures that move, resize and edit `items`, and move and transform `pictures`, on the stage.
 * While one is under way, and until a plan comes back after its last change, the item is drawn where
 * it is being put: the plan comes from the backend only once the draft changes
 * (docs/adr/0001-backend-plans-frontend-draws.md). An item's gesture (the hook's, the captions')
 * saves as it goes, each change in one group; a picture's saves once, when it is let go.
 *
 * `picked` are the ids picked: a click picks an item alone, or with Shift, Cmd or Ctrl (`toggle`)
 * adds it or takes it out. When several are picked, moving one draws the others moved as far
 * (`drift`), but for the picture behind, which moves alone; only one picked alone can be resized or
 * transformed by its Grips.
 *
 * An item snaps to the fixed guides. A picture moved, or scaled from a corner, snaps to its Smart
 * Guides (GLOSSARY.md): the frame, the fixed guides and the pictures `atPlayhead` (`picturesAt`)
 * but those moving with it. Alt turns snapping off; `guides` are the lines of a snap.
 *
 * On a phone, a second finger on a picture picked alone pinches it to scale and twists it to turn
 * (`fingersHeld`), without Smart Guides; with one of the two lifted, the other moves it on. However
 * many fingers it took, a gesture is saved once, when the last is lifted: one step of undo.
 *
 * A picture with `onEdit` (a Text Layer) is edited on a double-click, a double-tap or Enter. One
 * with a Crop opens Crop mode on a double-click or double-tap, or when `crop.asked` (a
 * count) goes up while it is picked alone (`crop.onOpen` then, to pause the playback): it is drawn
 * whole, its handles move the Crop, and Enter or a press anywhere but on it keeps the Crop (with the
 * Transform that keeps the kept part where it was, one step of undo), and Escape drops it.
 */
export function useStageEdit(
  plan: RenderPlan | null,
  stage: React.RefObject<HTMLDivElement | null>,
  items: StageItem[],
  pictures: StagePicture[],
  picked: string[],
  onSelect: (id: string, toggle: boolean) => void,
  atPlayhead: () => { id: string; picture: Picture }[] = () => [],
  crop: { asked?: number; onOpen?: () => void } = {},
) {
  const [held, setHeld] = useState<Held | null>(null);
  const [cropping, setCropping] = useState<Cropping | null>(null);
  const cropGrab = useRef<CropGrab | null>(null);
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
    if (cropping?.id === id) return wholeOnStage(picture, cropping.entry);
    if (holding?.id !== id || !holding.transform || !plan) return picture;
    const fitted = holding.fitted ?? pictures.find((item) => item.id === id)?.fitted;
    return heldPicture(holding.crop ? croppedPicture(picture, holding.crop) : picture, holding.transform, plan, fitted);
  }

  // What `item`'s Grips scale: its size at scale 1.
  const fittedFor = (item: StagePicture, picture: Picture, frame: Size) => item.fitted ?? fittedOf(picture, frame);

  // An SVG transform for what is drawn in `area` of item `id`, while it is held.
  function transform(id: string, area: Box): string | undefined {
    if (follows(id)) return `translate(${drift!.dx} ${drift!.dy})`;
    if (holding?.id !== id) return undefined;
    const { x, y } = centreOf(area);
    return `translate(${x + holding.dx} ${y + holding.dy}) scale(${holding.scale}) translate(${-x} ${-y})`;
  }

  // Where the pointer is, in output pixels, and how many of them a CSS pixel is.
  function at(pointer: { clientX: number; clientY: number }): { x: number; y: number; unit: number } | null {
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
      const nearest = (start: number, length: number, lines: GuideLines) => {
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
      // The plan's Canvas's centre and Safe Area.
      const guides = fixedGuides(plan);
      const sx = nearest(x, from.width, guides.x);
      const sy = nearest(y, from.height, guides.y);
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
        touch: pointer.pointerType === "touch",
        target: pointer.currentTarget,
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

  // `item` drawn by `transform` (moved, or resized: `kind`), cut by `crop` and at `fitted`, until the next plan once it is let go.
  function hold(item: StagePicture, transform: Transform, kind: Held["kind"], crop?: Crop, fitted?: Size) {
    const [x, y] = item.picture?.centre ?? [transform.x, transform.y];
    setHeld({ id: item.id, kind, dx: transform.x - x, dy: transform.y - y, scale: 1, transform, crop, fitted, plan });
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

  // A Shape's `item` given the box `box` (its size at scale 1) by an edge or an end, at `transform`,
  // and saved together, as `group`: nothing when both are as they were.
  function commitResize(item: StagePicture, transform: Transform, box: Size, group: string) {
    const next = tidyTransform(transform);
    const was = item.fitted;
    if (!item.resize || (JSON.stringify(next) === JSON.stringify(item.transform) && was?.width === box.width && was?.height === box.height)) {
      setHeld(null);
      return;
    }
    hold(item, next, "size", undefined, box);
    item.resize.onResize(box, next, group);
  }

  // Where a Shape's edge or a line's end (`grip`) dragged from `from` to `to` puts it, with the box it sets.
  function resizedBy(item: StagePicture, fingers: Fingers, from: Point, to: Point, keys: { shift: boolean; alt: boolean }): Sized {
    const grip = fingers.grip as Edge;
    if (item.grips === "ends") return endDragged(fingers.grab, grip === "left" ? "left" : "right", from, to, keys);
    return resized(fingers.grab, grip, from, to, item.resize?.aboutCentre);
  }

  // What is drawn over `item` where `pointer` is: the picture behind, over a Behind Overlay.
  function coveredAt(item: StagePicture, pointer: PointerEvent<HTMLElement>): string | null {
    const point = item.coveredBy && at(pointer);
    return point ? item.coveredBy!(point) : null;
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
      if (pressTogglesPick(grip, pointer)) {
        onSelect(item.id, true);
        return;
      }
      const together = !item.behind && picked.length > 1 && picked.includes(item.id);
      if (!together) onSelect(item.id, false);
      // Only picked: an automatic Scene's picture, or the frame around the picture behind.
      if (!item.transform || !item.picture || (grip === "body" && !onPicture(point))) return;
      pointer.currentTarget.setPointerCapture(pointer.pointerId);
      const grabbed = { transform: item.transform, fitted: fittedFor(item, item.picture, plan), frame: plan };
      const resizing = !!item.resize && (grip === "top" || grip === "right" || grip === "bottom" || grip === "left");
      gesture.current = {
        id: item.id,
        pointer: pointer.pointerId,
        touch: pointer.pointerType === "touch",
        target: pointer.currentTarget,
        kind: grip === "body" ? "move" : "size",
        from: item.picture.bounds,
        grab: point,
        group: `drag:stage-picture:${++gestures}`,
        moved: false,
        together,
        picture: { fingers: fingersOn(grabbed, grip, pointer.pointerId, point), now: item.transform, resizing },
      };
    };
    const move = (pointer: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      const point = at(pointer);
      if (!current?.picture || current.id !== item.id || !point) return;
      const fingers = fingerMoved(current.picture.fingers, pointer.pointerId, point);
      if (fingers === current.picture.fingers) return;
      current.picture.fingers = fingers;
      const { grab } = current;
      // A tap's jitter leaves it where it is.
      if (!current.moved && Math.hypot(point.x - grab.x, point.y - grab.y) < DRAG_CSS_PX * point.unit) return;
      current.moved = true;
      if (current.picture.resizing) {
        const [finger] = fingers.down;
        const sized = resizedBy(item, fingers, finger.from, finger.at, { shift: pointer.shiftKey, alt: pointer.altKey });
        current.picture.now = sized.transform;
        current.picture.box = sized.fitted;
        hold(item, sized.transform, "size", undefined, sized.fitted);
        return;
      }
      const held = fingersHeld(fingers, { shift: pointer.shiftKey, alt: pointer.altKey });
      // One without a rotate handle (the clip editor's) isn't turned by a twist either.
      const next = item.grips === "corners" ? { ...held, rotation: fingers.grab.transform.rotation } : held;
      // Moved or scaled from a corner by one pointer, it snaps to the pictures that stay where they
      // are; stretched, turned or pinched, it doesn't.
      const { grip } = fingers;
      const snap = fingers.down.length > 1 ? null : grip === "body" ? snapMoved : grip.includes("-") ? snapScaled : null;
      if (snap && plan) {
        const moving = new Set(current.together ? picked.filter((id) => !alone.has(id)) : []);
        const others = atPlayhead()
          .filter(({ id }) => !moving.has(id))
          .map(({ id, picture }) => ({ id, bounds: shownPicture(id, picture).bounds }));
        const snapped = snap(next, fingers.grab.fitted, guideTargets(plan, others, item.id), { unit: point.unit, alt: pointer.altKey });
        current.picture.now = snapped.transform;
        setGuides(snapped.guides);
      } else {
        current.picture.now = next;
        setGuides(null);
      }
      hold(item, current.picture.now, current.kind);
    };
    const end = (pointer: PointerEvent<HTMLElement>) => {
      const current = gesture.current;
      if (!current?.picture) return;
      const fingers = fingerUp(current.picture.fingers, pointer.pointerId, current.picture.now);
      if (fingers === current.picture.fingers) return;
      // One of two lifted: the other moves it on from where it is, and the gesture (one step of
      // undo) goes on until that one is lifted too.
      if (fingers) {
        current.picture.fingers = fingers;
        return;
      }
      gesture.current = null;
      setGuides(null);
      // Let go over another picture than it took hold of (the next Scene's, played into): dropped.
      if (current.id !== item.id) setHeld(null);
      else if (current.moved && current.picture.box) commitResize(item, current.picture.now, current.picture.box, current.group);
      else if (current.moved && current.picture) commit(item, current.picture.now, current.kind, current.group);
      // A click on one of several picked picks it alone.
      else if (current.together) onSelect(item.id, false);
      // A click on a Behind Overlay where the picture behind shows over it picks that one.
      else if (current.picture.fingers.grip === "body" && coveredAt(item, pointer)) onSelect(coveredAt(item, pointer)!, false);
      // Two taps on its body edit it, or open Crop mode.
      else if (current.picture.fingers.grip === "body") {
        const now = performance.now();
        if (lastTap.current?.id === item.id && now - lastTap.current.at < DOUBLE_TAP_MS) {
          lastTap.current = null;
          if (item.onEdit) item.onEdit(at(pointer) ?? undefined);
          else openCrop(item);
        } else {
          lastTap.current = { id: item.id, at: now };
        }
      }
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
          if (key.key === "Enter" && item.onEdit) {
            key.preventDefault();
            item.onEdit();
            return;
          }
          const step = key.shiftKey ? NUDGE_PX * 5 : NUDGE_PX;
          const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key.key];
          if (!delta || !item.transform || !item.picture || !plan) return;
          key.preventDefault();
          const grabbed = { transform: item.transform, fitted: fittedFor(item, item.picture, plan), frame: plan };
          commit(item, movedPicture(grabbed, { x: 0, y: 0 }, { x: delta[0], y: delta[1] }), "move", `stage-nudge:${item.id}`);
        },
      },
      grip: (grip: Grip) => ({ onPointerDown: (pointer: PointerEvent<HTMLElement>) => start(pointer, grip), ...pointers }),
    };
  }

  // Crop mode opened on `item`, the playback paused: when it has a Crop to set.
  function openCrop(item: StagePicture) {
    if (!plan || !item.transform || !item.picture || !item.crop || !item.onCrop || item.grips === "corners") return;
    const [width, height] = item.picture.item_size;
    gesture.current = null;
    setHeld(null);
    setCropping({ id: item.id, entry: { transform: item.transform, crop: item.crop, item: { width, height }, frame: { width: plan.width, height: plan.height } }, crop: item.crop });
    crop.onOpen?.();
  }

  // What the window's listeners and the asking read: this render's.
  const latest = useRef({ cropping, pictures, picked, at });
  latest.current = { cropping, pictures, picked, at };

  // A second finger down while a finger holds something, wherever it lands, is the gesture's: on a
  // picture picked alone it pinches and twists it (held by the element the first finger is, so its
  // moves and lift come there too); on anything else it is left out, so it picks nothing else. And
  // while a finger holds something, the page under the stage neither scrolls nor zooms.
  useEffect(() => {
    const onDown = (event: globalThis.PointerEvent) => {
      const current = gesture.current;
      if (!current?.touch || event.pointerType !== "touch" || event.pointerId === current.pointer) return;
      // Its element gone (the item with it), the gesture is over without its lift.
      if (!current.target.isConnected) {
        gesture.current = null;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const point = latest.current.at(event);
      const { picture } = current;
      // A Shape's edge or end is dragged by one finger alone.
      if (!picture || picture.resizing || current.together || !point) return;
      const fingers = fingerDown(picture.fingers, event.pointerId, point, picture.now);
      if (fingers === picture.fingers) return;
      current.target.setPointerCapture(event.pointerId);
      picture.fingers = fingers;
      current.moved = true;
      setGuides(null);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (gesture.current?.touch && event.cancelable) event.preventDefault();
    };
    const element = stage.current;
    window.addEventListener("pointerdown", onDown, true);
    element?.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      element?.removeEventListener("touchmove", onTouchMove);
    };
  }, [stage]);

  // Crop mode closed, its Crop kept (with the Transform that keeps the kept part where it was, as
  // one group, drawn so until the next plan) or dropped.
  function closeCrop(keep: boolean) {
    const open = latest.current.cropping;
    if (!open) return;
    setCropping(null);
    cropGrab.current = null;
    const item = latest.current.pictures.find((picture) => picture.id === open.id);
    const kept = keep && item?.onCrop ? cropKept(open.entry, open.crop) : null;
    if (!item?.onCrop || !kept) return;
    hold(item, kept.transform, "size", kept.crop);
    item.onCrop(kept.crop, kept.transform, `stage-crop:${++gestures}`);
  }

  // Asked (the inspector's Crop): Crop mode on the picture picked alone.
  const asked = useRef(crop.asked);
  useEffect(() => {
    if (crop.asked === asked.current) return;
    asked.current = crop.asked;
    const { pictures, picked } = latest.current;
    const item = picked.length === 1 ? pictures.find((picture) => picture.id === picked[0]) : undefined;
    if (item) openCrop(item);
  });

  // Closed by itself when its picture is gone (another Scene, deleted) or set elsewhere (an undo,
  // another editor): what it opened on is no longer there.
  const croppedItem = cropping && pictures.find((picture) => picture.id === cropping.id);
  const stale =
    !!cropping &&
    (!croppedItem || JSON.stringify(croppedItem.transform) !== JSON.stringify(cropping.entry.transform) || JSON.stringify(croppedItem.crop) !== JSON.stringify(cropping.entry.crop));
  useEffect(() => {
    if (stale) setCropping(null);
  }, [stale]);

  // While it is open, Enter keeps it and Escape drops it (before the editor's keys), and a press
  // anywhere but on its kept part, its handles or its bar keeps it.
  const open = !!cropping;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.key !== "Enter" && event.key !== "Escape") || typing(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeCrop(event.key === "Enter");
    };
    const onDown = (event: globalThis.PointerEvent) => {
      // A second finger while a handle is held is left out: it neither keeps the Crop nor takes another handle.
      if (cropGrab.current && cropGrab.current.pointer !== event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target instanceof Element && event.target.closest("[data-crop-mode]")) return;
      closeCrop(true);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  // A crop handle's pointer handlers: dragged, it moves the edge or edges it names in the picture's own axes.
  function cropHandlers(handle: Corner | Edge) {
    return {
      onPointerDown: (pointer: PointerEvent<HTMLElement>) => {
        const point = at(pointer);
        if (!point || !cropping || pointer.button !== 0) return;
        pointer.preventDefault();
        pointer.stopPropagation();
        pointer.currentTarget.setPointerCapture(pointer.pointerId);
        cropGrab.current = { pointer: pointer.pointerId, handle, from: point, grabbed: cropping.crop };
      },
      onPointerMove: (pointer: PointerEvent<HTMLElement>) => {
        const grab = cropGrab.current;
        const point = at(pointer);
        if (!grab || grab.pointer !== pointer.pointerId || !point) return;
        setCropping((old) => old && { ...old, crop: cropDragged(old.entry, grab.grabbed, grab.handle, grab.from, point) });
      },
      onPointerUp: (pointer: PointerEvent<HTMLElement>) => {
        if (cropGrab.current?.pointer === pointer.pointerId) cropGrab.current = null;
      },
      onPointerCancel: () => {
        const grab = cropGrab.current;
        cropGrab.current = null;
        if (grab) setCropping((old) => old && { ...old, crop: grab.grabbed });
      },
    };
  }

  // Crop mode as drawn: the whole picture, and the part its Crop keeps now.
  const cropMode = cropping && !stale ? { id: cropping.id, whole: wholePicture(cropping.entry), kept: keptPart(cropping.entry, cropping.crop) } : null;

  return {
    items,
    pictures,
    picked,
    drift,
    guides,
    moving: !!holding || !!drift || !!cropping,
    shown,
    shownPicture,
    transform,
    at,
    handlers,
    pictureHandlers,
    cropMode,
    cropHandlers,
    closeCrop,
  };
}

export type StageEdit = ReturnType<typeof useStageEdit>;

const flashingOf = (state: PresenceState) => state.flashing;

/**
 * A handle over each item on screen now (and over each picked one, faded, when it has one place and
 * isn't on screen), to pick, move, nudge and edit it; the picked ones outlined, and one picked alone
 * with a corner to resize it by when it has a size. Under them, the pictures' handles (each on its
 * picture as turned), and over everything the Grips of one picked alone (and a Text Layer's box Grips). The guides it snaps to
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
  // A Behind Overlay's handle is under the picture behind's (which covers the frame), but while it is picked.
  const lifted = (picture: StagePicture) => !picture.under || edit.picked.includes(picture.id);
  // What the Agent's last Revision changed, outlined while it flashes (ADR 0029): never picked by it.
  const flashing = usePresence(flashingOf, NO_IDS);
  const outlined = agentOutlines(
    edit.pictures.filter((picture, i) => !picture.behind && picturesOn[i] === 0),
    flashing,
  );
  const handle = (picture: StagePicture, i: number) => (
    // The picture behind keeps its handle from one Scene to the next, and so the pointer it holds.
    <PictureHandle key={picture.behind ? "behind" : picture.id} plan={plan} edit={edit} item={picture} on={picturesOn[i] === 0} />
  );
  return (
    <>
      {edit.pictures.map((picture, i) => (lifted(picture) ? null : handle(picture, i)))}
      {edit.pictures.map((picture, i) => (lifted(picture) ? handle(picture, i) : null))}
      {outlined.map(({ id, picture }) => (
        <div key={`agent:${id}`} aria-hidden data-agent="flash" className="pointer-events-none absolute" style={turnedBox(edit.shownPicture(id, picture), plan)} />
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
      {edit.cropMode ? <CropHandles plan={plan} edit={edit} scale={scale} /> : gripped && <Grips plan={plan} edit={edit} item={gripped} scale={scale} />}
      {!edit.cropMode && !edit.moving && gripped?.onBox && <BoxGrips plan={plan} edit={edit} item={gripped} scale={scale} />}
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
 * automatic Scene the frame, outlined while picked; a press on it where a Behind Overlay shows
 * through it (`through`) picks and moves that one. Shown while `on` screen, or faded while picked.
 */
function PictureHandle({ plan, edit, item, on }: { plan: RenderPlan; edit: StageEdit; item: StagePicture; on: boolean }) {
  // The Behind Overlay a press on the picture behind reached, which the pointer moves until it is lifted.
  const reached = useRef<StagePicture | null>(null);
  const selected = edit.picked.includes(item.id);
  if (!on && !selected) return null;
  const own = edit.pictureHandlers(item).body;
  // The pointer's handlers of what the press reached.
  const held = () => (reached.current ? edit.pictureHandlers(reached.current).body : own);
  const body: typeof own = !item.through
    ? own
    : {
        ...own,
        onPointerDown: (pointer) => {
          const point = edit.at(pointer);
          const id = point && item.through!(point);
          reached.current = (id && edit.pictures.find((picture) => picture.id === id)) || null;
          held().onPointerDown(pointer);
        },
        onPointerMove: (pointer) => held().onPointerMove(pointer),
        onPointerUp: (pointer) => held().onPointerUp(pointer),
        onPointerCancel: () => held().onPointerCancel(),
      };
  const picture = item.picture && edit.cropMode?.id !== item.id && edit.shownPicture(item.id, item.picture);
  const outline = selected ? "outline-2 outline-white outline-dashed" : "hover:outline-1 hover:outline-white/70 hover:outline-dashed";
  const edges = item.resize ? "set its width and height" : "stretch it";
  const grips = {
    all: `its corners scale it, its edges ${edges}, the handle above turns it`,
    corners: "its corners scale it",
    "corners-rotate": "its corners scale it, the handle above turns it",
    ends: "drag an end to move it alone, the handle above turns it",
  }[item.grips ?? "all"];
  const hints = [
    "drag to move it, or use the arrow keys",
    selected && grips,
    item.onEdit && "double-click or press Enter to edit its words",
  ];
  const box = picture && item.transform && (!item.behind || selected) && (
    <div
      role="button"
      tabIndex={0}
      aria-roledescription="movable picture"
      aria-label={`${item.label}: ${hints.filter(Boolean).join("; ")}`}
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

// The Grips, the edges' drawn as bars along them; larger under a finger.
const CORNER_LOOK = "size-3 rounded-full pointer-coarse:size-4";
const ACROSS_LOOK = "h-2 w-4 rounded-full pointer-coarse:h-2.5 pointer-coarse:w-5";
const DOWN_LOOK = "h-4 w-2 rounded-full pointer-coarse:h-5 pointer-coarse:w-2.5";
const GRIPS: { grip: Exclude<Grip, "rotate">; look: string }[] = [
  { grip: "top-left", look: CORNER_LOOK },
  { grip: "top", look: ACROSS_LOOK },
  { grip: "top-right", look: CORNER_LOOK },
  { grip: "right", look: DOWN_LOOK },
  { grip: "bottom-right", look: CORNER_LOOK },
  { grip: "bottom", look: ACROSS_LOOK },
  { grip: "bottom-left", look: CORNER_LOOK },
  { grip: "left", look: DOWN_LOOK },
];

// A Grip's dot, with a hit area larger than it, larger still under a finger.
const GRIP_DOT =
  "pointer-events-auto absolute touch-none border-2 border-white bg-accent shadow-sm before:absolute before:-inset-2 before:content-[''] pointer-coarse:before:-inset-3.5";
// How far above the picture the rotate handle is (further under a finger, so that its hit area and
// the top edge's stay apart), and how far inside the stage a Grip is kept, in CSS pixels.
const ROTATE_REACH_CSS_PX = 24;
const ROTATE_REACH_FINGER_CSS_PX = 40;
const GRIP_INSET_CSS_PX = 10;

/**
 * The Grips of the picture picked alone, over everything else on the stage, on the picture as turned
 * (or, off the stage, pulled in towards its centre: `gripsOnFrame`): its corners scale it about its
 * centre, its edges stretch it (a Shape's set its width and height), and the handle above it turns
 * it (Shift: in 15° steps; Alt: without snapping to a quarter turn); only the corners, of one with
 * `grips` "corners"; a line's or an arrow's two ends and the handle, of one with "ends". `scale` is
 * the stage's CSS pixels per output pixel.
 */
function Grips({ plan, edit, item, scale }: { plan: RenderPlan; edit: StageEdit; item: StagePicture; scale: number }) {
  const picture = edit.shownPicture(item.id, item.picture!);
  const { grip } = edit.pictureHandlers(item);
  const has = new Set(gripsIn(item.grips ?? "all"));
  const ends = item.grips === "ends";
  const finger = useMediaQuery("(pointer: coarse)");
  const [x, y] = picture.centre;
  const unit = 1 / scale;
  const reach = (finger ? ROTATE_REACH_FINGER_CSS_PX : ROTATE_REACH_CSS_PX) * unit;
  const on = gripsOnFrame({ x, y, width: picture.width, height: picture.height, rotation: picture.rotation }, plan, reach, GRIP_INSET_CSS_PX * unit);
  const place = (point: Point): CSSProperties => ({
    left: percent(point.x / plan.width),
    top: percent(point.y / plan.height),
    transform: `translate(-50%, -50%) rotate(${picture.rotation}deg)`,
  });
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {has.has("rotate") && (
        <svg viewBox={`0 0 ${plan.width} ${plan.height}`} className="absolute inset-0 size-full">
          <line x1={on.top.x} y1={on.top.y} x2={on.rotate.x} y2={on.rotate.y} stroke="white" strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {GRIPS.filter(({ grip: at }) => has.has(at)).map(({ grip: at, look }) =>
        // A line's or an arrow's ends: dots that move freely.
        ends ? (
          <span key={at} {...grip(at)} className={cx(GRIP_DOT, CORNER_LOOK)} style={{ ...place(on[at]), cursor: "move" }} />
        ) : (
          <span key={at} {...grip(at)} className={cx(GRIP_DOT, look)} style={{ ...place(on[at]), cursor: gripCursor(at, picture.rotation) }} />
        ),
      )}
      {has.has("rotate") && (
        <span {...grip("rotate")} className={cx(GRIP_DOT, "size-3.5 rounded-full bg-white pointer-coarse:size-5")} style={{ ...place(on.rotate), cursor: gripCursor("rotate", picture.rotation) }} />
      )}
    </div>
  );
}

/**
 * The box Grips of a Text Layer picked alone (TextBoxGrips), on its area as drawn, pulled in from off
 * the stage as its other Grips are. `scale` is the stage's CSS pixels per output pixel.
 */
function BoxGrips({ plan, edit, item, scale }: { plan: RenderPlan; edit: StageEdit; item: StagePicture; scale: number }) {
  const picture = edit.shownPicture(item.id, item.picture!);
  const [x, y] = picture.centre;
  return (
    <TextBoxGrips
      key={item.id}
      plan={plan}
      box={{ x, y, width: picture.width, height: picture.height, rotation: picture.rotation }}
      scale={item.transform!.scale}
      inset={GRIP_INSET_CSS_PX / scale}
      at={edit.at}
      onBox={item.onBox!}
    />
  );
}

// A button of Crop mode's bar: a 36 px pill, larger under a finger.
const CROP_BAR_BUTTON = "min-h-9 shrink-0 rounded-full px-3 font-medium pointer-coarse:min-h-11";

// A path around `picture` as turned, in frame pixels.
const outlineOf = (picture: Placed) => `M${cornersOf(picture).map(({ x, y }) => `${x} ${y}`).join("L")}Z`;

/**
 * Crop mode's handles, over everything else on the stage: the whole picture dimmed but for the part
 * its Crop keeps, a handle on each edge and corner of that part (in its own axes, pulled in from off
 * the stage as Grips are), and a bar that keeps or drops it. `scale` is the stage's CSS pixels per
 * output pixel.
 */
function CropHandles({ plan, edit, scale }: { plan: RenderPlan; edit: StageEdit; scale: number }) {
  const { whole, kept } = edit.cropMode!;
  const on = gripsOnFrame(kept, plan, 0, GRIP_INSET_CSS_PX / scale);
  const place = (point: Point): CSSProperties => ({
    left: percent(point.x / plan.width),
    top: percent(point.y / plan.height),
    transform: `translate(-50%, -50%) rotate(${kept.rotation}deg)`,
  });
  return (
    <div className="pointer-events-none absolute inset-0">
      <svg aria-hidden viewBox={`0 0 ${plan.width} ${plan.height}`} className="absolute inset-0 size-full">
        <path d={outlineOf(whole) + outlineOf(kept)} fillRule="evenodd" fill="black" fillOpacity={0.6} />
        <path d={outlineOf(kept)} fill="none" stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The kept part: a press on it leaves Crop mode open. */}
      <div
        aria-hidden
        data-crop-mode
        className="pointer-events-auto absolute"
        style={{ ...place(kept), width: percent(kept.width / plan.width), height: percent(kept.height / plan.height) }}
      />
      {GRIPS.map(({ grip, look }) => (
        <span
          key={grip}
          aria-hidden
          data-crop-mode
          {...edit.cropHandlers(grip)}
          className={cx(GRIP_DOT, look, "bg-white")}
          style={{ ...place(on[grip]), cursor: gripCursor(grip, kept.rotation) }}
        />
      ))}
      <div
        role="group"
        aria-label="Crop"
        data-crop-mode
        className="pointer-events-auto absolute inset-x-0 top-2 mx-auto flex w-fit max-w-[calc(100%-1rem)] items-center gap-1 rounded-full bg-black/70 py-1 pr-1 pl-3 text-xs text-white shadow-sm"
      >
        <span aria-live="polite" className="min-w-0 truncate">
          Crop: drag the handles
        </span>
        <button type="button" onClick={() => edit.closeCrop(false)} title="Drop the crop (Escape)" className={cx(CROP_BAR_BUTTON, "hover:bg-white/15")}>
          Cancel
        </button>
        <button type="button" onClick={() => edit.closeCrop(true)} title="Keep the crop (Enter)" className={cx(CROP_BAR_BUTTON, "bg-accent text-on-accent hover:brightness-105")}>
          Done
        </button>
      </div>
    </div>
  );
}
