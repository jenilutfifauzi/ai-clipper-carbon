// Seam D (.scratch/keyframes/spec.md): the editor's pure Keyframe actions in ./keyActions.ts (set,
// remove and toggle at a time, auto-key, clear, move every one at an instant), as worked examples of the Keyframes before and after.
import { describe, expect, test } from "vitest";
import type { Keyframe, Keys, Transform } from "../../../api";
import { EASE_IN, EASE_IN_OUT, EASE_OUT, LINEAR, PICTURE_KEYS } from "../editor/keyframes";
import { IDENTITY } from "../editor/picture";
import { clearKeys, easedKey, easeName, handleEase, keyAt, keyedRange, keysAround, keyState, MAX_KEYS, moveKey, moveKeysAt, removeKey, setEase, setKey, shownTransform, toggleKey, tooManyKeys, writeKey, writtenTransform } from "./keyActions";
import { PORTRAIT } from "../editor/canvas";

const key = (at: number, value: number, ease = LINEAR): Keyframe => ({ at, value, ease });

describe("setting a Keyframe", () => {
  const keys = [key(0, 1), key(2, 2, EASE_IN)];

  test("puts it in order, with the Ease of the one before it, or Linear as the first", () => {
    expect(setKey(keys, "scale", 3, 1.5, PORTRAIT)).toEqual([key(0, 1), key(2, 2, EASE_IN), key(3, 1.5, EASE_IN)]);
    expect(setKey(keys, "scale", 1, 1.5, PORTRAIT)).toEqual([key(0, 1), key(1, 1.5), key(2, 2, EASE_IN)]);
    expect(setKey([key(1, 1, EASE_OUT)], "scale", 0.5, 2, PORTRAIT)).toEqual([key(0.5, 2), key(1, 1, EASE_OUT)]);
  });

  test("within half a frame of another replaces it, keeping its Ease", () => {
    expect(setKey(keys, "scale", 2 + 1 / 70, 3, PORTRAIT)).toEqual([key(0, 1), key(2.014, 3, EASE_IN)]);
    expect(setKey(keys, "scale", 2, 3, PORTRAIT)).toEqual([key(0, 1), key(2, 3, EASE_IN)]);
  });

  test("closer than a frame to another, which the Candidate refuses, replaces that one too", () => {
    // 0.02 s after the one at 2 s: a frame at 50 fps.
    expect(setKey(keys, "scale", 2.02, 3, PORTRAIT)).toEqual([key(0, 1), key(2.02, 3, EASE_IN)]);
  });

  test("a frame from another is a Keyframe of its own", () => {
    expect(setKey(keys, "scale", 2 + 1 / 30, 3, PORTRAIT)).toEqual([key(0, 1), key(2, 2, EASE_IN), key(2.033, 3, EASE_IN)]);
  });

  test("is held to its property's range, at a time to the millisecond", () => {
    expect(setKey([], "opacity", 0.12345, 1.4, PORTRAIT)).toEqual([key(0.123, 1)]);
    expect(setKey([], "scale", 0, 20, PORTRAIT)).toEqual([key(0, 8)]);
    expect(setKey([], "x", 0, -40, PORTRAIT)).toEqual([key(0, 0)]);
    expect(setKey([], "rotation", 0, 720, PORTRAIT)).toEqual([key(0, 720)]);
  });

  test("is not added past the hundredth, but still replaces", () => {
    const full = Array.from({ length: MAX_KEYS }, (_, i) => key(i / 10, 1));
    expect(setKey(full, "scale", 20, 2, PORTRAIT)).toBe(full);
    expect(setKey(full, "scale", 0.5, 2, PORTRAIT)[5]).toEqual(key(0.5, 2));
  });
});

describe("the Keyframe at a time", () => {
  const keys = [key(1, 1), key(2, 2), key(3, 3)];

  test("is the nearest within half a frame", () => {
    expect(keyAt(keys, 2.01)).toBe(1);
    expect(keyAt(keys, 2.02)).toBe(-1);
    expect(keyAt([], 2)).toBe(-1);
  });

  test("has neighbours beyond half a frame, for ‹ and ›", () => {
    expect(keysAround(keys, 2)).toEqual({ before: 1, after: 3 });
    expect(keysAround(keys, 2.5)).toEqual({ before: 2, after: 3 });
    expect(keysAround(keys, 0)).toEqual({ before: null, after: 1 });
    expect(keysAround(keys, 3.01)).toEqual({ before: 2, after: null });
  });

  test("makes the diamond filled there, outlined elsewhere and grey without any", () => {
    expect(keyState(keys, 2)).toBe("here");
    expect(keyState(keys, 2.5)).toBe("elsewhere");
    expect(keyState([], 2)).toBe("constant");
  });
});

