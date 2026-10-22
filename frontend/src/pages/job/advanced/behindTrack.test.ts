// .scratch/background-removal/issues/05-overlays-behind-the-main-track.md: the Behind Track (ADR
// 0015) holds the Overlays Behind the Main Track and behaves as the Overlay Track does: its own lanes,
// hide, mute and lock, the Magnetic timeline, Ripple delete, Split all and the Edit Points; the
// Inspector's switch moves an Overlay between the two, as one change.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ClipSegment, Overlay, OverlayEvent, RenderPlan } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { Playback, playedFrom } from "../editor/playback";
import { BehindOverlays, coversFrame } from "../editor/PreviewOverlays";
import { remove, rippleRemove, setBehind, sharedBehind, splitAt, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import { trackLanes, type AdvancedEdits } from "./edits";
import { BehindSwitch, newOverlay } from "./Overlays";
import { overlaysOn, picked, unlockedPick, type Pick } from "./pick";
import { editPoints } from "./timelineView";
import { heardDraft, shownPlan, UNTOUCHED } from "./trackState";

const overlay = (id: string, start: number, secs: number, changes: Partial<Overlay> = {}): Overlay => ({
  id,
  media: "clip",
  start,
  secs,
  offset: 0,
  transform: { x: 540, y: 400, scale: 0.5, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
  crop: NO_CROP,
  volume: 1,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
  ...changes,
});
const behind = (id: string, start: number, secs: number, changes: Partial<Overlay> = {}) => overlay(id, start, secs, { behind: true, ...changes });
const ref = (id: string) => ({ kind: "overlay" as const, id });

// Played back to back: s1 from 0 to 10 s, s2 from 10 to 15 s and s3 from 15 to 25 s.
const SEGMENTS: ClipSegment[] = [
  { id: "s1", start: 100, end: 110 },
  { id: "s2", start: 200, end: 205 },
  { id: "s3", start: 300, end: 310 },
];

function edits(overlays: Overlay[]): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    preset_id: "default",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    cue_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [],
    shapes: [],
    music: [],
    source_volume: 1,
    segments: SEGMENTS,
    overlays,
    transitions: [],
  };
}

function scene(state: AdvancedEdits, pick: Pick = null, more: Partial<PickContext> = {}): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...more };
}

const spans = (overlays: Overlay[]) => overlays.map(({ id, start, secs, behind: under }) => [id, start, secs, !!under]);

describe("the Behind Track's lanes", () => {
  test("are worked out from its own Overlays' overlaps, apart from the Overlay Track's", () => {
    const overlays = [overlay("f", 2, 6), behind("a", 1, 4), behind("b", 3, 4), behind("c", 6, 2)];
    expect(trackLanes(overlaysOn(overlays, "overlay")).map((lane) => lane.map((each) => each.id))).toEqual([["f"]]);
    expect(trackLanes(overlaysOn(overlays, "behind")).map((lane) => lane.map((each) => each.id))).toEqual([["a", "c"], ["b"]]);
  });

  test("an item dropped on it is an Overlay Behind the Main Track; one dropped on the Overlay Track has no field", () => {
    const item = { id: "m", kind: "image", name: "B-roll", width: 1920, height: 1080, duration: null, has_audio: false } as never;
    expect(newOverlay(item, 2, 25, true).behind).toBe(true);
    expect("behind" in newOverlay(item, 2, 25)).toBe(false);
  });
});

describe("the Magnetic timeline and Ripple delete", () => {
  test("a Segment removed moves the Behind Overlays after it, cuts those across it and removes those inside it, as any layer", () => {
    const before = edits([behind("inside", 11, 2), behind("across", 8, 4), behind("after", 16, 3), overlay("f", 16, 3)]);
    const outcome = remove(scene(before, picked({ kind: "segment", id: "s2" }), { magnetic: true }))!;
    expect(spans(outcome.edits.overlays)).toEqual([
      ["across", 8, 2, true],
      ["after", 11, 3, true],
      ["f", 11, 3, false],
    ]);
    expect(outcome.notice).toBe("1 Overlay inside the cut was removed.");
  });

  test("Ripple delete of a Behind Overlay moves up the later ones of its own Track only", () => {
    const before = edits([behind("gone", 2, 3), behind("later", 6, 2), overlay("front", 6, 2)]);
    const outcome = rippleRemove(scene(before, picked(ref("gone"))))!;
    expect(spans(outcome.edits.overlays)).toEqual([
      ["later", 3, 2, true],
      ["front", 6, 2, false],
    ]);
  });

  test("Ripple delete of an Overlay over the Main Track leaves the Behind Track as it was", () => {
    const before = edits([overlay("gone", 2, 3), overlay("later", 6, 2), behind("under", 6, 2)]);
    expect(spans(rippleRemove(scene(before, picked(ref("gone"))))!.edits.overlays)).toEqual([
      ["later", 3, 2, false],
      ["under", 6, 2, true],
    ]);
  });
});

