// .scratch/background-removal/issues/02-cut-out-a-source-segment-in-the-render.md: the Inspector's
// "Remove background" section gains the switch and feather of the picked Segments of the Source (and,
// issues/06, of a video's Segments and of Overlays), each change one step of undo, on a mixed Pick by
// shared fields, and their Matte's status ("Finding the subject… N%", waiting for the person model,
// failed with Retry), polled while it is made (ADR 0015).
// The phone's sheet shows the same Inspector. No jsdom: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { CandidateMatte, ClipSegment, MattePart, Overlay, PersonModelInfo } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { setBackgroundRemoval, setFeather } from "./actions";
import type { AdvancedEdits } from "./edits";
import { MATTE_POLL_MS, MATTE_SETTLE_MS, MatteSource, matteOf } from "./matte";
import { picked } from "./pick";
import { backgroundRemovalChanges, RemoveBackgroundFields, type RemovalControls } from "./RemoveBackgroundFields";

const CUT = { subject: "person" as const, feather: 4 };
const overlay: Overlay = {
  id: "o",
  media: "clip",
  start: 0,
  secs: 8,
  offset: 0,
  transform: { x: 540, y: 400, scale: 0.5, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
  crop: NO_CROP,
  volume: 1,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
};

function edits(segments: ClipSegment[]): AdvancedEdits {
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
    segments,
    overlays: [overlay],
    transitions: [],
  };
}

const state = edits([
  { id: "a", start: 1, end: 3, background_removal: { subject: "person", feather: 8 } },
  { id: "b", start: 4, end: 6 },
  { id: "m", start: 0, end: 2, media: "video" },
]);
const all = picked({ kind: "segment", id: "a" }, { kind: "segment", id: "b" }, { kind: "segment", id: "m" }, { kind: "overlay", id: "o" });
const removals = (after: AdvancedEdits) => after.segments.map((segment) => segment.background_removal);

describe("switching Background removal and its feather", () => {
  test("turns it on for every picked Segment, of the Source or a video, and Overlay as one change", () => {
    const on = setBackgroundRemoval({ edits: state, pick: all }, true)!;
    expect(removals(on.edits)).toEqual([{ subject: "person", feather: 8 }, CUT, CUT]);
    expect(on.edits.overlays).toEqual([{ ...overlay, background_removal: CUT }]);
    // Off leaves the field out; nothing changes twice.
    const off = setBackgroundRemoval({ edits: on.edits, pick: all }, false)!;
    expect([...off.edits.segments, ...off.edits.overlays].some((item) => "background_removal" in item)).toBe(false);
    expect(setBackgroundRemoval({ edits: off.edits, pick: all }, false)).toBeNull();
    // An Overlay alone.
    const alone = setBackgroundRemoval({ edits: state, pick: picked({ kind: "overlay", id: "o" }) }, true)!;
    expect(alone.edits.overlays[0].background_removal).toEqual(CUT);
    expect(alone.edits.segments).toEqual(state.segments);
  });

  test("sets the feather of every picked cut-out one, in whole pixels within 0 to 40", () => {
    const on = setBackgroundRemoval({ edits: state, pick: all }, true)!;
    const feathered = setFeather({ edits: on.edits, pick: all }, 12.4)!.edits;
    expect(removals(feathered)).toEqual([12, 12, 12].map((feather) => ({ subject: "person", feather })));
    expect(feathered.overlays[0].background_removal).toEqual({ subject: "person", feather: 12 });
    expect(removals(setFeather({ edits: on.edits, pick: all }, 99)!.edits)[0]).toEqual({ subject: "person", feather: 40 });
    // Only the cut-out ones: the others keep their switch off.
    const one = setFeather({ edits: state, pick: all }, 2)!.edits;
    expect(removals(one)).toEqual([{ subject: "person", feather: 2 }, undefined, undefined]);
    expect(one.overlays).toEqual([overlay]);
    expect(setFeather({ edits: state, pick: all }, 8)).toBeNull();
  });

  test("the section's controls make each change one step of undo, a drag of the feather one group", () => {
    const changes: [AdvancedEdits, string | undefined][] = [];
    const controls = backgroundRemovalChanges({ edits: state, pick: all }, (after, group) => changes.push([after, group]))!;
    expect(controls.removals).toEqual([{ subject: "person", feather: 8 }, null, null, null]);
    expect(controls.cut).toEqual(["a"]);
    controls.onSwitch(true);
    controls.onFeather(10, "background-removal:feather");
    expect(changes.map(([, group]) => group)).toEqual([undefined, "background-removal:feather:a,b,m,o"]);
    expect(removals(changes[1][0])[0]).toEqual({ subject: "person", feather: 10 });
    // An Overlay alone has the switch, its Matte followed by its kind; no Background of its own.
    const cutOverlay = edits(state.segments);
    cutOverlay.overlays = [{ ...overlay, background_removal: CUT }];
    const own = backgroundRemovalChanges({ edits: cutOverlay, pick: picked({ kind: "overlay", id: "o" }) }, () => {})!;
    expect(own.removals).toEqual([CUT]);
    expect(own.cut).toEqual(["overlay:o"]);
    expect(own.backgrounds).toEqual([]);
  });
});

