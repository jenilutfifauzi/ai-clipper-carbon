// Seam D (.scratch/keyframes/spec.md): Keyframe edits on the items of the edits, one change each,
// at the playhead in the item's own seconds, and refused on a locked Track.
import { describe, expect, test } from "vitest";
import type { MusicClip, Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { EASE_IN, LINEAR } from "../editor/keyframes";
import { IDENTITY } from "../editor/picture";
import type { AdvancedEdits } from "./edits";
import {
  activeRow,
  keyAround,
  keyedItem,
  keyTime,
  moveItemKeys,
  pickedKeyed,
  resetOverlay,
  stageTransform,
  toggleItemKey,
  writeItemKey,
  writeItemTransform,
} from "./keying";
import { picked } from "./pick";

const overlay = (changes: Partial<Overlay> = {}): Overlay => ({
  id: "o",
  media: "logo",
  start: 2,
  secs: 4,
  offset: 0,
  transform: { ...IDENTITY, x: 300 },
  crop: NO_CROP,
  volume: 0,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
  ...changes,
});

const song = (changes: Partial<MusicClip> = {}): MusicClip => ({
  id: "m",
  media: "song",
  start: 1,
  secs: 10,
  offset: 0,
  volume: 0.8,
  fade_in: 0,
  fade_out: 0,
  keys: {},
  ...changes,
});

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
    music: [song()],
    source_volume: 1,
    segments: [{ id: "s", start: 0, end: 20 }],
    overlays: [overlay()],
    transitions: [],
    ...changes,
  };
}

const scene = (before: AdvancedEdits, locked: ("overlay" | "music")[] = []) => ({ edits: before, pick: picked({ kind: "overlay", id: "o" }), locked });
const O = { kind: "overlay", id: "o" } as const;
const M = { kind: "music", id: "m" } as const;

describe("the playhead in an item", () => {
  test("is in its own seconds, to the millisecond, and nowhere outside it", () => {
    expect(keyTime({ start: 2, secs: 4 }, 3.12345)).toBe(1.123);
    expect(keyTime({ start: 2, secs: 4 }, 6)).toBe(4);
    expect(keyTime({ start: 2, secs: 4 }, 1.9)).toBeNull();
    expect(keyTime({ start: 2, secs: 4 }, 6.1)).toBeNull();
  });
});

describe("a Keyframe edit on an item", () => {
  test("toggles a Keyframe at the playhead minus the item's start, with the value shown, as one change", () => {
    const added = toggleItemKey(scene(edits()), O, "x", 3);
    expect(added?.edits.overlays[0]).toEqual(overlay({ keys: { x: [{ at: 1, value: 300, ease: LINEAR }] } }));
    expect(added?.pick).toEqual(picked({ kind: "overlay", id: "o" }));
    const removed = toggleItemKey(scene(added!.edits), O, "x", 3);
    expect(removed?.edits.overlays[0]).toEqual(overlay());
  });

  test("removing the last Keyframe sets the constant to the value at the playhead", () => {
    const keyed = edits({ overlays: [overlay({ keys: { opacity: [{ at: 1, value: 0.25, ease: EASE_IN }] } })] });
    expect(toggleItemKey(scene(keyed), O, "opacity", 3)?.edits.overlays[0]).toEqual(overlay({ transform: { ...IDENTITY, x: 300, opacity: 0.25 } }));
  });

  test("is off with the playhead outside the item; a constant still changes there", () => {
    const keyed = edits({ music: [song({ keys: { volume: [{ at: 0, value: 1, ease: LINEAR }] } })] });
    expect(toggleItemKey(scene(edits()), O, "x", 1)).toBeNull();
    expect(writeItemKey(scene(keyed), M, "volume", 0.5, 12)).toBeNull();
    expect(writeItemKey(scene(edits()), M, "volume", 0.5, 12)?.edits.music[0]).toEqual(song({ volume: 0.5 }));
  });

  test("a locked Track refuses it", () => {
    const keyed = edits({ overlays: [overlay({ keys: { x: [{ at: 0, value: 100, ease: LINEAR }] } })] });
    expect(toggleItemKey(scene(edits(), ["overlay"]), O, "x", 3)).toBeNull();
    expect(writeItemKey(scene(edits(), ["music"]), M, "volume", 0.5, 3)).toBeNull();
    expect(writeItemTransform(scene(keyed, ["overlay"]), "o", { ...IDENTITY, x: 900 }, 3)).toBeNull();
  });

  test("a volume change writes a Keyframe once the volume is keyed, else the constant", () => {
    expect(writeItemKey(scene(edits()), M, "volume", 0.5, 3)?.edits.music[0]).toEqual(song({ volume: 0.5 }));
    const keyed = edits({ music: [song({ keys: { volume: [{ at: 0, value: 1, ease: LINEAR }] } })] });
    expect(writeItemKey(scene(keyed), M, "volume", 0.5, 3)?.edits.music[0].keys).toEqual({
      volume: [
        { at: 0, value: 1, ease: LINEAR },
        { at: 2, value: 0.5, ease: LINEAR },
      ],
    });
  });

  test("a Transform change on a keyed property writes a Keyframe at the playhead, and on an unkeyed one it changes the constant", () => {
    const keyed = edits({ overlays: [overlay({ keys: { x: [{ at: 0, value: 100, ease: LINEAR }] } })] });
    const moved = writeItemTransform(scene(keyed), "o", { ...IDENTITY, x: 900, scale: 2 }, 4);
    expect(moved?.edits.overlays[0]).toEqual(
      overlay({
        transform: { ...IDENTITY, x: 300, scale: 2 },
        keys: {
          x: [
            { at: 0, value: 100, ease: LINEAR },
            { at: 2, value: 900, ease: LINEAR },
          ],
        },
      }),
    );
  });

  test("Reset clears the Transform's Keyframes and puts its constants and Crop back", () => {
    const keyed = overlay({ crop: { ...NO_CROP, left: 0.2 }, keys: { x: [{ at: 0, value: 100, ease: LINEAR }], volume: [{ at: 0, value: 1, ease: LINEAR }] } });
    expect(resetOverlay(keyed, IDENTITY)).toEqual(overlay({ transform: IDENTITY, keys: { volume: [{ at: 0, value: 1, ease: LINEAR }] } }));
  });

  test("the Grips hold a keyed Overlay where it is at the playhead, tidied, and at its ends outside it", () => {
    const keyed = overlay({ keys: { x: [{ at: 0, value: 100, ease: LINEAR }, { at: 3, value: 200.5, ease: LINEAR }] } });
    expect(stageTransform(keyed, 3.5).x).toBe(150);
    expect(stageTransform(keyed, 9).x).toBe(201);
    const still = overlay();
    expect(stageTransform(still, 3)).toBe(still.transform);
  });

  test("a ruler diamond dragged moves every Keyframe at its instant, in Timeline time, as one change", () => {
    const keyed = edits({ overlays: [overlay({ keys: { x: [{ at: 1, value: 100, ease: LINEAR }], scale: [{ at: 1, value: 2, ease: EASE_IN }] } })] });
    const moved = moveItemKeys(scene(keyed), O, 3, 4.51, 30);
    expect(moved?.at).toBe(4.5);
    expect(moved?.edits.overlays[0].keys).toEqual({ x: [{ at: 2.5, value: 100, ease: LINEAR }], scale: [{ at: 2.5, value: 2, ease: EASE_IN }] });
    expect(moveItemKeys(scene(keyed), O, 4, 5, 30)).toBeNull();
    expect(moveItemKeys(scene(keyed, ["overlay"]), O, 3, 4, 30)).toBeNull();
  });

  test("names what an item can key and its constants", () => {
    const item = keyedItem(edits(), O)!;
    expect([item.start, item.secs, item.constant("x"), item.constant("volume")]).toEqual([2, 4, 300, 0]);
    expect(keyedItem(edits(), M)?.constant("volume")).toBe(0.8);
    expect(keyedItem(edits(), { kind: "overlay", id: "gone" })).toBeNull();
  });
});

