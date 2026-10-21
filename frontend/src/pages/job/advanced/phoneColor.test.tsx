// .scratch/color-adjust/issues/09-phone-filters-and-adjust.md: Filters and Adjust on a phone (ADR 0013).
// The toolbar's Filters and Adjust for the Pick's Grades or the Candidate's; the Filters sheet's card
// strip (a tap one step of undo), intensity and Add as layer; the Adjust sheet's dials, which change
// what the desktop Inspector's Color section changes, each with a reset; every control a finger's size.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AdjustmentLayer, ClipSegment, Grade, Look, Overlay } from "../../../api";
import { Button } from "../../../components/Button";
import { Slider } from "../../../components/Slider";
import { adjusted, knowLooks, NEUTRAL_ADJUST, NEUTRAL_GRADE } from "../editor/grading";
import { Playback, playedFrom } from "../editor/playback";
import { addAdjustmentLayer, CLIP_GRADE_ID, freezer, gradesOf, regrade, relook, splitter, type PickContext } from "./actions";
import { Toolbar } from "./Chrome";
import { AdjustDials, AdjustPanel, colorChanges } from "./ColorFields";
import type { AdvancedEdits } from "./edits";
import { FiltersPanel, LookStrip } from "./LookPanel";
import { picked, type Pick } from "./pick";
import { stepped, undone, type Steps } from "./useEditHistory";

const look = (id: string, category: string, order: number): Look => ({ id, name: id.toUpperCase(), category, order, adjust: { ...NEUTRAL_ADJUST, contrast: 20 } });
const LOOKS = [look("noir", "Black & White", 500), look("blockbuster", "Cinematic", 100), look("moody", "Cinematic", 110)];
knowLooks(LOOKS);

const WARM: Grade = adjusted(NEUTRAL_GRADE, { temperature: 8500 });
const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const overlay = (id: string): Overlay => ({ id, media: "pic", start: 1, secs: 2, offset: 0 }) as Overlay;
const layer = (id: string): AdjustmentLayer => ({ id, start: 0, secs: 2, grade: NEUTRAL_GRADE, strength: 100, fade_in: 0, fade_out: 0 });
const seg = (id: string) => ({ kind: "segment", id }) as const;
const over = (id: string) => ({ kind: "overlay", id }) as const;

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
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
    segments: [segment("s1", 100, 106, { grade: WARM }), segment("s2", 200, 206)],
    overlays: [overlay("o1")],
    transitions: [],
    grade: NEUTRAL_GRADE,
    ...changes,
  } as AdvancedEdits;
}

function scene(state: AdvancedEdits, pick: Pick = null, locked: PickContext["locked"] = []): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, magnetic: true, locked };
}

// Every element in `node`'s tree (not into components), depth first.
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const { children } = node.props as { children?: ReactNode };
  return [node, ...elements(children)];
}
const find = <P,>(node: ReactNode, type: unknown) => elements(node).filter((element) => element.type === type) as ReactElement<P>[];

// The Advanced Edit's history as a sheet changes it: each `set` with its group.
function workspace(start: AdvancedEdits) {
  let history: Steps<AdvancedEdits> = { past: [], value: start, future: [] };
  const groups: (string | undefined)[] = [];
  return {
    now: () => history.value,
    history: () => history,
    groups,
    onEdits: (next: AdvancedEdits, group?: string) => {
      groups.push(group);
      history = stepped(history, next, false);
    },
  };
}

