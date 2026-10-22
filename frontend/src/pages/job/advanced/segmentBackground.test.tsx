// .scratch/background-removal/issues/04-segment-background-colour-and-image.md: a cut-out Segment of the
// Source shows its own Background (the picture blurred, a colour, or a Media Library image covering the
// frame), set from the Remove background section on a mixed Pick, each change one step of undo (a
// colour's drag one group); a Framing's Background takes the image kind too; and the preview draws the
// colour or the image under the cut (ADR 0015). No jsdom: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { Background, ClipSegment, MediaItem, PersonModelInfo, RenderPlan, ScenePlan } from "../../../api";
import { backdropView } from "../editor/MatteMask";
import { filledStyle, slotView } from "../editor/picture";
import { sameBackground, segmentBackground, setSegmentBackground } from "./actions";
import type { AdvancedEdits } from "./edits";
import { picked } from "./pick";
import { backgroundRemovalChanges, RemoveBackgroundFields, type RemovalControls } from "./RemoveBackgroundFields";
import { BackgroundFields, backgroundOfKind, LibraryImages } from "./TransformFields";

// The preview's modules measure text on a canvas when loaded, which there is no document for here.
vi.hoisted(() => {
  globalThis.document ??= { createElement: () => ({ getContext: () => null }) } as unknown as Document;
});

const CUT = { subject: "person" as const, feather: 4 };
const TEAL: Background = { kind: "colour", colour: "#008080" };
const image = (id: string, name: string): MediaItem => ({
  id,
  kind: "image",
  name,
  size_bytes: 1,
  duration: null,
  width: 400,
  height: 200,
  has_audio: false,
  created: "2026-10-22T00:00:00Z",
});
const IMAGES = [image("i1", "Brand wall"), image("i2", "Studio")];

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
    overlays: [],
    transitions: [],
  };
}

const state = edits([
  { id: "a", start: 1, end: 3, background_removal: CUT },
  { id: "b", start: 4, end: 6, background_removal: CUT, background: TEAL },
  { id: "c", start: 7, end: 8 },
  { id: "m", start: 0, end: 2, media: "video" },
]);
const all = picked({ kind: "segment", id: "a" }, { kind: "segment", id: "b" }, { kind: "segment", id: "c" }, { kind: "segment", id: "m" }, { kind: "overlay", id: "o" });
const backgrounds = (after: AdvancedEdits) => after.segments.map((segment) => segment.background);

describe("a cut-out Segment's Background", () => {
  test("reads as the picture blurred when it has none", () => {
    expect(segmentBackground(state.segments[0])).toEqual({ kind: "blur", colour: "#000000" });
    expect(segmentBackground(state.segments[1])).toEqual(TEAL);
    expect(sameBackground({ ...TEAL, image: null }, TEAL)).toBe(true);
  });

  test("is set on every picked cut-out Segment of the Source as one change, not on one that isn't cut out nor a video's", () => {
    const shown: Background = { kind: "image", colour: "#000000", image: "i1" };
    const after = setSegmentBackground({ edits: state, pick: all }, shown)!;
    expect(backgrounds(after.edits)).toEqual([shown, shown, undefined, undefined]);
    // Nothing changes twice.
    expect(setSegmentBackground({ edits: after.edits, pick: all }, shown)).toBeNull();
    expect(setSegmentBackground({ edits: state, pick: picked({ kind: "segment", id: "c" }) }, shown)).toBeNull();
  });

  test("the section's picker makes a kind or an image one step each, and a colour's drag one group", () => {
    const changes: [AdvancedEdits, string | undefined][] = [];
    const controls = backgroundRemovalChanges({ edits: state, pick: all }, (after, group) => changes.push([after, group]))!;
    expect(controls.backgrounds).toEqual([{ kind: "blur", colour: "#000000" }, TEAL]);
    controls.onBackground!({ kind: "colour", colour: "#112233" }, "kind");
    controls.onBackground!({ kind: "colour", colour: "#445566" }, "colour");
    controls.onBackground!({ kind: "image", colour: "#000000", image: "i2" }, "image");
    expect(changes.map(([, group]) => group)).toEqual([undefined, "segment-background:colour:a,b", undefined]);
    expect(backgrounds(changes[1][0]).slice(0, 2)).toEqual([
      { kind: "colour", colour: "#445566" },
      { kind: "colour", colour: "#445566" },
    ]);
  });
});