describe("the shortcuts' item and row", () => {
  test("the item is the Pick when it is one Overlay, Music Clip or Segment", () => {
    expect(pickedKeyed(picked(O))).toEqual(O);
    expect(pickedKeyed(picked(M))).toEqual(M);
    expect(pickedKeyed(picked({ kind: "segment", id: "s" }))).toEqual({ kind: "segment", id: "s" });
    expect(pickedKeyed(picked(O, M))).toBeNull();
    expect(pickedKeyed(picked({ kind: "text", id: "t" }))).toBeNull();
    expect(pickedKeyed({ kind: "hook" })).toBeNull();
    expect(pickedKeyed(null)).toBeNull();
  });

  test("K's row is the item's property last touched, else its first keyed one, else Scale (Volume for a Music Clip)", () => {
    const keyed = keyedItem(edits({ overlays: [overlay({ keys: { opacity: [{ at: 0, value: 1, ease: LINEAR }], volume: [{ at: 0, value: 1, ease: LINEAR }] } })] }), O)!;
    expect(activeRow(O, keyed, { item: O, property: "rotation" })).toBe("rotation");
    expect(activeRow(O, keyed, null)).toBe("opacity");
    // Touched on another item, it isn't this one's.
    expect(activeRow(O, keyed, { item: { kind: "overlay", id: "other" }, property: "rotation" })).toBe("opacity");
    expect(activeRow(O, keyedItem(edits(), O)!, null)).toBe("scale");
    expect(activeRow(M, keyedItem(edits(), M)!, null)).toBe("volume");
  });

  test("[ and ] go to the item's previous and next Keyframe of any property, in Timeline time", () => {
    const item = keyedItem(edits({ overlays: [overlay({ keys: { x: [{ at: 0, value: 1, ease: LINEAR }, { at: 3, value: 2, ease: LINEAR }], scale: [{ at: 1.5, value: 1, ease: LINEAR }] } })] }), O)!;
    expect(keyAround(item, 3, -1)).toBe(2);
    expect(keyAround(item, 3, 1)).toBe(3.5);
    // On a Keyframe (within half a frame), the one before or after it.
    expect(keyAround(item, 3.5, -1)).toBe(2);
    expect(keyAround(item, 3.51, 1)).toBe(5);
    expect(keyAround(item, 5.01, 1)).toBeNull();
    // From before the item, its first.
    expect(keyAround(item, 0, 1)).toBe(2);
    expect(keyAround(item, 2, -1)).toBeNull();
  });
});