describe("Filters and Adjust in the phone's toolbar", () => {
  const state = edits();
  const props = (pick: Pick, colorable: boolean): Parameters<typeof Toolbar>[0] => ({
    pick,
    actions: null,
    splitter: splitter(scene(state, pick), () => 0, () => {}),
    freezer: freezer(scene(state, pick), () => 0, () => {}),
    playback: new Playback(),
    picking: false,
    paste: null,
    mute: null,
    onAsset: () => {},
    onInspect: () => {},
    onTransform: () => {},
    onSpeed: null,
    onFilters: colorable ? () => {} : null,
    onAdjust: colorable ? () => {} : null,
    onTracks: () => {},
    onPlayback: () => {},
    onPicking: () => {},
    onDeselect: () => {},
  });
  const toolbar = (pick: Pick, colorable: boolean) => renderToStaticMarkup(<Toolbar {...props(pick, colorable)} />);
  const tool = (label: string) => new RegExp(`<button type="button" class="[^"]*min-h-14 min-w-16[^"]*"><svg[^>]*>.*?</svg>${label}</button>`);

  test("are tool buttons, a finger's size, for a Pick with Grades", () => {
    const markup = toolbar(picked(seg("s1"), over("o1")), true);
    expect(markup).toMatch(tool("Filters"));
    expect(markup).toMatch(tool("Adjust"));
  });

  test("with nothing picked are there too, Filters as the asset tab", () => {
    // Read as elements: with nothing picked, Split and Freeze frame follow the playhead, which a page
    // without a browser can't subscribe to.
    const bar = Toolbar({ ...props(null, true) });
    const labels = elements(bar).flatMap((element) => ((element.props as { label?: unknown }).label === undefined ? [] : [(element.props as { label: string }).label]));
    expect(labels.filter((label) => label === "Filters")).toHaveLength(1);
    expect(labels).toContain("Adjust");
    expect(labels.indexOf("Adjust")).toBe(labels.indexOf("Filters") + 1);
  });

  test("are not there for a Pick without Grades", () => {
    expect(gradesOf({ edits: state, pick: picked({ kind: "text", id: "t" }) })).toEqual([]);
    const markup = toolbar(picked({ kind: "text", id: "t" }), false);
    expect(markup).not.toContain("Filters");
    expect(markup).not.toContain("Adjust");
  });

  test("act on the picked Segments, Overlays and Adjustment Layers, or the Candidate", () => {
    const withLayer = edits({ adjustment_layers: [layer("a1")] });
    expect(gradesOf({ edits: withLayer, pick: picked(over("o1"), seg("s1"), { kind: "adjustment", id: "a1" }) }).map((item) => item.id)).toEqual(["s1", "o1", "a1"]);
    expect(gradesOf({ edits: withLayer, pick: null })).toEqual([{ id: CLIP_GRADE_ID, grade: NEUTRAL_GRADE }]);
  });
});

