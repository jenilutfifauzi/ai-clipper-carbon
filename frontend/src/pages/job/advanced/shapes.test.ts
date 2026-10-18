// .scratch/shapes/issues/02-tracer-a-rectangle-from-the-stickers-tab.md: a white rectangle added from
// the Stickers tab, on its Shape Track (picked, moved, trimmed and deleted, each one change), on the
// preview under the Text Layers (gripped as a Text Layer is), and in the inspector, as worked examples.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Picture, RenderPlan, Shape, ShapeEvent, TextEvent, Transform } from "../../../api";
import { mergeEdits } from "../editor/merge";
import { IDENTITY, pictureLayers } from "../editor/picture";
import { playedFrom } from "../editor/playback";
import { fingersHeld, fingerMoved, fingersOn } from "../editor/pictureGestures";
import { heldPicture } from "../editor/stagePicture";
import { heldLayerEvent, layersAt, layerStagePicture } from "../editor/layerStage";
import { LINEAR } from "../editor/keyframes";
import { move, remove, type PickContext } from "./actions";
import type { AdvancedEdits } from "./edits";
import { writeItemTransform } from "./keying";
import { NAMES, picked, stageIdsOf, stageItem, TRACK_OF, unlockedPick, type Pick } from "./pick";
import { addShape, newShape } from "./shapeStyle";
import { ShapeAssets, ShapeFields } from "./Shapes";
import { shownPlan, TRACKS, UNTOUCHED } from "./trackState";

const FRAME = { width: 1080, height: 1920 };

// A white rectangle, `width` x `height`, from `start` for `secs`.
function shape(id: string, start: number, secs: number, changes: Partial<Shape> = {}): Shape {
  return {
    id,
    start,
    secs,
    transform: { ...IDENTITY, x: 540, y: 960 },
    style: { kind: "rectangle", width: 400, height: 400, fill: "#FFFFFF" },
    animation_in: "none",
    animation_out: "none",
    animation_ms: 300,
    keys: {},
    ...changes,
  };
}

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [],
    shapes: [],
    music: [],
    source_volume: 1,
    segments: [{ id: "s1", start: 100, end: 110 }],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

function scene(state: AdvancedEdits, pick: Pick): PickContext {
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time };
}

const ref = (id: string) => ({ kind: "shape", id }) as const;

describe("the Stickers tab", () => {
  test("has one shelf, Shapes, with a square tile that adds a rectangle", () => {
    const markup = renderToStaticMarkup(createElement(ShapeAssets, { onAdd: () => {} }));
    expect(markup).toContain("Shapes");
    expect(markup).toContain('aria-label="Add a rectangle"');
  });

  test("its rectangle adds a picked 400×400 white Shape at the playhead, centred, for a new Text Layer's length, as one change", () => {
    const before = edits({ shapes: [shape("old", 0, 1)] });
    const outcome = addShape({ edits: before }, "rectangle", 2.345, 10, "n1");
    expect(outcome).toEqual({
      edits: { ...before, shapes: [shape("old", 0, 1), shape("n1", 2.35, 3)] },
      pick: picked(ref("n1")),
    });
  });

  test("near the Clip's end it starts early enough to last as long, and in a short Clip it lasts the whole Clip", () => {
    expect(newShape("rectangle", 9, 10, "a")).toMatchObject({ start: 7, secs: 3 });
    expect(newShape("rectangle", 1, 2, "b")).toMatchObject({ start: 0, secs: 2 });
  });
});

describe("a Shape on its Track", () => {
  test("is on the Shape Track, under Text, which hides and locks", () => {
    expect(TRACK_OF.shape).toBe("shape");
    expect(NAMES.shape).toBe("Shape");
    const kinds = Object.keys(TRACKS);
    expect(kinds.indexOf("shape")).toBe(kinds.indexOf("text") + 1);
    expect(TRACKS.shape).toEqual({ label: "Shape", hide: true, mute: false });
  });

  test("deleted, it goes and the rest stay, nothing picked", () => {
    const before = edits({ shapes: [shape("a", 0, 2), shape("b", 3, 2)] });
    expect(remove(scene(before, picked(ref("a"))))).toEqual({ edits: { ...before, shapes: [shape("b", 3, 2)] }, pick: null });
  });

  test("moved, it goes later or earlier with its picked company, kept in the Clip", () => {
    const before = edits({ shapes: [shape("a", 1, 2)] });
    expect(move(scene(before, picked(ref("a"))), 2.5)?.edits.shapes).toEqual([shape("a", 3.5, 2)]);
    expect(move(scene(before, picked(ref("a"))), 20)?.edits.shapes).toEqual([shape("a", 8, 2)]);
    expect(move(scene(before, picked(ref("a"))), -5)?.edits.shapes).toEqual([shape("a", 0, 2)]);
  });

  test("on a locked Shape Track, it can't be picked", () => {
    const pick = picked(ref("a"), { kind: "text", id: "t" });
    expect(unlockedPick(pick, ["shape"])).toEqual(picked({ kind: "text", id: "t" }));
  });

  test("another editor's new Shape is merged in beside this editor's changed one", () => {
    const base = edits({ shapes: [shape("a", 0, 2)] });
    const mine = edits({ shapes: [shape("a", 1, 2)] });
    const theirs = edits({ shapes: [shape("a", 0, 2), shape("b", 4, 1)] });
    expect(mergeEdits(base, mine, theirs)).toEqual({ merged: edits({ shapes: [shape("a", 1, 2), shape("b", 4, 1)] }), collisions: [] });
  });
});