describe("toggling a Keyframe", () => {
  const keys: Keys = { x: [key(0, 200), key(2, 800, EASE_IN)], volume: [key(0, 1)] };

  test("adds one with the value shown at the playhead and the Ease of the one before; again removes it", () => {
    const added = toggleKey(keys, "x", 3, 540, PORTRAIT);
    expect(added).toEqual({ keys: { ...keys, x: [key(0, 200), key(2, 800, EASE_IN), key(3, 800, EASE_IN)] }, constant: 540 });
    expect(toggleKey(added.keys, "x", 3, 540, PORTRAIT)).toEqual({ keys, constant: 540 });
  });

  test("on a constant property adds its first, at the constant, so that nothing moves", () => {
    expect(toggleKey(keys, "scale", 1.5, 1.2, PORTRAIT)).toEqual({ keys: { ...keys, scale: [key(1.5, 1.2)] }, constant: 1.2 });
  });

  test("removing the last Keyframe sets the constant to the value at the playhead", () => {
    const one: Keys = { opacity: [key(1, 0.4)] };
    expect(toggleKey(one, "opacity", 1.01, 1, PORTRAIT)).toEqual({ keys: {}, constant: 0.4 });
    expect(removeKey(one.opacity!, 1)).toEqual([]);
  });
});

describe("auto-key", () => {
  test("on a keyed property writes a Keyframe at the playhead; on an unkeyed one it changes the constant", () => {
    const keys: Keys = { scale: [key(0, 1)] };
    expect(writeKey(keys, "scale", 2, 1.5, 1, PORTRAIT)).toEqual({ keys: { scale: [key(0, 1), key(2, 1.5)] }, constant: 1 });
    expect(writeKey(keys, "opacity", 2, 0.5, 1, PORTRAIT)).toEqual({ keys, constant: 0.5 });
  });

  const transform: Transform = { ...IDENTITY, x: 300 };
  const keys: Keys = { x: [key(0, 200), key(2, 800)], volume: [key(0, 1)] };

  test("a Transform is shown with its keyed fields at the playhead", () => {
    expect(shownTransform(transform, keys, 1, PORTRAIT)).toEqual({ ...transform, x: 500 });
    expect(shownTransform(transform, {}, 1, PORTRAIT)).toBe(transform);
  });

  test("a Transform change on a keyed field writes a Keyframe at the playhead, and on an unkeyed one it changes the constant", () => {
    const shown = shownTransform(transform, keys, 1, PORTRAIT);
    expect(writtenTransform(transform, keys, { ...shown, x: 450 }, 1, PORTRAIT)).toEqual({
      transform,
      keys: { ...keys, x: [key(0, 200), key(1, 450), key(2, 800)] },
    });
    expect(writtenTransform(transform, keys, { ...shown, scale: 2, flip_h: true }, 1, PORTRAIT)).toEqual({
      transform: { ...transform, scale: 2, flip_h: true },
      keys,
    });
  });

  test("a keyed field left as shown writes nothing, by the shown Transform the change was made from", () => {
    const tidied = { ...shownTransform(transform, keys, 1.01, PORTRAIT), x: 505 };
    expect(writtenTransform(transform, keys, { ...tidied, rotation: 15 }, 1.01, PORTRAIT, tidied)).toEqual({ transform: { ...transform, rotation: 15 }, keys });
  });

  test("with the playhead outside the item, a keyed field's change is dropped", () => {
    const shown = shownTransform(transform, keys, 0, PORTRAIT);
    expect(writtenTransform(transform, keys, { ...shown, x: 540, scale: 2 }, null, PORTRAIT)).toEqual({ transform: { ...transform, scale: 2 }, keys });
  });
});

