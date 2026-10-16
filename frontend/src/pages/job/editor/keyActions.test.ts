// Seam D (.scratch/keyframes/spec.md): the editor's pure Keyframe actions in ./keyframes.ts (set,
// remove and toggle at a time, auto-key, clear, move every one at an instant), as worked examples of the Keyframes before and after.
import { describe, expect, test } from "vitest";
import type { Keyframe, Keys, Transform } from "../../../api";
import {
  clearKeys,
  EASE_IN,
  EASE_OUT,
  keyAt,
  keysAround,
  keyState,
  LINEAR,
  MAX_KEYS,
  moveKeysAt,
  PICTURE_KEYS,
  removeKey,
  setKey,
  shownTransform,
  toggleKey,
  writeKey,
  writtenTransform,
} from "./keyframes";
import { IDENTITY } from "./picture";

const key = (at: number, value: number, ease = LINEAR): Keyframe => ({ at, value, ease });

describe("setting a Keyframe", () => {
  const keys = [key(0, 1), key(2, 2, EASE_IN)];

  test("puts it in order, with the Ease of the one before it, or Linear as the first", () => {
    expect(setKey(keys, "scale", 3, 1.5)).toEqual([key(0, 1), key(2, 2, EASE_IN), key(3, 1.5, EASE_IN)]);
    expect(setKey(keys, "scale", 1, 1.5)).toEqual([key(0, 1), key(1, 1.5), key(2, 2, EASE_IN)]);
    expect(setKey([key(1, 1, EASE_OUT)], "scale", 0.5, 2)).toEqual([key(0.5, 2), key(1, 1, EASE_OUT)]);
  });

  test("within half a frame of another replaces it, keeping its Ease", () => {
    expect(setKey(keys, "scale", 2 + 1 / 70, 3)).toEqual([key(0, 1), key(2.014, 3, EASE_IN)]);
    expect(setKey(keys, "scale", 2, 3)).toEqual([key(0, 1), key(2, 3, EASE_IN)]);
  });

  test("closer than a frame to another, which the Candidate refuses, replaces that one too", () => {
    // 0.02 s after the one at 2 s: a frame at 50 fps.
    expect(setKey(keys, "scale", 2.02, 3)).toEqual([key(0, 1), key(2.02, 3, EASE_IN)]);
  });

  test("a frame from another is a Keyframe of its own", () => {
    expect(setKey(keys, "scale", 2 + 1 / 30, 3)).toEqual([key(0, 1), key(2, 2, EASE_IN), key(2.033, 3, EASE_IN)]);
  });

  test("is held to its property's range, at a time to the millisecond", () => {
    expect(setKey([], "opacity", 0.12345, 1.4)).toEqual([key(0.123, 1)]);
    expect(setKey([], "scale", 0, 20)).toEqual([key(0, 8)]);
    expect(setKey([], "x", 0, -40)).toEqual([key(0, 0)]);
    expect(setKey([], "rotation", 0, 720)).toEqual([key(0, 720)]);
  });

  test("is not added past the hundredth, but still replaces", () => {
    const full = Array.from({ length: MAX_KEYS }, (_, i) => key(i / 10, 1));
    expect(setKey(full, "scale", 20, 2)).toBe(full);
    expect(setKey(full, "scale", 0.5, 2)[5]).toEqual(key(0.5, 2));
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
    const added = toggleKey(keys, "x", 3, 540);
    expect(added).toEqual({ keys: { ...keys, x: [key(0, 200), key(2, 800, EASE_IN), key(3, 800, EASE_IN)] }, constant: 540 });
    expect(toggleKey(added.keys, "x", 3, 540)).toEqual({ keys, constant: 540 });
  });

  test("on a constant property adds its first, at the constant, so that nothing moves", () => {
    expect(toggleKey(keys, "scale", 1.5, 1.2)).toEqual({ keys: { ...keys, scale: [key(1.5, 1.2)] }, constant: 1.2 });
  });

  test("removing the last Keyframe sets the constant to the value at the playhead", () => {
    const one: Keys = { opacity: [key(1, 0.4)] };
    expect(toggleKey(one, "opacity", 1.01, 1)).toEqual({ keys: {}, constant: 0.4 });
    expect(removeKey(one.opacity!, 1)).toEqual([]);
  });
});

describe("auto-key", () => {
  test("on a keyed property writes a Keyframe at the playhead; on an unkeyed one it changes the constant", () => {
    const keys: Keys = { scale: [key(0, 1)] };
    expect(writeKey(keys, "scale", 2, 1.5, 1)).toEqual({ keys: { scale: [key(0, 1), key(2, 1.5)] }, constant: 1 });
    expect(writeKey(keys, "opacity", 2, 0.5, 1)).toEqual({ keys, constant: 0.5 });
  });

  const transform: Transform = { ...IDENTITY, x: 300 };
  const keys: Keys = { x: [key(0, 200), key(2, 800)], volume: [key(0, 1)] };

  test("a Transform is shown with its keyed fields at the playhead", () => {
    expect(shownTransform(transform, keys, 1)).toEqual({ ...transform, x: 500 });
    expect(shownTransform(transform, {}, 1)).toBe(transform);
  });

  test("a Transform change on a keyed field writes a Keyframe at the playhead, and on an unkeyed one it changes the constant", () => {
    const shown = shownTransform(transform, keys, 1);
    expect(writtenTransform(transform, keys, { ...shown, x: 450 }, 1)).toEqual({
      transform,
      keys: { ...keys, x: [key(0, 200), key(1, 450), key(2, 800)] },
    });
    expect(writtenTransform(transform, keys, { ...shown, scale: 2, flip_h: true }, 1)).toEqual({
      transform: { ...transform, scale: 2, flip_h: true },
      keys,
    });
  });

  test("a keyed field left as shown writes nothing, by the shown Transform the change was made from", () => {
    const tidied = { ...shownTransform(transform, keys, 1.01), x: 505 };
    expect(writtenTransform(transform, keys, { ...tidied, rotation: 15 }, 1.01, tidied)).toEqual({ transform: { ...transform, rotation: 15 }, keys });
  });

  test("with the playhead outside the item, a keyed field's change is dropped", () => {
    const shown = shownTransform(transform, keys, 0);
    expect(writtenTransform(transform, keys, { ...shown, x: 540, scale: 2 }, null)).toEqual({ transform: { ...transform, scale: 2 }, keys });
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
  const item = { secs: 6, fps: 30 };
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