const model: PersonModelInfo = { state: "ready", done: 1, total: 14_975_696, message: null, name: "Person model", licence: "GPL-3.0" };
const controls = (given: Partial<RemovalControls> = {}): RemovalControls => ({
  removals: [CUT],
  cut: ["a"],
  shown: "",
  onSwitch: () => {},
  onFeather: () => {},
  ...given,
});
const fields = (removal: RemovalControls | null, matte: MattePart | null = null) =>
  renderToStaticMarkup(<RemoveBackgroundFields model={model} message={null} onAction={() => {}} removal={removal} matte={matte} />);

describe("the Remove background section's switch, feather and Matte", () => {
  test("shows the switch on with the feather, Mixed when only some are on or their feathers differ", () => {
    const html = fields(controls());
    expect(html).toMatch(/role="switch"[^>]*checked=""/);
    expect(html).toContain("Keep only the person");
    expect(html).toContain("Feather");
    expect(html).toContain("4 px");
    const mixed = fields(controls({ removals: [CUT, null, { subject: "person", feather: 9 }] }));
    expect(mixed).not.toMatch(/role="switch"[^>]*checked=""/);
    expect(mixed.match(/Mixed/g)).toHaveLength(2);
    // Off: no feather; an Overlay alone: no switch, the person model only.
    expect(fields(controls({ removals: [null], cut: [] }))).not.toContain("Feather");
    expect(fields(null)).not.toContain('role="switch"');
    expect(fields(null)).toContain("Person model is on this Mac");
  });

  test("tells the Matte's progress, that it waits for the person model, or its failure with Retry", () => {
    expect(fields(controls(), { state: "making", progress: 0.4, error: null })).toContain("Finding the subject…");
    expect(fields(controls(), { state: "making", progress: 0.4, error: null })).toContain("40%");
    expect(fields(controls(), { state: "waiting", progress: 0, error: null })).toContain("once the person model is downloaded");
    const failed = fields(controls(), { state: "failed", progress: 0, error: "no subject found" });
    expect(failed).toContain("Couldn&#x27;t find the subject: no subject found");
    expect(failed).toContain("Retry finding the subject");
    expect(fields(controls(), { state: "ready", progress: 1, error: null })).toContain("Subject found.");
  });
});

const part = (state: MattePart["state"], progress = 0, error: string | null = null): MattePart => ({ state, progress, error });
const matte = (segments: Record<string, MattePart>, overlays: Record<string, MattePart> = {}): CandidateMatte => ({ ...part("ready", 1), segments, overlays });

describe("the cut-out Segments' Matte", () => {
  test("is told together: failed first, then being made (or not saved yet), then waiting, else ready", () => {
    expect(matteOf(null, [])).toBeNull();
    expect(matteOf(matte({ a: part("ready", 1) }), ["a", "b"])).toEqual(part("making", 0.5));
    expect(matteOf(matte({ a: part("making", 0.5), b: part("failed", 0, "boom") }), ["a", "b"])).toEqual(part("failed", 0.25, "boom"));
    expect(matteOf(matte({ a: part("waiting"), b: part("ready", 1) }), ["a", "b"])).toEqual(part("waiting", 0.5));
    expect(matteOf(matte({ a: part("ready", 1) }), ["a"])).toEqual(part("ready", 1));
    // An Overlay's by its kind, apart from a Segment of the same id.
    expect(matteOf(matte({ o: part("ready", 1) }, { o: part("making", 0.4) }), ["o", "overlay:o"])).toEqual(part("making", 0.7));
    expect(matteOf(matte({}, { o: part("failed", 0, "boom") }), ["overlay:o"])).toEqual(part("failed", 0, "boom"));
  });

  test("is read when the cut-out Segments change and after their save, polled while it is made, and Retry asks again", async () => {
    const answers: CandidateMatte[] = [matte({}), matte({ a: part("making", 0.3) }), matte({ a: part("failed", 0, "boom") }), matte({ a: part("ready", 1) })];
    const reads: boolean[] = [];
    const timers: { ms: number; run: () => void; off: boolean }[] = [];
    const source = new MatteSource({
      read: async (retry) => {
        reads.push(retry);
        return answers[Math.min(reads.length - 1, answers.length - 1)];
      },
      after: (ms, run) => {
        const timer = { ms, run, off: false };
        timers.push(timer);
        return () => void (timer.off = true);
      },
    });
    const fire = async (ms: number) => {
      const due = timers.filter((timer) => timer.ms === ms && !timer.off);
      for (const timer of due) timer.off = true;
      for (const timer of due) timer.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    source.watch(["a"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Not saved yet: being made, so polled; and read again after its save.
    expect(matteOf(source.state.matte, ["a"])?.state).toBe("making");
    await fire(MATTE_SETTLE_MS);
    expect(matteOf(source.state.matte, ["a"])).toEqual(part("making", 0.3));
    await fire(MATTE_POLL_MS);
    expect(matteOf(source.state.matte, ["a"])).toEqual(part("failed", 0, "boom"));
    // Failed: no more polling until Retry.
    expect(timers.filter((timer) => !timer.off)).toHaveLength(0);
    await source.retry();
    expect(reads).toEqual([false, false, false, true]);
    expect(matteOf(source.state.matte, ["a"])?.state).toBe("ready");
    source.dispose();
  });
});