describe("the Filters sheet", () => {
  function sheet(state: AdvancedEdits, pick: Pick, chosen: string | null = null, onAddLayer: (look: string) => void = () => {}) {
    const space = workspace(state);
    const chose: string[] = [];
    const panel = () =>
      FiltersPanel({ edits: space.now(), pick, frame: null, chosen, looks: LOOKS, onChoose: (each) => chose.push(each), onEdits: space.onEdits, onAddLayer });
    return { space, chose, panel };
  }

  test("a tapped card gives its Look to the Pick, as one step of undo", () => {
    const before = edits();
    const pick = picked(seg("s1"), over("o1"));
    const { space, chose, panel } = sheet(before, pick);
    const [strip] = find<Parameters<typeof LookStrip>[0]>(panel(), LookStrip);
    strip.props.onPick("noir");

    expect(chose).toEqual(["noir"]);
    expect(space.history().past).toHaveLength(1);
    expect(space.now()).toEqual(relook({ edits: before, pick }, { look: "noir" })!.edits);
    expect(space.now().segments[0].grade).toEqual({ ...WARM, look: "noir" });
    expect(space.now().overlays[0].grade).toEqual({ ...NEUTRAL_GRADE, look: "noir" });
    expect(undone(space.history())!.value).toBe(before);
    // The strip now marks it as the Look a tap goes to.
    expect(find<Parameters<typeof LookStrip>[0]>(panel(), LookStrip)[0].props.current).toBe("noir");
  });

  test("with nothing picked, a tapped card gives its Look to the Candidate", () => {
    const before = edits();
    const { space, panel } = sheet(before, null);
    find<Parameters<typeof LookStrip>[0]>(panel(), LookStrip)[0].props.onPick("moody");
    expect(space.now().grade).toEqual({ ...NEUTRAL_GRADE, look: "moody" });
    expect(space.now().segments).toBe(before.segments);
    expect(space.history().past).toHaveLength(1);
  });

  test("its intensity sets the Look's, a drag joined into one step", () => {
    const { space, panel } = sheet(edits({ grade: { ...NEUTRAL_GRADE, look: "noir" } }), null);
    const [intensity] = find<Parameters<typeof Slider>[0]>(panel(), Slider);
    expect(intensity.props.disabled).toBe(false);
    intensity.props.onChange(40);
    expect(space.now().grade).toEqual({ ...NEUTRAL_GRADE, look: "noir", intensity: 40 });
    expect(space.groups).toEqual(["grade:clip:grade:intensity"]);
  });

  test("its intensity is off without a Look", () => {
    const { panel } = sheet(edits(), null);
    expect(find<Parameters<typeof Slider>[0]>(panel(), Slider)[0].props.disabled).toBe(true);
  });

  const addButton = (node: ReactNode) => find<Parameters<typeof Button>[0]>(node, Button).find((button) => [button.props.children].flat().includes("Add as layer"))!;

  test("Add as layer makes an Adjustment Layer with the chosen Look at the playhead, picked", () => {
    const state = edits();
    const added: string[] = [];
    const { panel } = sheet(state, picked(seg("s2")), "moody", (each) => added.push(each));
    addButton(panel()).props.onClick!({} as never);
    expect(added).toEqual(["moody"]);

    // At the playhead, 3 s long; near the Clip's end, to its end.
    const outcome = addAdjustmentLayer(scene(state, picked(seg("s2"))), "moody", 4)!;
    expect(outcome.edits.adjustment_layers).toEqual([{ id: "n1", start: 4, secs: 3, grade: { ...NEUTRAL_GRADE, look: "moody" }, strength: 100, fade_in: 0, fade_out: 0 }]);
    expect(outcome.pick).toEqual(picked({ kind: "adjustment", id: "n1" }));
    expect(addAdjustmentLayer(scene(state), "moody", 10)!.edits.adjustment_layers![0]).toMatchObject({ start: 10, secs: 2 });
    // Refused on a locked Adjust Track.
    expect(addAdjustmentLayer(scene(state, null, ["adjust"]), "moody", 4)).toBeNull();
  });

  test("Add as layer takes the Pick's Look without a card tapped, and is off with neither", () => {
    const added: string[] = [];
    const { panel } = sheet(edits({ grade: { ...NEUTRAL_GRADE, look: "noir" } }), null, null, (each) => added.push(each));
    addButton(panel()).props.onClick!({} as never);
    expect(added).toEqual(["noir"]);
    expect(addButton(sheet(edits(), null).panel()).props.disabled).toBe(true);
  });

  test("its strip scrolls sideways within itself, by category, every card a finger's size", () => {
    const markup = renderToStaticMarkup(<LookStrip frame={null} current="moody" looks={LOOKS} onPick={() => {}} />);
    expect(markup).toMatch(/role="group" aria-label="Looks" class="[^"]*min-w-0[^"]*overflow-x-auto/);
    expect([...markup.matchAll(/<section aria-label="([^"]+)"/g)].map((match) => match[1])).toEqual(["Cinematic", "Black &amp; White"]);
    const cards = [...markup.matchAll(/<button[^>]*data-look="([^"]+)"[^>]*>/g)];
    expect(cards.map((match) => match[1])).toEqual(["blockbuster", "moody", "noir"]);
    for (const [tag] of cards) expect(tag).toContain("min-h-11");
    expect(markup.match(/class="flex w-28 shrink-0 snap-start"/g)).toHaveLength(3);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>/);
  });

  test("has its controls 44 px tall in a sheet", () => {
    const markup = renderToStaticMarkup(<div data-sheet="">{FiltersPanel({ edits: edits(), pick: null, frame: null, chosen: "noir", looks: LOOKS, onChoose: () => {}, onEdits: () => {}, onAddLayer: () => {} })}</div>);
    const controls = [...markup.matchAll(/<(button|input)\b[^>]*>/g)].map((match) => match[0]);
    expect(controls.length).toBeGreaterThan(4);
    for (const tag of controls) expect(tag).toMatch(/min-h-11|in-data-sheet:h-11|size-11/);
  });
});

describe("the Adjust sheet", () => {
  test("its dials edit the same Grade as the desktop Inspector, each one step of undo", () => {
    const before = edits();
    const pick = picked(seg("s1"), over("o1"));
    const space = workspace(before);
    const [dials] = find<Parameters<typeof AdjustDials>[0]>(AdjustPanel({ edits: before, pick, onEdits: space.onEdits }), AdjustDials);
    expect(dials.props.resettable).toBe(true);
    expect(dials.props.adjusts).toEqual([WARM.adjust, NEUTRAL_ADJUST]);
    dials.props.onDial({ exposure: 0.5 }, "grade:exposure");

    // The Inspector's Color section: the same change, in the same group.
    const desktop = workspace(before);
    colorChanges({ edits: before, pick }, desktop.onEdits).onDial({ exposure: 0.5 }, "grade:exposure");
    expect(space.now()).toEqual(desktop.now());
    expect(space.groups).toEqual(desktop.groups);
    expect(space.groups).toEqual(["grade:s1,o1:grade:exposure"]);
    expect(space.now()).toEqual(regrade({ edits: before, pick }, { exposure: 0.5 })!.edits);
    expect(space.history().past).toHaveLength(1);
  });

  test("with nothing picked edits the Candidate's Grade, in the Inspector's group", () => {
    const before = edits();
    const space = workspace(before);
    find<Parameters<typeof AdjustDials>[0]>(AdjustPanel({ edits: before, pick: null, onEdits: space.onEdits }), AdjustDials)[0].props.onDial({ contrast: 30 }, "grade:contrast");
    expect(space.now().grade).toEqual(adjusted(NEUTRAL_GRADE, { contrast: 30 }));
    expect(space.now().segments).toBe(before.segments);
    expect(space.groups).toEqual(["grade:clip:grade:contrast"]);
  });

  test("has every dial in the desktop's groups with a reset, each control 44 px tall", () => {
    const markup = renderToStaticMarkup(<div data-sheet="">{AdjustPanel({ edits: edits(), pick: picked(seg("s1")), onEdits: () => {} })}</div>);
    const resets = [...markup.matchAll(/<button[^>]*aria-label="Reset ([^"]+)"[^>]*>/g)];
    expect(resets.map((match) => match[1])).toEqual([
      "Temperature", "Tint", "Saturation",
      "Exposure", "Brightness", "Contrast", "Highlights", "Shadows", "Whites", "Blacks",
      "Sharpen", "Fade", "Vignette",
    ]);
    // Only Temperature is away from neutral in WARM.
    expect(resets.filter(([tag]) => !tag.includes('disabled=""'))).toHaveLength(1);
    expect(resets[0][0]).not.toContain('disabled=""');
    for (const title of ["Color", "Lightness", "Detail"]) expect(markup).toContain(`>${title}<`);
    for (const [tag] of markup.matchAll(/<(button|input)\b[^>]*>/g)) expect(tag).toMatch(/min-h-11|in-data-sheet:h-11|size-11/);
  });

  test("a dial's reset puts it back at neutral, one step of undo", () => {
    const before = edits();
    const space = workspace(before);
    const [dials] = find<Parameters<typeof AdjustDials>[0]>(AdjustPanel({ edits: before, pick: picked(seg("s1")), onEdits: space.onEdits }), AdjustDials);
    const [temperature] = find<Parameters<typeof Slider>[0]>(AdjustDials(dials.props), Slider);
    expect(temperature.props.label).toBe("Temperature");
    (temperature.props.after as ReactElement<Parameters<typeof Button>[0]>).props.onClick!({} as never);
    expect(space.now().segments[0].grade).toEqual(NEUTRAL_GRADE);
    expect(space.history().past).toHaveLength(1);
  });
});
