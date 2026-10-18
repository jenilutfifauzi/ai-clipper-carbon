// .scratch/shapes/issues/06-timeline-parity.md: a Shape goes wherever a Text Layer goes on the
// Timeline (the Magnetic timeline, Ripple delete, Split all, select all, duplicate and the Clipboard,
// Edit Points and Zoom to fit, Smart Guides, several edited at once, and a tile dropped on the
// Timeline or the preview), as worked examples of the edits before and after.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { MusicClip, Picture, RenderPlan, Shape, ShapeEvent, TextLayer } from "../../../api";
import { LINEAR } from "../editor/keyframes";
import { IDENTITY } from "../editor/picture";
import { framePoint } from "../editor/pictureGestures";
import { playedFrom } from "../editor/playback";
import { picturesAt } from "../editor/smartGuides";
import { clipTrimmed, duplicate, layersOf, nudge, pickAll, remove, reshape, rippleRemove, splitAt, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import { addShape } from "./shapeStyle";
import { ShapesFields } from "./Shapes";
import { editPoints, zoomToFit } from "./timelineView";

// A white rectangle from `start` for `secs`, `side` px square.
function shape(id: string, start: number, secs: number, changes: Partial<Shape> = {}, side = 400): Shape {
  return {
    id,
    start,
    secs,
    transform: { ...IDENTITY, x: 540, y: 960 },
    style: { kind: "rectangle", width: side, height: side, fill: "#FFFFFF" },
    animation_in: "none",
    animation_out: "none",
    animation_ms: 300,
    keys: {},
    ...changes,
  };
}

// A Text Layer from `start` for `secs`: only its times matter here.
const title = (id: string, start: number, secs: number) => ({ id, start, secs }) as TextLayer;

const segment = (id: string, start: number, end: number) => ({ id, start, end });

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
    // Played back to back: s1 from 0 to 10 s, s2 from 10 to 15 s and s3 from 15 to 25 s.
    segments: [segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 310)],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

// The scene of `state` with `pick`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick, changes: Partial<PickContext> = {}): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...changes };
}

const ref = (id: string) => ({ kind: "shape", id }) as const;
const seg = (id: string) => ({ kind: "segment", id }) as const;

describe("the Magnetic timeline", () => {
  test("removing a Segment moves the Shapes after it up, cuts those across it and removes those inside, telling of them", () => {
    const keyed = shape("across", 8, 4, { keys: { opacity: [{ at: 3, value: 0.5, ease: LINEAR }] } });
    const before = edits({ shapes: [shape("before", 2, 3), shape("after", 16, 2), keyed, shape("inside", 11, 2)] });

    const outcome = remove(scene(before, picked(seg("s2")), { magnetic: true }));

    // The one across the cut keeps its first 2 s; its Keyframe 3 s in was cut, one at its end holds its value there.
    expect(outcome?.edits.shapes).toEqual([
      shape("before", 2, 3),
      shape("after", 11, 2),
      shape("across", 8, 2, { keys: { opacity: [{ at: 2, value: 0.5, ease: LINEAR }] } }),
    ]);
    expect(outcome?.notice).toBe("1 Shape inside the cut was removed.");
  });

  test("off, removing a Segment leaves the Shapes where they are", () => {
    const before = edits({ shapes: [shape("after", 16, 2)] });

    expect(remove(scene(before, picked(seg("s2"))))?.edits.shapes).toEqual(before.shapes);
  });

  test("a Segment put in moves the Shapes after it later", () => {
    const before = edits({ shapes: [shape("after", 16, 2)] });

    // Duplicating s2 puts 5 s in at 15 s.
    expect(duplicate(scene(before, picked(seg("s2")), { magnetic: true }))?.edits.shapes).toEqual([shape("after", 21, 2)]);
  });

  test("the clip editor's trim moves the Shapes with the Clip's start", () => {
    const layers = layersOf(edits({ shapes: [shape("plate", 5, 2)] }));

    expect(clipTrimmed(layers, { start: 100, end: 120 }, { start: 102, end: 120 }).layers.shapes).toEqual([shape("plate", 3, 2)]);
  });

  test("tells of Text Layers, Shapes and Music Clips inside a cut together", () => {
    const before = edits({
      text_layers: [title("t", 11, 1)],
      shapes: [shape("a", 11, 1), shape("b", 12, 2)],
      music: [{ id: "m", start: 10, secs: 4 } as MusicClip],
    });

    expect(remove(scene(before, picked(seg("s2")), { magnetic: true }))?.notice).toBe(
      "1 Text Layer, 2 Shapes and 1 Music Clip inside the cut were removed.",
    );
  });
});