describe("a 101st Keyframe", () => {
  const full = Array.from({ length: MAX_KEYS }, (_, i) => key(i / 10, 100 + i));
  const transform: Transform = { ...IDENTITY, x: 300 };
  const keys: Keys = { x: full };

  test("refuses the edit that would add it, naming the property, and leaves everything as it was", () => {
    expect(toggleKey(keys, "x", 20, 300, PORTRAIT)).toEqual({ keys, constant: 300, full: "x" });
    expect(writeKey(keys, "x", 20, 500, 300, PORTRAIT)).toEqual({ keys, constant: 300, full: "x" });
    // The unkeyed scale isn't changed either: the whole edit is refused.
    expect(writtenTransform(transform, keys, { ...shownTransform(transform, keys, 20, PORTRAIT), x: 500, scale: 2 }, 20, PORTRAIT)).toEqual({ transform, keys, full: "x" });
    expect(tooManyKeys("x")).toBe("At most 100 Keyframes on X");
  });

  test("replacing one, or removing one, is no 101st", () => {
    expect(writeKey(keys, "x", 0.5, 7, 300, PORTRAIT).full).toBeUndefined();
    expect(toggleKey(keys, "x", 0.5, 300, PORTRAIT).full).toBeUndefined();
  });
});

describe("a keyable field's range", () => {
  test("a turn's is ±360° as a constant and ±3600° once keyed; the others' are their Keyframes'", () => {
    expect(keyedRange("rotation", false, PORTRAIT)).toEqual([-360, 360]);
    expect(keyedRange("rotation", true, PORTRAIT)).toEqual([-3600, 3600]);
    expect(keyedRange("x", false, PORTRAIT)).toEqual([0, 1080]);
    expect(keyedRange("scale", true, PORTRAIT)).toEqual([0.05, 8]);
  });
});

describe("clearing Keyframes", () => {
  const keys: Keys = { x: [key(0, 200)], scale: [key(0, 1)], volume: [key(0, 1)] };

  test("of some properties, or of all", () => {
    expect(clearKeys(keys, ["scale"])).toEqual({ x: [key(0, 200)], volume: [key(0, 1)] });
    expect(clearKeys(keys)).toEqual({});
  });

  test("Reset clears the Transform's Keyframes and keeps the sound's", () => {
    expect(clearKeys(keys, PICTURE_KEYS)).toEqual({ volume: [key(0, 1)] });
  });
});

describe("moving every Keyframe at an instant (a ruler diamond dragged)", () => {
  // An item 6 s long from the Clip's start, at 30 fps.
  const item = { secs: 6, fps: 30, start: 0 };
  const keys: Keys = {
    x: [key(0, 200), key(2, 500, EASE_IN), key(4, 800)],
    scale: [key(2, 1.5, EASE_OUT), key(5, 1)],
    opacity: [key(1, 1)],
  };

  test("moves every property's Keyframe there together, keeping their values and Eases", () => {
    expect(moveKeysAt(keys, 2, 3, item)).toEqual({
      at: 3,
      keys: { x: [key(0, 200), key(3, 500, EASE_IN), key(4, 800)], scale: [key(3, 1.5, EASE_OUT), key(5, 1)], opacity: [key(1, 1)] },
    });
  });

  test("takes those within half a frame of the instant, and leaves the rest", () => {
    const near: Keys = { x: [key(2, 500)], y: [key(2.01, 900)], scale: [key(2.5, 2)] };
    expect(moveKeysAt(near, 2, 1, item)).toEqual({ at: 1, keys: { x: [key(1, 500)], y: [key(1, 900)], scale: [key(2.5, 2)] } });
  });

  test("lands on a frame of the Clip", () => {
    expect(moveKeysAt(keys, 2, 2.51, item)?.at).toBe(2.5);
    expect(moveKeysAt(keys, 2, 2.52, item)?.at).toBe(2.533);
    // An item that starts between frames lands where the Clip's frames are, in its own seconds.
    expect(moveKeysAt({ scale: [key(1, 2)] }, 1, 2, { ...item, start: 0.01 })?.at).toBe(1.99);
  });

  test("goes no nearer than a frame to a neighbour of any of them, so never past one", () => {
    // x has one at 4 s and scale one at 5 s: the instant at 2 s stops a frame before 4 s.
    expect(moveKeysAt(keys, 2, 4.5, item)?.at).toBe(3.967);
    // And a frame after x's at 0 s.
    expect(moveKeysAt(keys, 2, -1, item)?.at).toBe(0.033);
  });

  test("stays within the item", () => {
    expect(moveKeysAt(keys, 5, 9, item)?.at).toBe(6);
    expect(moveKeysAt(keys, 1, -2, item)?.at).toBe(0);
  });

  test("with none at the instant there is nothing to move; to where they are, they stay as they are", () => {
    expect(moveKeysAt(keys, 3, 4, item)).toBeNull();
    expect(moveKeysAt(keys, 2, 2.004, item)).toEqual({ at: 2, keys });
    expect(moveKeysAt(keys, 2, 2.004, item)!.keys).toBe(keys);
  });
});

