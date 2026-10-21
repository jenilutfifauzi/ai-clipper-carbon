// .scratch/video-effects/issues/08-effects-tab.md: the Effects tab (ADR 0014). Its cards, by category
// and searched, each the frame with its effect's imitation at its defaults; a click adding the effect
// to the Pick's stacks as one undo step, skipping an item that has it and a key on a Segment or an
// Adjustment Layer; a hover drawn on the preview only; and a card dropped on the Timeline making an
// Adjustment Layer with a neutral Grade and the effect, never a key's.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AdjustmentLayer, ClipSegment, Overlay, RenderPlan, VideoEffectKind } from "../../../api";
import { videoLibraryOf } from "../../../videoEffects";
import catalogue from "../../../../../backend/tests/fixtures/video_effects.json";
import { adjustmentFilters } from "../editor/adjustments";
import { NO_CROP } from "../editor/cropGestures";
import { NEUTRAL_GRADE } from "../editor/grading";
import { playedFrom } from "../editor/playback";
import { AUDITION_LAYER, auditionedPlan, draftVideoEffects, effectsFilter, effectsFilterId } from "../editor/videoEffects";
import { addEffectLayer, addVideoEffect, keysPicked, videoEffectOf, type PickContext } from "./actions";
import type { AdvancedEdits } from "./edits";
import { EffectCards } from "./EffectsPanel";
import { picked, type Pick } from "./pick";
import { stepped, undone, type Steps } from "./useEditHistory";

const kinds = catalogue as VideoEffectKind[];
const kindOf = (id: string) => kinds.find((kind) => kind.id === id)!;
const blur = kindOf("gaussian-blur");
const chromaKey = kindOf("chroma-key");

const overlay = (id: string, changes: Partial<Overlay> = {}): Overlay => ({
  id,
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
  ...changes,
});
const layer = (id: string, changes: Partial<AdjustmentLayer> = {}): AdjustmentLayer => ({ id, start: 0, secs: 2, grade: NEUTRAL_GRADE, strength: 100, fade_in: 0, fade_out: 0, ...changes });

function edits(segments: ClipSegment[], overlays: Overlay[] = [], layers: AdjustmentLayer[] = []): AdvancedEdits {
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
    overlays,
    transitions: [],
    adjustment_layers: layers,
  };
}

// The scene of `state` with `pick`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick, changes: Partial<PickContext> = {}): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...changes };
}

const SEGMENTS: ClipSegment[] = [
  { id: "s1", start: 100, end: 110 },
  { id: "s2", start: 200, end: 210 },
];

describe("an Effects card's click", () => {
  test("adds the effect to every picked picture as one undo step, skipping one that has it", () => {
    const before = edits(SEGMENTS, [overlay("o1", { video_effects: [videoEffectOf(blur)] }), overlay("o2")]);
    const pick = picked({ kind: "segment", id: "s1" }, { kind: "overlay", id: "o1" }, { kind: "overlay", id: "o2" });
    const clicked = addVideoEffect({ edits: before, pick }, blur)!;
    expect(clicked.edits.segments[0].video_effects).toEqual([videoEffectOf(blur)]);
    expect(clicked.edits.segments[1]).toBe(before.segments[1]);
    // o1 had it already: untouched.
    expect(clicked.edits.overlays[0]).toBe(before.overlays[0]);
    expect(clicked.edits.overlays[1].video_effects).toEqual([videoEffectOf(blur)]);
    expect(clicked.pick).toBe(pick);

    let history: Steps<AdvancedEdits> = { past: [], value: before, future: [] };
    history = stepped(history, clicked.edits, false);
    expect(history.past).toHaveLength(1);
    expect(undone(history)!.value).toBe(before);
  });

  test("a Cutout card skips the picked Segments and Adjustment Layers, and does nothing without an Overlay", () => {
    const before = edits(SEGMENTS, [overlay("o1")], [layer("l1")]);
    const mixed = picked({ kind: "segment", id: "s1" }, { kind: "overlay", id: "o1" }, { kind: "adjustment", id: "l1" });
    const keyed = addVideoEffect({ edits: before, pick: mixed }, chromaKey)!.edits;
    expect(keyed.overlays[0].video_effects).toEqual([videoEffectOf(chromaKey)]);
    expect(keyed.segments).toBe(before.segments);
    expect(keyed.adjustment_layers).toBe(before.adjustment_layers);

    const noOverlay = picked({ kind: "segment", id: "s1" }, { kind: "adjustment", id: "l1" });
    expect(addVideoEffect({ edits: before, pick: noOverlay }, chromaKey)).toBeNull();
  });

  test("with nothing picked, or only other items, does nothing", () => {
    const before = edits(SEGMENTS);
    expect(addVideoEffect({ edits: before, pick: null }, blur)).toBeNull();
    expect(addVideoEffect({ edits: before, pick: picked({ kind: "text", id: "t1" }) }, blur)).toBeNull();
  });
});