describe("Ripple delete", () => {
  test("of a Shape closes the Shape Track behind it, leaving those over it and the Text Layers where they are", () => {
    const before = edits({
      shapes: [shape("gone", 2, 3), shape("over it", 4, 3), shape("next", 6, 1)],
      text_layers: [title("t", 6, 1)],
    });

    const outcome = rippleRemove(scene(before, picked(ref("gone"))));

    expect(outcome).toEqual({
      edits: { ...before, shapes: [shape("over it", 4, 3), shape("next", 3, 1)] },
      pick: null,
    });
  });

  test("of a Segment moves the Shapes after it up, with the Magnetic timeline off", () => {
    const before = edits({ shapes: [shape("later", 16, 2)] });

    expect(rippleRemove(scene(before, picked(seg("s2"))))?.edits.shapes).toEqual([shape("later", 11, 2)]);
  });
});

describe("select all and Split all", () => {
  const before = edits({
    segments: [segment("s1", 100, 110)],
    text_layers: [title("t", 3, 4)],
    shapes: [shape("under", 3, 4), shape("away", 8, 1)],
  });

  test("select all picks the Shapes too", () => {
    expect(pickAll(before)).toEqual(picked(seg("s1"), { kind: "text", id: "t" }, ref("under"), ref("away")));
  });

  test("with nothing picked, cuts the Shape under the playhead and picks its second part", () => {
    const outcome = splitAt(scene(before, null), 5);

    expect(outcome?.edits.shapes).toEqual([shape("under", 3, 2), shape("n3", 5, 2), shape("away", 8, 1)]);
    expect(outcome?.pick).toEqual(picked(seg("n1"), { kind: "text", id: "n2" }, ref("n3")));
  });

  test("skips Shapes on a locked Shape Track", () => {
    const outcome = splitAt(scene(before, null, { locked: ["shape"] }), 5);

    expect(outcome?.edits.shapes).toEqual(before.shapes);
    expect(outcome?.pick).toEqual(picked(seg("n1"), { kind: "text", id: "n2" }));
  });
});

describe("duplicate and the Clipboard", () => {
  test("a Shape duplicated goes right after itself, picked", () => {
    const before = edits({ shapes: [shape("a", 2, 3)] });

    expect(duplicate(scene(before, picked(ref("a"))))).toEqual({
      edits: { ...before, shapes: [shape("a", 2, 3), shape("n1", 5, 3)] },
      pick: picked(ref("n1")),
    });
  });

  test("a Shape copied pastes at the playhead with its look, into this Candidate or another", () => {
    const wide = shape("a", 2, 3, {}, 120);
    const before = edits({ shapes: [wide] });
    const clipboard = copy(scene(before, picked(ref("a"))), { job: "j", candidate: "one" })!;

    expect(paste(scene(before, null), clipboard, 10, { job: "j", candidate: "one" }).edits.shapes).toEqual([wide, { ...wide, id: "n1", start: 10 }]);
    const other = paste(scene(edits(), null), clipboard, 4, { job: "k", candidate: "two" });
    expect(other).toEqual({ edits: edits({ shapes: [{ ...wide, id: "n1", start: 4 }] }), pick: picked(ref("n1")) });
  });

  test("a paste leaves Shapes out on a locked Shape Track, and says so", () => {
    const clipboard = copy(scene(edits({ shapes: [shape("a", 2, 3)] }), picked(ref("a"))), { job: "j", candidate: "one" })!;

    const outcome = paste(scene(edits(), null, { locked: ["shape"] }), clipboard, 4, { job: "j", candidate: "one" });

    expect(outcome.edits.shapes).toEqual([]);
    expect(outcome.notice).toBe("1 Shape left out: their Tracks are locked.");
  });
});

describe("on the frame", () => {
  test("the arrow keys nudge a picked Shape", () => {
    const before = edits({ shapes: [shape("a", 0, 2)] });

    expect(nudge(scene(before, picked(ref("a"))), 10, -5)?.edits.shapes).toEqual([
      shape("a", 0, 2, { transform: { ...IDENTITY, x: 550, y: 955 } }),
    ]);
  });
});