describe("an Ease set on a Keyframe", () => {
  const keys = [key(0, 1), key(2, 2), key(4, 3, EASE_IN)];

  test("by its preset stores the preset's four numbers", () => {
    expect(setEase(keys, 1, EASE_OUT)).toEqual([key(0, 1), key(2, 2, [0, 0, 0.58, 1]), key(4, 3, EASE_IN)]);
    expect(easeName([0.42, 0, 0.58, 1])).toBe("ease_in_out");
    expect(easeName([0.421, 0, 1, 1])).toBe("ease_in");
    expect(easeName([0.3, -0.5, 0.2, 1.4])).toBe("custom");
  });

  test("by a handle dragged stores a Custom one, its x kept within 0..1 and its y within -2..3", () => {
    // The first handle to (1.4, 1.6) of its span: past the span's end in time, so held at 1.
    expect(handleEase(LINEAR, 1, 1.4, 1.6)).toEqual([1, 1.6, 1, 1]);
    expect(handleEase(EASE_IN_OUT, 2, -0.3, 4)).toEqual([0.42, 0, 0, 3]);
    expect(easeName(handleEase(EASE_IN_OUT, 2, 0.2, 1.3))).toBe("custom");
    expect(setEase(keys, 2, [1.5, -3, Number.NaN, 1])).toEqual([key(0, 1), key(2, 2), key(4, 3, LINEAR)]);
    expect(setEase(keys, 2, [1.5, -3, 0.5, 1])[2].ease).toEqual([1, -2, 0.5, 1]);
  });

  test("is the one at the playhead, or the next eased one: never the first, whose Ease is unused", () => {
    expect(easedKey(keys, 2)).toBe(1);
    expect(easedKey(keys, 2.01)).toBe(1);
    expect(easedKey(keys, 2.5)).toBe(2);
    expect(easedKey(keys, 0)).toBe(1);
    expect(easedKey(keys, 4.5)).toBe(-1);
    expect(easedKey([key(1, 1)], 0)).toBe(-1);
  });
});

describe("a Keyframe dragged along its lane", () => {
  const keys = [key(0, 1), key(1, 2, EASE_IN), key(2, 3)];
  // An item starting at 0.25 s of a 30 fps Clip, 3 s long.
  const grid = { fps: 30, start: 0.25, secs: 3 };

  test("moves only it, keeping its value and Ease, to the frame nearest", () => {
    expect(moveKey(keys, 1, 1.29, grid)).toEqual([key(0, 1), key(1.283, 2, EASE_IN), key(2, 3)]);
    // On the Clip's frames: 0.25 + 1.283 s is frame 46 (1.5333 s).
    expect(Math.round((grid.start + 1.283) * 30)).toBe(46);
  });

  test("never past a neighbour: it stops a frame short of it", () => {
    expect(moveKey(keys, 1, 2.6, grid)).toEqual([key(0, 1), key(1.95, 2, EASE_IN), key(2, 3)]);
    expect(moveKey(keys, 1, -1, grid).map((k) => k.at)).toEqual([0, 0.05, 2]);
  });

  test("stays within its item", () => {
    expect(moveKey(keys, 2, 9, grid).at(-1)).toEqual(key(2.983, 3));
    expect(moveKey(keys, 0, -2, grid)[0]).toEqual(key(0.017, 1));
  });

  test("in the Curves, moves in value too, held to its property's range", () => {
    expect(moveKey(keys, 1, 0.99, grid, { prop: "opacity", value: 1.4, frame: PORTRAIT })[1]).toEqual(key(0.983, 1, EASE_IN));
  });
});
