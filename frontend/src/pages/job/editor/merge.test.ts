// Seam C (.scratch/edit-sync/spec.md): merging an editor's unsaved edits onto a newer Revision, and
// rebasing its undo history, as worked examples of base (the edits the editor started from), mine
// (its unsaved edits) and theirs (the newer Revision's).
import { describe, expect, test } from "vitest";
import type { Candidate, ClipSegment, Overlay, TextLayer, Transform } from "../../../api";
import { collidedParts, fieldsOf, mergeEdits, rebaseHistory } from "./merge";

function layer(id: string, changes: Partial<TextLayer> = {}): TextLayer {
  return {
    id,
    text: id,
    start: 0,
    secs: 2,
    x: 540,
    y: 960,
    font: "Montserrat ExtraBold",
    size: 56,
    colour: "#FFFFFF",
    outline: 0,
    outline_colour: "#000000",
    box: false,
    box_colour: "#000000",
    box_opacity: 0.6,
    align: "center",
    animation_in: "none",
    animation_out: "none",
    animation_ms: 300,
    ...changes,
  };
}

const segment = (id: string, start: number): ClipSegment => ({ id, start, end: start + 5 });

const overlay = (id: string, transform: Partial<Transform> = {}): Overlay => ({
  id,
  media: "pip",
  start: 0,
  secs: 2,
  offset: 0,
  transform: { x: 540, y: 760, scale: 0.5, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1, ...transform },
  volume: 0,
});

describe("keyed lists", () => {
  test("a change on each side to different items keeps both", () => {
    const base = { text_layers: [layer("a"), layer("b")] };
    const mine = { text_layers: [layer("a", { y: 300 }), layer("b")] };
    const theirs = { text_layers: [layer("a"), layer("b", { text: "Theirs" })] };

    expect(mergeEdits(base, mine, theirs)).toEqual({
      merged: { text_layers: [layer("a", { y: 300 }), layer("b", { text: "Theirs" })] },
      collisions: [],
    });
  });

  test("a change to one Overlay's Transform on each side keeps both; one Overlay changed on both: mine wins", () => {
    const base = { overlays: [overlay("a"), overlay("b")] };
    const mine = { overlays: [overlay("a", { scale: 0.8 }), overlay("b")] };
    const theirs = { overlays: [overlay("a"), overlay("b", { rotation: 90 })] };

    expect(mergeEdits(base, mine, theirs)).toEqual({
      merged: { overlays: [overlay("a", { scale: 0.8 }), overlay("b", { rotation: 90 })] },
      collisions: [],
    });
    const both = { overlays: [overlay("a"), overlay("b", { flip_h: true })] };
    expect(mergeEdits(base, both, theirs)).toEqual({ merged: both, collisions: [{ field: "overlays", item: "b" }] });
  });

  test("an item added on each side keeps both, each after the item it followed", () => {
    const base = { text_layers: [layer("a"), layer("b")] };
    const mine = { text_layers: [layer("a"), layer("mine"), layer("b")] };
    const theirs = { text_layers: [layer("a"), layer("b"), layer("theirs")] };

    expect(mergeEdits(base, mine, theirs)).toEqual({
      merged: { text_layers: [layer("a"), layer("mine"), layer("b"), layer("theirs")] },
      collisions: [],
    });
  });

  test("the same item changed on both sides: mine wins, and it is a collision", () => {
    const base = { text_layers: [layer("a")] };
    const mine = { text_layers: [layer("a", { text: "Mine" })] };
    const theirs = { text_layers: [layer("a", { text: "Theirs", y: 200 })] };

    expect(mergeEdits(base, mine, theirs)).toEqual({
      merged: { text_layers: [layer("a", { text: "Mine" })] },
      collisions: [{ field: "text_layers", item: "a" }],
    });
  });

  test("the same change on both sides is no collision", () => {
    const base = { text_layers: [layer("a")] };
    const both = { text_layers: [layer("a", { text: "Same" })] };

    expect(mergeEdits(base, both, both)).toEqual({ merged: both, collisions: [] });
  });

  test("an item deleted on one side and left alone on the other is deleted", () => {
    const base = { text_layers: [layer("a"), layer("b")] };
    const mine = { text_layers: [layer("b")] };
    const theirs = { text_layers: [layer("a"), layer("b", { y: 100 })] };

    expect(mergeEdits(base, mine, theirs)).toEqual({ merged: { text_layers: [layer("b", { y: 100 })] }, collisions: [] });
    expect(mergeEdits(base, theirs, mine)).toEqual({ merged: { text_layers: [layer("b", { y: 100 })] }, collisions: [] });
  });

  test("an item deleted on one side and changed on the other is a collision mine wins", () => {
    const base = { text_layers: [layer("a"), layer("b")] };
    const deleted = { text_layers: [layer("b")] };
    const changed = { text_layers: [layer("a", { text: "Changed" }), layer("b")] };

    expect(mergeEdits(base, deleted, changed)).toEqual({
      merged: { text_layers: [layer("b")] },
      collisions: [{ field: "text_layers", item: "a" }],
    });
    expect(mergeEdits(base, changed, deleted)).toEqual({
      merged: { text_layers: [layer("a", { text: "Changed" }), layer("b")] },
      collisions: [{ field: "text_layers", item: "a" }],
    });
  });

  test("the Main Track takes my order when I reordered it, and their new Segment goes after the one it followed", () => {
    const [a, b, c] = [segment("a", 0), segment("b", 10), segment("c", 20)];
    const base = { segments: [a, b, c] };
    const mine = { segments: [c, a, b] };
    const theirs = { segments: [a, segment("new", 40), b, c] };

    expect(mergeEdits(base, mine, theirs)).toEqual({ merged: { segments: [c, a, segment("new", 40), b] }, collisions: [] });
  });

  test("the Main Track takes their order when only they reordered it, with my new Segment after its predecessor", () => {
    const [a, b, c] = [segment("a", 0), segment("b", 10), segment("c", 20)];
    const base = { segments: [a, b, c] };
    const mine = { segments: [a, b, segment("new", 40), c] };
    const theirs = { segments: [b, c, a] };

    expect(mergeEdits(base, mine, theirs)).toEqual({ merged: { segments: [b, segment("new", 40), c, a] }, collisions: [] });
  });
});

