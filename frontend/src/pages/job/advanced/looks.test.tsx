// .scratch/color-adjust/issues/05-built-in-looks-and-filters-tab.md: built-in Looks (ADR 0013). The
// Filters tab's cards, given to a Pick of Segments and Overlays or the Candidate as one undo step,
// auditioned without saving; the Color section's Look picker, intensity and remove; and the fold of
// a Grade with a Look known from the catalogue (the fold itself is pinned by the shared fixture in
// editor/grading.test.tsx).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ClipSegment, Grade, Look, MediaItem, Overlay, RenderPlan } from "../../../api";
import { shelvesOf } from "../../../looks";
import { adjusted, draftGrades, foldGrade, gradeFilter, gradeFilterId, knowLooks, NEUTRAL_ADJUST, NEUTRAL_GRADE, relooked } from "../editor/grading";
import { playedFrom } from "../editor/playback";
import { relook } from "./actions";
import { ColorFields } from "./ColorFields";
import type { AdvancedEdits } from "./edits";
import { LookCards, lookFrame, lookGrade } from "./LookPanel";
import { picked } from "./pick";
import { stepped, undone, type Steps } from "./useEditHistory";

const look = (id: string, category: string, order: number, adjust: Partial<Look["adjust"]>): Look => ({
  id,
  name: id.toUpperCase(),
  category,
  order,
  adjust: { ...NEUTRAL_ADJUST, ...adjust },
});
const LOOKS = [
  look("noir", "Black & White", 500, { saturation: -100, contrast: 30 }),
  look("blockbuster", "Cinematic", 100, { temperature: 7300, contrast: 25 }),
  look("moody", "Cinematic", 110, { saturation: -20, vignette: 30 }),
];
knowLooks(LOOKS);

const WARM: Grade = adjusted(NEUTRAL_GRADE, { temperature: 8500, contrast: 20 });
const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const overlay = (id: string, changes: Partial<Overlay> = {}): Overlay => ({ id, media: "pic", start: 1, secs: 2, offset: 0, ...changes }) as Overlay;
const seg = (id: string) => ({ kind: "segment", id }) as const;
const over = (id: string) => ({ kind: "overlay", id }) as const;

function edits(segments: ClipSegment[], overlays: Overlay[], grade: Grade = NEUTRAL_GRADE): AdvancedEdits {
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
    grade,
  } as AdvancedEdits;
}

describe("a Filters card's click", () => {
  test("on a mixed Pick of Segments and Overlays sets their Looks, keeping their dials, in one undo step", () => {
    const before = edits([segment("s1", 100, 106, { grade: WARM }), segment("s2", 200, 204)], [overlay("o1"), overlay("o2")]);
    const pick = picked(seg("s1"), over("o1"));
    const clicked = relook({ edits: before, pick }, { look: "noir" })!;
    expect(clicked.edits.segments[0].grade).toEqual({ ...WARM, look: "noir" });
    expect(clicked.edits.overlays[0].grade).toEqual({ ...NEUTRAL_GRADE, look: "noir" });
    expect(clicked.edits.segments[1].grade).toBeUndefined();
    expect(clicked.edits.overlays[1].grade).toBeUndefined();
    expect(clicked.edits.grade).toBe(before.grade);
    expect(clicked.pick).toBe(pick);

    let history: Steps<AdvancedEdits> = { past: [], value: before, future: [] };
    history = stepped(history, clicked.edits, false);
    expect(history.past).toHaveLength(1);
    expect(undone(history)!.value).toBe(before);
  });

  test("with nothing picked sets the Candidate's Look, its Segments' and Overlays' untouched", () => {
    const before = edits([segment("s1", 100, 106)], [overlay("o1")], WARM);
    const clicked = relook({ edits: before, pick: null }, { look: "blockbuster" })!;
    expect(clicked.edits.grade).toEqual({ ...WARM, look: "blockbuster" });
    expect(clicked.edits.segments).toBe(before.segments);
    expect(clicked.edits.overlays).toBe(before.overlays);
  });

  test("with only other items picked does nothing", () => {
    expect(relook({ edits: edits([segment("s1", 100, 106)], []), pick: picked({ kind: "text", id: "t1" }) }, { look: "noir" })).toBeNull();
  });
});

describe("hovering a card", () => {
  test("draws the preview in the Look and changes nothing saved", () => {
    const before = edits([segment("s1", 100, 106)], [], WARM);
    const history: Steps<AdvancedEdits> = { past: [], value: before, future: [] };
    const plan = { segments: [{ id: "s1", grade: NEUTRAL_GRADE }], overlays: [], grade: WARM } as unknown as RenderPlan;
    // As the Advanced Edit draws an audition: the Grades a click would set, for the preview only.
    const auditioned = relook({ edits: before, pick: null }, { look: "noir" })!.edits;
    const shown = draftGrades(plan, auditioned.segments, auditioned.overlays, auditioned.grade);
    expect(gradeFilterId(shown.grade)).not.toBe(gradeFilterId(plan.grade));
    expect(shown.grade?.look).toBe("noir");
    // Nothing saved: the edits and their history are as they were.
    expect(history.value).toBe(before);
    expect(history.past).toHaveLength(0);
    expect(before.grade).toEqual(WARM);
  });
});