describe("an Effects card dropped on the Timeline", () => {
  test("makes an Adjustment Layer with a neutral Grade and the effect at its defaults at the drop time, picked", () => {
    const outcome = addEffectLayer(scene(edits(SEGMENTS), null), blur, 7.25);
    expect(outcome).toEqual({
      edits: edits(SEGMENTS, [], [layer("n1", { start: 7.25, secs: 3, video_effects: [videoEffectOf(blur)] })]),
      pick: picked({ kind: "adjustment", id: "n1" }),
    });
  });

  test("a Cutout card makes none, nor any card on a locked Adjust Track", () => {
    expect(addEffectLayer(scene(edits(SEGMENTS), null), chromaKey, 4)).toBeNull();
    expect(addEffectLayer(scene(edits(SEGMENTS), null, { locked: ["adjust"] }), blur, 4)).toBeNull();
  });
});

describe("hovering an Effects card", () => {
  const plan = { start: 0, end: 20, segments: [{ id: "s1" }, { id: "s2" }], overlays: [{ id: "o1" }], adjustment_layers: [] } as unknown as RenderPlan;

  test("on a Pick draws the effect on it in the preview, and saves nothing", () => {
    const before = edits(SEGMENTS, [overlay("o1")]);
    const history: Steps<AdvancedEdits> = { past: [], value: before, future: [] };
    // As the Advanced Edit draws an audition: the stacks a click would make, for the preview only.
    const pick = picked({ kind: "segment", id: "s1" });
    const auditioned = addVideoEffect({ edits: before, pick }, blur)!.edits;
    const shown = draftVideoEffects(plan, auditioned.segments, auditioned.overlays, kinds, auditioned.adjustment_layers);
    expect(shown.segments[0].video_effects).toEqual([{ id: "gaussian-blur", params: { radius: blur.settings[0].default }, enabled: true }]);
    expect(shown.segments[1]).toBe(plan.segments[1]);
    expect(history.value).toBe(before);
    expect(history.past).toHaveLength(0);
    expect(before.segments[0].video_effects).toBeUndefined();
  });

  test("with nothing picked draws it over the whole frame, at any time", () => {
    const shown = auditionedPlan(plan, videoEffectOf(blur));
    expect(plan.adjustment_layers).toEqual([]);
    for (const time of [0, 9.5, 19.9]) {
      const [drawn] = adjustmentFilters(shown, time);
      expect(drawn).toMatchObject({ id: AUDITION_LAYER, weight: 1, effects: [videoEffectOf(blur)] });
      expect(drawn.filterId).toContain(effectsFilterId([videoEffectOf(blur)], { width: 1080, height: 1920 })!);
    }
  });
});

describe("the Effects tab", () => {
  const frame = { url: "/strip.jpg", strip: { index: 3, count: 30 } };
  const cardIds = (markup: string) => [...markup.matchAll(/data-effect="([^"]*)"/g)].map(([, id]) => id);
  const headings = (markup: string) => [...markup.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map(([, text]) => text);

  test("lists every catalogue effect by category, each card the frame under its effect's imitation", () => {
    const markup = renderToStaticMarkup(<EffectCards kinds={kinds} frame={frame} keys onPick={() => {}} onAudition={() => {}} />);
    expect(headings(markup)).toEqual(["Blur", "Distort", "Light", "Stylize", "Cutout"]);
    expect(cardIds(markup).sort()).toEqual(kinds.map((kind) => kind.id).sort());
    for (const kind of kinds) {
      const card = markup.slice(markup.indexOf(`data-effect="${kind.id}"`));
      const picture = card.slice(card.indexOf("data-picture"), card.indexOf("</div>"));
      expect(picture).toContain("url(/strip.jpg)");
      const filter = effectsFilter([videoEffectOf(kind)], { width: 1080, height: 608 })!;
      expect(picture).toContain(filter);
      // The filter it names is defined.
      expect(markup).toContain(`id="${filter.slice(5, -1)}"`);
    }
  });

  test("leaves the Cutout cards out without an Overlay picked, and a Cutout card can't be dragged", () => {
    const state = edits(SEGMENTS, [overlay("o1")]);
    expect(keysPicked({ edits: state, pick: picked({ kind: "segment", id: "s1" }) })).toBe(false);
    const without = renderToStaticMarkup(<EffectCards kinds={kinds} frame={frame} keys={false} onPick={() => {}} onAudition={() => {}} />);
    expect(headings(without)).not.toContain("Cutout");
    expect(cardIds(without)).not.toContain("chroma-key");

    const keyed = renderToStaticMarkup(<EffectCards kinds={kinds} frame={frame} keys onPick={() => {}} onAudition={() => {}} />);
    const draggable = (id: string) => keyed.slice(keyed.indexOf(`data-effect="${id}"`)).match(/draggable="(true|false)"/)![1];
    expect(draggable("chroma-key")).toBe("false");
    expect(draggable("luma-key")).toBe("false");
    expect(draggable("gaussian-blur")).toBe("true");
  });

  test("its search keeps the effects whose name or description has the words", () => {
    expect(videoLibraryOf(kinds, " BLUR ", false).flatMap(({ effects }) => effects.map((kind) => kind.id))).toEqual(["gaussian-blur", "motion-blur"]);
    expect(videoLibraryOf(kinds, "nothing like it", true)).toEqual([]);
  });
});
