// Seam D (.scratch/keyframes/spec.md): Keyframe edits on the items of the edits, one change each,
// at the playhead in the item's own seconds, and refused on a locked Track.
import { describe, expect, test } from "vitest";
import type { MusicClip, Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { EASE_IN, LINEAR } from "../editor/keyframes";
import { IDENTITY } from "../editor/picture";
import type { AdvancedEdits } from "./edits";
import {
  activeKey,
  clearItemKeys,
  keyableOf,
  keyedItem,
  keyTime,
  resetOverlay,
  setItemKeys,
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

  test("names what an item can key and its constants", () => {
    const item = keyedItem(edits(), O)!;
    expect([item.start, item.secs, item.constant("x"), item.constant("volume")]).toEqual([2, 4, 300, 0]);
    expect(keyedItem(edits(), M)?.constant("volume")).toBe(0.8);
    expect(keyedItem(edits(), { kind: "overlay", id: "gone" })).toBeNull();
  });
});

describe("the Keyframes pane on an item", () => {
  const moving = overlay({
    keys: {
      x: [
        { at: 0, value: 100, ease: LINEAR },
        { at: 2, value: 500, ease: EASE_IN },
      ],
      rotation: [
        { at: 0, value: 0, ease: LINEAR },
        { at: 4, value: 720, ease: LINEAR },
      ],
      volume: [{ at: 1, value: 0.5, ease: LINEAR }],
    },
  });

  test("Clear all removes every property's Keyframes, as one change, each constant left where it is at the playhead", () => {
    const cleared = clearItemKeys(scene(edits({ overlays: [moving] })), O, 3);
    // At 1 s of the Overlay: x half way (an ease-in quarter of the way is less), a turn of 180°.
    const x = 100 + 400 * 0.3153568125; // EASE_IN at 0.5
    expect(cleared?.edits.overlays[0].keys).toEqual({});
    expect(cleared?.edits.overlays[0].transform.x).toBeCloseTo(x, 3);
    expect(cleared?.edits.overlays[0].transform.rotation).toBe(180);
    expect(cleared?.edits.overlays[0].volume).toBe(0.5);
    // Outside the item, at its end; a turn past a whole one kept within ±360°.
    expect(clearItemKeys(scene(edits({ overlays: [moving] })), O, 9)?.edits.overlays[0].transform).toEqual({ ...IDENTITY, x: 500, rotation: 0 });
    expect(clearItemKeys(scene(edits({ overlays: [moving] }), ["overlay"]), O, 3)).toBeNull();
  });

  test("a property's Keyframes replaced, as a drag or an Ease leaves them, keep the others", () => {
    const list = [{ at: 0.5, value: 100, ease: LINEAR }];
    expect(setItemKeys(scene(edits({ overlays: [moving] })), O, "x", list)?.edits.overlays[0].keys).toEqual({ ...moving.keys, x: list });
    expect(setItemKeys(scene(edits(), ["music"]), M, "volume", list)).toBeNull();
  });

  test("has a row for each property its item can key", () => {
    expect(keyableOf(O, { kind: "image", has_audio: false })).toEqual(["x", "y", "scale", "rotation", "opacity"]);
    expect(keyableOf(O, { kind: "video", has_audio: true })).toEqual(["x", "y", "scale", "rotation", "opacity", "volume"]);
    expect(keyableOf(O, { kind: "video", has_audio: false })).toEqual(["x", "y", "scale", "rotation", "opacity"]);
    expect(keyableOf(M)).toEqual(["volume"]);
  });

  test("its active row is the property last touched, else the first keyed one, else Scale (Volume for a Music Clip)", () => {
    const rows = keyableOf(O, { kind: "video", has_audio: true });
    expect(activeKey(rows, moving.keys, "opacity")).toBe("opacity");
    expect(activeKey(rows, moving.keys, null)).toBe("x");
    expect(activeKey(rows, {}, null)).toBe("scale");
    expect(activeKey(["volume"], {}, "x")).toBe("volume");
  });
});
