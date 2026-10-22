// .scratch/text-advanced/issues/08: the Text Presets on the Text tab's shelves, the one Add text uses,
// and a look saved from a Text Layer landing under Mine.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, type TextPreset } from "./api";
import { PORTRAIT } from "./pages/job/editor/canvas";
import { IDENTITY } from "./pages/job/editor/picture";
import { fromPreset } from "./pages/job/advanced/TextPresets";
import { newTextLayer } from "./pages/job/advanced/TextLayers";
import { textStyle } from "./pages/job/advanced/textStyle";
import { forNewTitles, MINE, reloadTextPresets, saveTextPreset, shelvesOf } from "./textPresets";

const preset = (id: string, changes: Partial<TextPreset> = {}): TextPreset => ({
  id,
  name: id,
  style: textStyle(),
  sample: id,
  category: MINE,
  order: 0,
  builtin: false,
  default: false,
  ...changes,
});

const BUILTIN = [
  preset("text", { name: "Text", sample: "Text", category: "Basic", order: 10, builtin: true, style: textStyle({ stroke_width: 4 }) }),
  preset("title", { name: "Title", sample: "Title", category: "Titles", order: 100, builtin: true, style: textStyle({ font: "anton", size: 130 }) }),
  preset("news", { name: "News", sample: "BREAKING", category: "Labels", order: 150, builtin: true }),
  preset("label", { name: "Label", sample: "Label", category: "Labels", order: 200, builtin: true }),
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Text tab's shelves", () => {
  test("the owner's Presets come first under Mine, then the built-in ones by category in their order", () => {
    const mine = [preset("b1"), preset("a2")];
    const shelves = shelvesOf([...BUILTIN, ...mine]);

    expect(shelves.map(({ category, presets }) => [category, presets.map((p) => p.id)])).toEqual([
      [MINE, ["b1", "a2"]],
      ["Basic", ["text"]],
      ["Titles", ["title"]],
      ["Labels", ["news", "label"]],
    ]);
    expect(shelvesOf(BUILTIN)[0].category).toBe("Basic");
  });

  test("Add text uses the Preset marked for new titles, built-in Text until one is", () => {
    const mine = preset("brand", { name: "Brand", sample: "Brand", style: textStyle({ colour: "#FF0000", size: 100 }) });

    expect(forNewTitles([...BUILTIN, mine])?.id).toBe("text");
    const chosen = forNewTitles([...BUILTIN, { ...mine, default: true }]);
    expect(chosen?.id).toBe("brand");
    // The new Text Layer copies its look and sample, at the frame's centre.
    const layer = newTextLayer(fromPreset(chosen!, PORTRAIT), 2, 10);
    expect(layer).toMatchObject({ text: "Brand", style: mine.style, transform: IDENTITY, start: 2, secs: 3, animation_in: "none" });
  });
});

describe("saving a look as a Text Preset", () => {
  test("lists the Presets again, with it under Mine", async () => {
    const style = textStyle({ font: "anton", colour: "#00FF00" });
    const saved = preset("f00d", { name: "Green", sample: "Green", style });
    let listed = [...BUILTIN];
    vi.spyOn(api, "listTextPresets").mockImplementation(async () => listed);
    const create = vi.spyOn(api, "createTextPreset").mockImplementation(async () => {
      listed = [...listed, saved];
      return saved;
    });
    await reloadTextPresets();

    expect(await saveTextPreset("Green", style)).toEqual(saved);
    expect(create).toHaveBeenCalledWith("Green", style);
    const [first] = shelvesOf(await reloadTextPresets());
    expect([first.category, first.presets]).toEqual([MINE, [saved]]);
  });
});
