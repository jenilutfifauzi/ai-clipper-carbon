// .scratch/background-removal/issues/12: the Behind Overlays (ADR 0015) on the stage. They are drawn
// under the Segment's picture, so a press reaches one only where that picture doesn't show: outside
// it (a Manual or media picture that doesn't cover the frame, a Split's gap), or where it is cut out
// and its Matte has taken it away. Worked out from the plan's numbers, but for how much of the cut
// picture is left at a spot, which the preview's cut canvas says (`cutAlpha`).
import type { Picture, ScenePlan } from "../../../api";
import { pictureAt } from "./picture";
import { offsetOnPicture, type Point, type Size } from "./pictureGestures";

/** A spot on an item's own frame, in shares of its width (`u`) and height (`v`). */
export interface Spot {
  u: number;
  v: number;
}

// Where `point` falls on `picture` (as drawn: turned, flipped and cropped), on its item's frame; null off it.
function spotOnPicture(picture: Picture, point: Point): Spot | null {
  const [x, y] = picture.centre;
  const { along, down } = offsetOnPicture({ x, y, rotation: picture.rotation }, point);
  let across = along / picture.width + 0.5;
  let downward = down / picture.height + 0.5;
  if (across < 0 || across > 1 || downward < 0 || downward > 1) return null;
  if (picture.flip_h) across = 1 - across;
  if (picture.flip_v) downward = 1 - downward;
  const {
    crop,
    item_size: [width, height],
  } = picture;
  return {
    u: (crop.x + across * crop.width) / width,
    v: (crop.y + downward * crop.height) / height,
  };
}

/**
 * Where the picture of `scene` shows at `point` (output pixels) at `time` seconds into the Clip, on
 * its item's frame (`source`: the Source's size, which a panel crops): on its one picture (a Manual
 * or media Scene's), or on a panel that isn't a Blur fill; null where it doesn't show.
 */
export function pictureSpot(scene: ScenePlan, point: Point, time: number, source: Size): Spot | null {
  if (scene.picture) return spotOnPicture(pictureAt(scene.picture, time), point);
  // The panels drawn last are on top.
  for (const panel of [...scene.panels].reverse()) {
    if (panel.blur) continue;
    const { area } = panel;
    const across = (point.x - area.x) / area.width;
    const downward = (point.y - area.y) / area.height;
    if (across < 0 || across > 1 || downward < 0 || downward > 1) continue;
    const from = [...panel.path].reverse().find((each) => each.at <= time) ?? panel.path[0];
    if (!from) continue;
    return {
      u: (from.x + across * panel.crop_width) / source.width,
      v: (from.y + downward * panel.crop_height) / source.height,
    };
  }
  return null;
}

/** A Behind Overlay as the stage reaches it: its id there, its picture, and when it shows. */
export interface BehindTarget {
  id: string;
  picture: Picture;
  start: number;
  end: number;
}

/**
 * The Behind Overlay a press at `point` reaches at `time`: the last drawn (the topmost) of `behind`
 * showing then whose picture holds `point`, unless the Segment's picture `shows` there; null
 * without one.
 */
export function reachedBehind(behind: BehindTarget[], point: Point, time: number, shows: (point: Point) => boolean): string | null {
  const under = [...behind].reverse().find((each) => each.start <= time && time < each.end && spotOnPicture(pictureAt(each.picture, time), point));
  if (!under || shows(point)) return null;
  return under.id;
}

// Of the cut picture, how much a spot must keep to count as showing: the Matte's middle grey.
const SHOWN_ALPHA = 0.5;

/**
 * Whether the Segment's picture of `scene` shows at `point` at `time`: on it, and, where its cut is
 * drawn (`alpha` of a spot: how much of it the Matte keeps, null when it is shown whole), kept there.
 */
export function segmentShows(scene: ScenePlan | undefined, point: Point, time: number, source: Size, alpha: (spot: Spot) => number | null): boolean {
  const spot = scene && pictureSpot(scene, point, time, source);
  if (!spot) return false;
  const kept = alpha(spot);
  return kept === null || kept >= SHOWN_ALPHA;
}

/**
 * How much of the cut picture `name` (a cut canvas's `data-cut-picture`: "source" for the Source's,
 * "segment:<id>" for a media Segment's) is kept at `spot`, read off its canvas on `stage` that is
 * shown now (under a `data-cut` group, not hidden); null where none is, as when it is shown whole.
 * A canvas draws its item's whole frame, so the spot is a share of it.
 */
export function cutAlpha(stage: HTMLElement | null, name: string, spot: Spot): number | null {
  for (const canvas of stage?.querySelectorAll<HTMLCanvasElement>(`canvas[data-cut-picture="${name}"]`) ?? []) {
    if (!canvas.width || !canvas.height || !canvas.closest("[data-cut]")) continue;
    if (
      canvas.checkVisibility &&
      !canvas.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
      })
    )
      continue;
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(spot.u * canvas.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor(spot.v * canvas.height)));
    const pixel = canvas.getContext("2d")?.getImageData(x, y, 1, 1).data;
    if (pixel) return pixel[3] / 255;
  }
  return null;
}