describe("keys", () => {
  test("Word Edits merge by their time and Transitions by the Segment they follow", () => {
    const base = { word_edits: [{ at: 1.5, text: "halo", break_before: false }], transitions: [{ after: "a", kind: "fade" as const, secs: 0.5 }] };
    const mine = { word_edits: [{ at: 1.5, text: "Halo", break_before: false }], transitions: [{ after: "a", kind: "fade" as const, secs: 1 }] };
    const theirs = {
      word_edits: [{ at: 1.5, text: "halo", break_before: false }, { at: 3.25, text: "", break_before: false }],
      transitions: [{ after: "a", kind: "fade" as const, secs: 0.5 }, { after: "b", kind: "zoomin" as const, secs: 0.5 }],
    };

    expect(mergeEdits(base, mine, theirs)).toEqual({
      merged: {
        word_edits: [{ at: 1.5, text: "Halo", break_before: false }, { at: 3.25, text: "", break_before: false }],
        transitions: [{ after: "a", kind: "fade", secs: 1 }, { after: "b", kind: "zoomin", secs: 0.5 }],
      },
      collisions: [],
    });
  });
});

describe("Style Overrides", () => {
  test("merge field by field within a section; the same field changed on both sides is a collision mine wins", () => {
    const base = { style_overrides: { caption: { size: 60 }, hook: {}, watermark: { opacity: 0.5 } } };
    const mine = { style_overrides: { caption: { size: 72, font: "Inter" }, hook: {}, watermark: { opacity: 0.8 } } };
    const theirs = { style_overrides: { caption: { size: 60, colour: "#FF0000" }, hook: { lines: 2 }, watermark: { opacity: 0.2 } } };

    expect(mergeEdits(base, mine, theirs)).toEqual({
      merged: {
        style_overrides: { caption: { size: 72, font: "Inter", colour: "#FF0000" }, hook: { lines: 2 }, watermark: { opacity: 0.8 } },
      },
      collisions: [{ field: "style_overrides", item: "watermark.opacity" }],
    });
  });

  test("an override removed on one side and left alone on the other is removed", () => {
    const base = { style_overrides: { caption: { size: 60, font: "Inter" }, hook: {}, watermark: {} } };
    const mine = { style_overrides: { caption: { font: "Inter" }, hook: {}, watermark: {} } };
    const theirs = { style_overrides: { caption: { size: 60, font: "Inter" }, hook: { lines: 3 }, watermark: {} } };

    expect(mergeEdits(base, mine, theirs).merged).toEqual({
      style_overrides: { caption: { font: "Inter" }, hook: { lines: 3 }, watermark: {} },
    });
  });
});