describe("the Filters tab", () => {
  test("shows a card per Look by category, each the frame under its Look's filter, the current one pressed", () => {
    const frame = { url: "/strip.jpg", strip: { index: 3, count: 30 } };
    const markup = renderToStaticMarkup(<LookCards looks={LOOKS} frame={frame} current="moody" onPick={() => {}} onAudition={() => {}} />);
    expect(shelvesOf(LOOKS).map((shelf) => shelf.category)).toEqual(["Cinematic", "Black & White"]);
    const headings = [...markup.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map(([, text]) => text);
    expect(headings).toEqual(["Cinematic", "Black &amp; White"]);
    const cards = [...markup.matchAll(/data-look="([^"]*)"[^>]*aria-pressed="(true|false)"/g)].map(([, id, pressed]) => [id, pressed]);
    expect(cards).toEqual([
      ["blockbuster", "false"],
      ["moody", "true"],
      ["noir", "false"],
    ]);
    for (const { id } of LOOKS) {
      const card = markup.slice(markup.indexOf(`data-look="${id}"`));
      const picture = card.slice(card.indexOf("data-picture"), card.indexOf("</div>"));
      expect(picture).toContain("url(/strip.jpg)");
      expect(picture).toContain(gradeFilter(lookGrade(id))!.replace(/"/g, "&quot;"));
      // The filter it names is defined.
      expect(markup).toContain(`id="${gradeFilterId(lookGrade(id))}"`);
    }
    // A Look with a vignette has its layer.
    const moody = markup.slice(markup.indexOf('data-look="moody"'), markup.indexOf('data-look="noir"'));
    expect(moody).toContain("data-vignette");
  });

  test("the frame is the picked item's picture at the playhead, or the Clip's", () => {
    const library = new Map<string, MediaItem>([
      ["pic", { id: "pic", kind: "image", duration: null } as MediaItem],
      ["clip", { id: "clip", kind: "video", duration: 40 } as MediaItem],
    ]);
    const segments = [segment("s1", 100, 106), segment("s2", 5, 15, { media: "clip" })];
    const played = playedFrom(segments);
    const base = { segments, overlays: [overlay("o1"), overlay("o2", { media: "clip", offset: 31 })], played, jobId: "j1", sourceDuration: 600, library };
    // Nothing picked: the Source's Filmstrip, its chunk from 90 s, at 103 s (3 s into the Clip).
    expect(lookFrame({ ...base, pick: null, time: 3 })).toEqual({ url: "/api/jobs/j1/filmstrip/v1/90.jpg", strip: { index: 13, count: 30 } });
    // A picked image Overlay: its still.
    expect(lookFrame({ ...base, pick: picked(over("o1")), time: 3 })).toEqual({ url: "/api/media/pic/thumbnail" });
    // A picked video Overlay: its video's frame (31 s + 1 s in), from its last chunk of 10 frames.
    expect(lookFrame({ ...base, pick: picked(over("o2")), time: 2 })).toEqual({ url: "/api/media/clip/filmstrip/v1/30.jpg", strip: { index: 2, count: 10 } });
    // A picked media Segment away from the playhead: its start.
    expect(lookFrame({ ...base, pick: picked(seg("s2")), time: 1 })).toEqual({ url: "/api/media/clip/filmstrip/v1/0.jpg", strip: { index: 5, count: 30 } });
  });
});

describe("the Color section's Look", () => {
  const noop = () => {};
  test("is picked from the Looks by category, its intensity and Remove shown only with one", () => {
    const without = renderToStaticMarkup(<ColorFields grades={[WARM]} looks={LOOKS} onDial={noop} onReset={noop} onLook={noop} />);
    expect(without).toMatch(/<option value="" selected="">None<\/option><optgroup label="Cinematic">/);
    expect(without).not.toContain("Intensity");
    expect(without).not.toContain("Remove look");
    const looked = renderToStaticMarkup(<ColorFields grades={[{ ...WARM, look: "noir", intensity: 40 }]} looks={LOOKS} onDial={noop} onReset={noop} onLook={noop} />);
    expect(looked).toMatch(/<option value="noir" selected="">NOIR<\/option>/);
    expect(looked).toContain("Intensity");
    expect(looked).toContain("40%");
    expect(looked).toContain("Remove look");
    // Two Grades of different Looks: Mixed.
    const mixed = renderToStaticMarkup(<ColorFields grades={[{ ...WARM, look: "noir" }, WARM]} looks={LOOKS} onDial={noop} onReset={noop} onLook={noop} />);
    expect(mixed).toContain("Mixed");
  });

  test("removing the Look keeps the dials; the intensity mixes the Look over the Grade without it", () => {
    const looked = { ...WARM, look: "noir", intensity: 100 };
    expect(relooked(looked, { look: null })).toEqual({ ...WARM, look: null, intensity: 100 });
    expect(foldGrade(relooked(looked, { intensity: 0 }))).toEqual(foldGrade(WARM));
    // At 100, the Look's dials laid over the Grade's.
    expect(foldGrade(looked)).toEqual(foldGrade(adjusted(WARM, { saturation: -100, contrast: 50 })));
    const half = foldGrade(relooked(looked, { intensity: 50 }))!;
    const [none, full] = [foldGrade(WARM)!, foldGrade(looked)!];
    expect(half.matrix![0][1]).toBeCloseTo((none.matrix![0][1] + full.matrix![0][1]) / 2, 9);
    // A Look not known yet is drawn as none, but has its own filter id.
    expect(foldGrade({ ...WARM, look: "unknown" })).toEqual(foldGrade(WARM));
    expect(gradeFilterId({ ...WARM, look: "noir", intensity: 40 })).not.toBe(gradeFilterId({ ...WARM, look: "noir", intensity: 50 }));
  });
});