describe("Edit Points and Zoom to fit", () => {
  const before = edits({ segments: [segment("s1", 100, 110)], shapes: [shape("a", 2, 3)] });
  const played = playedFrom(before.segments);

  test("a Shape's edges are Edit Points, but not while the Shape Track is hidden", () => {
    expect(editPoints(before, played, { duration: 10 })).toEqual([0, 2, 3, 5, 10]);
    expect(editPoints(before, played, { duration: 10, hidden: ["shape"] })).toEqual([0, 3, 10]);
  });

  test("a picked Shape fills the Timeline with a margin each side", () => {
    // 2–5 s with its margins is 1.85–5.15 s: 3.3 s across 1000 px, at 100 px a second at 1×, is 3.03×.
    const view = zoomToFit({ pick: picked(ref("a")), edits: before, played, duration: 10 }, { width: 1000, zoom: 1 });
    expect(view.zoom).toBeCloseTo(1000 / 3.3 / 100);
  });
});

// A Shape's event as planned: its `width` × 100 area about (x, 600), shown from `start` to `end`.
function event(id: string, x: number, width: number, start = 0, end = 2): ShapeEvent {
  const bounds = { x: x - width / 2, y: 550, width, height: 100 };
  const picture = { centre: [x, 600], width: width + 4, height: 104, rotation: 0, opacity: 1, bounds } as Picture;
  return {
    layer: shape(id, start, end - start, { transform: { ...IDENTITY, x, y: 600 } }),
    start,
    end,
    area: { x: x - width / 2, y: 550, width, height: 100 },
    image: `${id}.png`,
    picture_key: id,
    picture,
    bounds,
  };
}

describe("Smart Guides", () => {
  test("a Shape shown at the playhead is a picture another one snaps to, by its area", () => {
    const plan = { scenes: [], overlays: [], shapes: [event("a", 300, 200), event("later", 800, 100, 3, 4)], texts: [] } as unknown as RenderPlan;

    expect(picturesAt(plan, 1, null).map(({ id, picture }) => [id, picture.bounds])).toEqual([
      ["shape:a", { x: 200, y: 550, width: 200, height: 100 }],
    ]);
  });
});

describe("several Shapes picked", () => {
  const a = shape("a", 0, 2, { style: { kind: "rectangle", width: 400, height: 200, fill: "#FF0000" } });
  const b = shape("b", 3, 2, { style: { kind: "rectangle", width: 300, height: 200, fill: "#FF0000" }, animation_in: "pop" });

  test("a field set on them sets it on each, their own other fields kept", () => {
    const before = edits({ shapes: [a, b, shape("c", 6, 2)] });
    const pick = picked(ref("a"), ref("b"));
    const blue = (one: Shape): Shape => ({ ...one, style: { ...one.style, fill: "#0000FF" } });

    expect(reshape(scene(before, pick), blue)).toEqual({ edits: { ...before, shapes: [blue(a), blue(b), shape("c", 6, 2)] }, pick });
  });

  test("the inspector edits them together, a field they differ in marked Mixed", () => {
    const markup = renderToStaticMarkup(
      createElement(ShapesFields, { shapes: [a, b], onChange: () => {}, onDuplicate: () => {}, onCopy: () => {}, onDelete: () => {} }),
    );

    expect(markup).toContain("Editing 2 shapes");
    for (const label of ["Width", "Height", "Fill", "Comes on", "Goes off", "Animation length"]) expect(markup).toContain(label);
    // The widths and the ways they come on differ; the heights don't.
    expect(markup.match(/Mixed/g)).toHaveLength(2);
    expect(markup).toContain("200 px");
  });
});

describe("a Stickers tile dropped", () => {
  test("on the Timeline, the Shape starts at the drop time", () => {
    expect(addShape({ edits: edits() }, "rectangle", 7.25, 25, { id: "n" }).edits.shapes).toEqual([
      shape("n", 7.25, 3, { transform: IDENTITY }),
    ]);
  });

  test("on the preview, its centre is at the drop point, kept in the frame", () => {
    expect(addShape({ edits: edits() }, "rectangle", 1, 25, { id: "n", place: { x: 200.4, y: 300.6 } }).edits.shapes[0].transform).toMatchObject({ x: 200, y: 301 });
    expect(addShape({ edits: edits() }, "rectangle", 1, 25, { id: "n", place: { x: -10, y: 2500 } }).edits.shapes[0].transform).toMatchObject({ x: 0, y: 1920 });
  });

  test("a point on the stage is in output pixels", () => {
    // A stage 270 CSS px wide at (100, 50): a CSS pixel is 4 output pixels.
    const rect = { left: 100, top: 50, width: 270, height: 480 };
    expect(framePoint(rect, { clientX: 235, clientY: 290 }, { width: 1080, height: 1920 })).toEqual({ x: 540, y: 960 });
  });
});