describe("Split all", () => {
  const before = edits([behind("b", 4, 4), overlay("f", 4, 4)]);

  test("splits a Behind Overlay at the playhead, both parts Behind", () => {
    const outcome = splitAt(scene(before), 6)!;
    expect(spans(outcome.edits.overlays)).toEqual([
      ["b", 4, 2, true],
      ["n2", 6, 2, true],
      ["f", 4, 2, false],
      ["n3", 6, 2, false],
    ]);
  });

  test("leaves it whole on a locked Behind Track, and the Overlay Track's still splits", () => {
    const outcome = splitAt(scene(before, null, { locked: ["behind"] }), 6)!;
    expect(spans(outcome.edits.overlays)).toEqual([
      ["b", 4, 4, true],
      ["f", 4, 2, false],
      ["n2", 6, 2, false],
    ]);
  });
});

describe("hide, mute and lock", () => {
  const event = (id: string) => ({ id }) as OverlayEvent;
  const plan = { overlays: [event("f")], behind: [event("b")] } as RenderPlan;

  test("hiding the Behind Track leaves its Overlays out of the preview's plan, and the Overlay Track's in", () => {
    expect(shownPlan(plan, { ...UNTOUCHED, hidden: ["behind"] })).toMatchObject({ overlays: [event("f")], behind: [] });
    expect(shownPlan(plan, { ...UNTOUCHED, hidden: ["overlay"] })).toMatchObject({ overlays: [], behind: [event("b")] });
  });

  test("muting it silences its Overlays' videos only", () => {
    const draft = { overlays: [overlay("f", 0, 2), behind("b", 0, 2)] };
    expect(heardDraft(draft, { ...UNTOUCHED, muted: ["behind"] }).overlays!.map((each) => each.volume)).toEqual([1, 0]);
    expect(heardDraft(draft, { ...UNTOUCHED, muted: ["overlay"] }).overlays!.map((each) => each.volume)).toEqual([0, 1]);
  });

  test("locking it unpicks its Overlays, and the Overlay Track's stay picked", () => {
    const state = edits([overlay("f", 0, 2), behind("b", 0, 2)]);
    expect(unlockedPick(picked(ref("f"), ref("b")), ["behind"], state)).toEqual(picked(ref("f")));
  });

  test("pasting onto a locked Behind Track leaves its Overlays out", () => {
    const state = edits([behind("b", 1, 2), overlay("f", 1, 2)]);
    const clipboard = copy(scene(state, picked(ref("b"), ref("f"))), { job: "j", candidate: "c" })!;
    const outcome = paste(scene(state, null, { locked: ["behind"] }), clipboard, 8, { job: "j", candidate: "c" });
    expect(spans(outcome.edits.overlays).filter(([id]) => id !== "b" && id !== "f")).toEqual([[expect.any(String), 8, 2, false]]);
    expect(outcome.notice).toBe("1 Overlay left out: their Tracks are locked.");
  });

  test("a hidden Behind Track's edges aren't Edit Points", () => {
    const state = edits([behind("b", 4, 3)]);
    const played = playedFrom(state.segments);
    expect(editPoints(state, played, { duration: 25 })).toEqual([0, 3, 4, 7, 10, 15, 25]);
    // The hook's end (3 s) stays.
    expect(editPoints(state, played, { duration: 25, hidden: ["behind"] })).toEqual([0, 3, 10, 15, 25]);
  });
});