describe("other fields", () => {
  test("merge field by field; the same field changed on both sides is a collision mine wins", () => {
    const base = { hook_text: "Hook", hook_kicker: "", source_volume: 1, hook_start: 0 };
    const mine = { hook_text: "My hook", hook_kicker: "", source_volume: 0.5, hook_start: 0 };
    const theirs = { hook_text: "Hook", hook_kicker: "FAKTA", source_volume: 0.8, hook_start: 0 };

    expect(mergeEdits(base, mine, theirs)).toEqual({
      merged: { hook_text: "My hook", hook_kicker: "FAKTA", source_volume: 0.5, hook_start: 0 },
      collisions: [{ field: "source_volume" }],
    });
  });

  test("with nothing unsaved, theirs comes back as it is", () => {
    const base = { hook_text: "Hook", text_layers: [layer("a")], style_overrides: { caption: {}, hook: {}, watermark: {} } };
    const theirs = { hook_text: "Theirs", text_layers: [layer("b")], style_overrides: { caption: { size: 80 }, hook: {}, watermark: {} } };

    expect(mergeEdits(base, base, theirs)).toEqual({ merged: theirs, collisions: [] });
  });
});

describe("undo rebase", () => {
  test("every snapshot takes what changed elsewhere, and keeps the rest of its own", () => {
    const base = { hook_text: "Hook", source_volume: 1, text_layers: [layer("a"), layer("b")] };
    // An older step: before I moved "a" and lowered the sound. A later one: after.
    const before = { hook_text: "Hook", source_volume: 1, text_layers: [layer("a"), layer("b")] };
    const after = { hook_text: "Hook", source_volume: 0.5, text_layers: [layer("a", { y: 300 }), layer("b")] };
    // Elsewhere: a new hook, "b" retyped, "c" added.
    const theirs = { hook_text: "Their hook", source_volume: 1, text_layers: [layer("a"), layer("b", { text: "B!" }), layer("c")] };

    expect(rebaseHistory([before, after], base, theirs)).toEqual([
      { hook_text: "Their hook", source_volume: 1, text_layers: [layer("a"), layer("b", { text: "B!" }), layer("c")] },
      { hook_text: "Their hook", source_volume: 0.5, text_layers: [layer("a", { y: 300 }), layer("b", { text: "B!" }), layer("c")] },
    ]);
  });

  test("an item deleted elsewhere goes from every snapshot, even one where I had changed it", () => {
    const base = { text_layers: [layer("a"), layer("b")] };
    const step = { text_layers: [layer("a", { text: "Mine" }), layer("b")] };
    const theirs = { text_layers: [layer("b")] };

    expect(rebaseHistory([step], base, theirs)).toEqual([{ text_layers: [layer("b")] }]);
  });
});

describe("a change of some fields", () => {
  test("is merged from those fields of the Candidate it was made from, and its collisions are named as parts", () => {
    const candidate = { hook_text: "Hook", hook_kicker: "", layout: "auto", source_volume: 1 } as unknown as Candidate;
    expect(fieldsOf(candidate, { hook_text: "Mine", source_volume: 0.5 })).toEqual({ hook_text: "Hook", source_volume: 1 });
    expect(collidedParts([{ field: "hook_text" }, { field: "hook_kicker" }, { field: "text_layers", item: "a" }, { field: "start" }])).toBe(
      "Hook, Text Layers, Range",
    );
  });
});