// A Shape's event as planned: its 400×400 area about its Transform's centre, its picture 404 px
// square (its room round it), made at scale 1.
function event(transform: Partial<Transform> = {}): ShapeEvent {
  const placedBy = { ...IDENTITY, x: 540, y: 600, ...transform };
  const { scale } = placedBy;
  const picture: Picture = {
    crop: { x: 0, y: 0, width: 404, height: 404 },
    item_size: [404, 404],
    width: 404 * scale,
    height: 404 * scale,
    centre: [540, 600],
    rotation: placedBy.rotation,
    flip_h: false,
    flip_v: false,
    opacity: placedBy.opacity,
    bounds: { x: 540 - 200 * scale, y: 600 - 200 * scale, width: 400 * scale, height: 400 * scale },
    radius: 0,
    border: null,
    shadow: null,
  };
  return {
    layer: shape("r", 0, 2, { transform: placedBy }),
    start: 0,
    end: 2,
    area: { x: 340, y: 400, width: 400, height: 400 },
    image: "rect.png",
    picture_key: "rect",
    picture,
    bounds: picture.bounds,
  };
}

const title = { layer: { id: "t" }, start: 0, end: 2 } as TextEvent;

describe("a Shape on the preview", () => {
  test("is drawn over the captions and under the Text Layers, by its id on the stage", () => {
    const rectangle = event();
    const plan = { shapes: [rectangle], texts: [title] } as RenderPlan;
    expect(pictureLayers(plan)).toEqual([
      { id: "shape:r", event: rectangle },
      { id: "text:t", event: title },
    ]);
    expect(stageIdsOf(picked(ref("r")))).toEqual(["shape:r"]);
    expect(stageItem("shape:r")).toEqual(ref("r"));
  });

  test("is hidden with its Track, the rest drawn", () => {
    const plan = { shapes: [event()], texts: [title], overlays: [], captions: [], hook: null } as unknown as RenderPlan;
    expect(shownPlan(plan, { ...UNTOUCHED, hidden: ["shape"] })).toMatchObject({ shapes: [], texts: [title] });
  });

  test("keyed, is where its Keyframes have it at a time", () => {
    const motion = { x: [{ at: 0, value: 200, ease: LINEAR }, { at: 2, value: 800, ease: LINEAR }] };
    const moving: ShapeEvent = { ...event(), picture: { ...event().picture, motion, unscaled: [404, 404] } };
    const { shapes } = layersAt({ shapes: [moving], texts: [] } as unknown as RenderPlan, 1);
    expect(shapes[0].layer.transform.x).toBe(500);
  });

  test("a corner Grip scales it about its centre and the handle turns it, its size as it was", () => {
    const planned = event();
    const { picture, fitted } = layerStagePicture(planned);
    expect(fitted).toEqual({ width: 400, height: 400 });
    const grab = { transform: planned.layer.transform, fitted, frame: FRAME };
    // The bottom-right corner (740, 800) dragged half as far again from the centre.
    const scaled = fingersHeld(fingerMoved(fingersOn(grab, "bottom-right", 1, { x: 740, y: 800 }), 1, { x: 840, y: 900 }), {});
    expect(scaled).toEqual({ ...planned.layer.transform, scale: 1.5 });
    const held = heldLayerEvent(planned, picture, heldPicture(picture, scaled, FRAME, fitted));
    expect(held.image).toBe(planned.image);
    expect(held.bounds).toEqual({ x: 240, y: 300, width: 600, height: 600 });
    // From straight above its centre to straight right of it: a quarter turn clockwise.
    const turned = fingersHeld(fingerMoved(fingersOn(grab, "rotate", 1, { x: 540, y: 400 }), 1, { x: 640, y: 600 }), {});
    expect(turned).toEqual({ ...planned.layer.transform, rotation: 90 });
  });

  test("where a Grip puts it is saved as its Transform, one change", () => {
    const before = edits({ shapes: [shape("a", 0, 2)] });
    const put = { ...IDENTITY, x: 300, y: 500, scale: 1.5, rotation: 30 };
    const outcome = writeItemTransform({ edits: before, pick: picked(ref("a")) }, ref("a"), put, 1);
    expect(outcome?.edits.shapes).toEqual([shape("a", 0, 2, { transform: put })]);
    // Not on a locked Shape Track.
    expect(writeItemTransform({ edits: before, pick: null, locked: ["shape"] }, ref("a"), put, 1)).toBeNull();
  });
});

describe("a Shape in the inspector", () => {
  test("shows its width, height and fill, its Transform and its timing", () => {
    const markup = renderToStaticMarkup(
      createElement(ShapeFields, { shape: shape("a", 1, 2), duration: 10, onChange: () => {}, onDuplicate: () => {}, onDelete: () => {} }),
    );
    for (const label of ["Width", "Height", "Fill", "Scale", "Rotation", "Opacity", "Comes on at", "Stays for"]) expect(markup).toContain(label);
    expect(markup).toContain("400 px");
  });
});