describe("the Inspector's Behind the Main Track switch", () => {
  const before = edits([overlay("o", 2, 3, { blend: "screen" }), overlay("p", 6, 2)]);

  test("moves an Overlay onto the Behind Track and back, as one change, keeping its time and the Pick", () => {
    const pick = picked(ref("o"));
    const under = setBehind({ edits: before, pick }, true)!;
    expect(under).toEqual({ edits: { ...before, overlays: [{ ...before.overlays[0], behind: true }, before.overlays[1]] }, pick });
    expect(overlaysOn(under.edits.overlays, "behind").map((each) => each.id)).toEqual(["o"]);
    // Back over it, without the field, as one saved before.
    expect(setBehind({ edits: under.edits, pick }, false)!.edits).toEqual(before);
    expect(setBehind({ edits: before, pick }, false)).toBeNull();
    expect(setBehind({ edits: before, pick: null }, true)).toBeNull();
  });

  test("is refused onto a locked Track, with a notice", () => {
    const pick = picked(ref("o"));
    expect(setBehind({ edits: before, pick, locked: ["behind"] }, true)).toEqual({ edits: before, pick, notice: "The Behind Track is locked." });
  });

  describe("on a Pick of several Overlays", () => {
    const mixed = edits([overlay("o", 2, 3), behind("b", 4, 3), overlay("p", 6, 2), { ...overlay("q", 9, 1) }]);
    const both = picked(ref("o"), ref("b"));

    test("is shared: on or off when every picked Overlay is, Mixed when they differ, none without an Overlay", () => {
      expect(sharedBehind({ edits: mixed, pick: both })).toBe("mixed");
      expect(sharedBehind({ edits: mixed, pick: picked(ref("o"), ref("p")) })).toBe(false);
      expect(sharedBehind({ edits: mixed, pick: picked(ref("b")) })).toBe(true);
      expect(sharedBehind({ edits: mixed, pick: picked({ kind: "segment", id: "s1" }) })).toBeNull();
      expect(sharedBehind({ edits: mixed, pick: null })).toBeNull();
    });

    test("switched on, moves them all Behind as one change; off, all back over it; the others untouched", () => {
      const pick = picked(ref("o"), ref("b"), ref("p"));
      const under = setBehind({ edits: mixed, pick }, true)!;
      expect(under.pick).toBe(pick);
      expect(overlaysOn(under.edits.overlays, "behind").map((each) => each.id)).toEqual(["o", "b", "p"]);
      expect(under.edits.overlays[3]).toBe(mixed.overlays[3]);
      // The one already there is kept as it was.
      expect(under.edits.overlays[1]).toBe(mixed.overlays[1]);
      const over = setBehind({ edits: under.edits, pick }, false)!;
      expect(overlaysOn(over.edits.overlays, "behind")).toEqual([]);
      expect(over.edits.overlays.every((each) => !("behind" in each))).toBe(true);
    });

    test("is refused, with a notice, when any would move onto or off a locked Track", () => {
      expect(setBehind({ edits: mixed, pick: both, locked: ["behind"] }, true)).toEqual({ edits: mixed, pick: both, notice: "The Behind Track is locked." });
      expect(setBehind({ edits: mixed, pick: both, locked: ["overlay"] }, false)).toEqual({ edits: mixed, pick: both, notice: "The Overlay Track is locked." });
      // Switched on, the one over the Main Track would move off the locked Overlay Track.
      expect(setBehind({ edits: mixed, pick: both, locked: ["overlay"] }, true)).toEqual({ edits: mixed, pick: both, notice: "The Overlay Track is locked." });
    });

    test("the Inspector's switch shows Mixed, off, when they differ", () => {
      const markup = renderToStaticMarkup(createElement(BehindSwitch, { behind: "mixed", onChange: () => {} }));
      expect(markup).toContain("Mixed");
      expect(markup).not.toContain('checked=""');
    });
  });

  test("is shown, on when the Overlay is Behind", () => {
    const markup = renderToStaticMarkup(createElement(BehindSwitch, { behind: true, onChange: () => {} }));
    expect(markup).toContain("Behind the Main Track");
    expect(markup).toContain('role="switch" class="peer sr-only" checked=""');
  });
});

describe("the preview", () => {
  const picture = (changes: Partial<OverlayEvent["picture"]> = {}): OverlayEvent["picture"] => ({
    crop: { x: 0, y: 0, width: 1920, height: 1080 },
    item_size: [1920, 1080],
    width: 3414,
    height: 1920,
    centre: [540, 960],
    rotation: 0,
    flip_h: false,
    flip_v: false,
    opacity: 1,
    bounds: { x: -1167, y: 0, width: 3414, height: 1920 },
    radius: 0,
    border: null,
    shadow: null,
    ...changes,
  });
  const FRAME = { width: 1080, height: 1920 };

  test("a picture covering the frame hides the Behind Overlays; one smaller, see-through, turned or keyed doesn't", () => {
    expect(coversFrame(picture(), FRAME)).toBe(true);
    expect(coversFrame(picture({ width: 1080, height: 608 }), FRAME)).toBe(false);
    expect(coversFrame(picture({ opacity: 0.9 }), FRAME)).toBe(false);
    expect(coversFrame(picture({ rotation: 5 }), FRAME)).toBe(false);
    expect(coversFrame(picture({ motion: { x: [{ at: 0, value: 540, ease: [0, 0, 1, 1] }] } }), FRAME)).toBe(false);
    expect(coversFrame(null, FRAME)).toBe(false);
  });

  test("draws the plan's Behind Overlays, and nothing without any (or with the Behind Track hidden)", () => {
    const event = { id: "b", media: "m", picture: picture({ width: 540, height: 304, centre: [270, 152] }), start: 0, end: 2, offset: 0, image: true } as OverlayEvent;
    const plan = { width: 1080, height: 1920, overlays: [], behind: [event] } as unknown as RenderPlan;
    const playback = new Playback();
    // Its Overlays drawn as the others are (PreviewOverlays), from the plan's `behind`.
    const drawn = BehindOverlays({ plan, playback, className: "invisible" });
    expect(drawn?.props.className).toContain("invisible");
    expect(drawn?.props.children.props).toMatchObject({ plan, events: [event] });
    expect(BehindOverlays({ plan: shownPlan(plan, { ...UNTOUCHED, hidden: ["behind"] }), playback })).toBeNull();
  });
});