describe("the Background picker", () => {
  test("takes the first image when switched to Image with none, keeps the colour, and drops the image with its kind", () => {
    expect(backgroundOfKind(TEAL, "image", IMAGES)).toEqual({ kind: "image", colour: "#008080", image: "i1" });
    expect(backgroundOfKind(TEAL, "image", [])).toBeNull();
    expect(backgroundOfKind({ kind: "image", colour: "#008080", image: "i2" }, "blur", IMAGES)).toEqual({ kind: "blur", colour: "#008080" });
  });

  const model: PersonModelInfo = { state: "ready", done: 1, total: 14_975_696, message: null, name: "Person model", licence: "GPL-3.0" };
  const controls = (given: Partial<RemovalControls> = {}): RemovalControls => ({
    removals: [CUT, CUT],
    cut: ["a", "b"],
    shown: "",
    onSwitch: () => {},
    onFeather: () => {},
    backgrounds: [{ kind: "image", colour: "#000000", image: "i2" }],
    onBackground: () => {},
    ...given,
  });
  const section = (removal: RemovalControls, images: MediaItem[] = IMAGES) =>
    renderToStaticMarkup(
      <LibraryImages.Provider value={images}>
        <RemoveBackgroundFields model={model} message={null} onAction={() => {}} removal={removal} />
      </LibraryImages.Provider>,
    );

  test("shows what is behind the person, the image picked among the Library's, and Mixed when they differ", () => {
    const html = section(controls());
    expect(html).toContain("Behind the person");
    expect(html).toMatch(/checked="" value="image"/);
    expect(html).toMatch(/aria-label="Studio"[^>]*checked="" value="i2"/);
    expect(html).toContain("/api/media/i1/thumbnail");
    expect(html).not.toContain("Mixed");
    expect(section(controls({ backgrounds: [TEAL, { kind: "blur", colour: "#000000" }] }))).toContain("Mixed");
    // Off: no picker.
    expect(section(controls({ removals: [null], cut: [], backgrounds: [] }))).not.toContain("Behind the person");
  });

  test("offers Image to a Framing once the Library has an image", () => {
    const framing = (images: MediaItem[]) =>
      renderToStaticMarkup(
        <LibraryImages.Provider value={images}>
          <BackgroundFields background={TEAL} onChange={() => {}} />
        </LibraryImages.Provider>,
      );
    expect(framing(IMAGES)).toContain('value="image"');
    expect(framing([])).not.toContain('value="image"');
    expect(framing([])).toContain("Add an image to the Media Library");
  });
});

describe("the preview", () => {
  const plan = { width: 1080, height: 1920, source_width: 640, source_height: 360 } as RenderPlan;

  test("draws a cut-out Segment's colour or image under the cut, an image covering the frame", () => {
    expect(backdropView(plan, null, TEAL)).toEqual({ panel: null, colour: "#008080" });
    expect(backdropView(plan, null, { kind: "image", colour: "#008080", image: "i1" })).toEqual({ panel: null, colour: "#000000", image: "i1" });
    expect(backdropView(plan, null, null).panel?.blur).toBe(true);
    expect(filledStyle("#000000", "i1")).toEqual({
      backgroundColor: "#000000",
      backgroundImage: 'url("/api/media/i1")',
      backgroundSize: "cover",
      backgroundPosition: "center",
    });
  });

  test("draws a Manual Scene's image Background in its first slot, and under its cut", () => {
    const scene = { start: 0, end: 2, layout: "manual", panels: [], picture: null, colour: null, image: "i2", framing: null } as ScenePlan;
    const slot = slotView(scene, 0);
    expect(slot).toMatchObject({ panel: null, colour: null, image: "i2" });
    expect(backdropView(plan, slot, null)).toEqual({ panel: null, colour: "#000000", image: "i2" });
  });
});
