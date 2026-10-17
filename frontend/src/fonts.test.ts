// .scratch/text-advanced/issues/06: the Faces the preview sets text in, listed again when fonts are
// imported or deleted, here or elsewhere.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, type FontImported, type FontInfo } from "./api";
import { fontFamily, importFont, reloadFonts } from "./fonts";
import { importedText } from "./pages/job/advanced/ImportFont";

const face = (id: string, url = `/api/fonts/${id}?v=1`): FontInfo => ({
  id,
  label: id,
  family: id,
  typographic_family: id,
  weight: 400,
  italic: false,
  bundled: false,
  copyright: "",
  licence: "",
  licence_url: "",
  restricted: false,
  url,
  units: 1000,
  em: 1000,
  ascent: 800,
  cap_height: 700,
  descent: 200,
});

// The document's fonts, as the FontFaces registered with it: their family and source.
let registered: { family: string; source: string }[] = [];

beforeEach(() => {
  registered = [];
  class FakeFontFace {
    constructor(
      readonly family: string,
      readonly source: string,
    ) {}
    load() {
      return Promise.resolve(this);
    }
  }
  vi.stubGlobal("FontFace", FakeFontFace);
  vi.stubGlobal("document", {
    fonts: {
      add: (face: FakeFontFace) => registered.push(face),
      delete: (face: FakeFontFace) => (registered = registered.filter((other) => other !== face)),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Faces", () => {
  test("an import lists them again, a re-imported Face is loaded from its new file and a deleted one is dropped", async () => {
    vi.spyOn(api, "listFonts").mockResolvedValueOnce([face("anton"), face("brand")]);
    await reloadFonts();
    expect(registered.map((font) => font.family)).toEqual([fontFamily("anton"), fontFamily("brand")]);

    const imported: FontImported = { faces: [face("brand", "/api/fonts/brand?v=2")], existing: [], warnings: [] };
    vi.spyOn(api, "importFont").mockResolvedValue(imported);
    vi.spyOn(api, "listFonts").mockResolvedValueOnce([face("anton"), face("brand", "/api/fonts/brand?v=2")]);
    expect(await importFont(new File([], "brand.ttf"))).toBe(imported);
    expect(registered).toEqual([
      { family: fontFamily("anton"), source: "url(/api/fonts/anton?v=1)" },
      { family: fontFamily("brand"), source: "url(/api/fonts/brand?v=2)" },
    ]);

    vi.spyOn(api, "listFonts").mockResolvedValueOnce([face("anton")]);
    expect((await reloadFonts()).map((font) => font.id)).toEqual(["anton"]);
    expect(registered.map((font) => font.family)).toEqual([fontFamily("anton")]);
  });

  test("an import says what it added, or that it was there already", () => {
    expect(importedText({ faces: [{ ...face("a"), label: "Brand Regular" }, { ...face("b"), label: "Brand Bold" }], existing: [], warnings: [] })).toBe(
      "Added Brand Regular, Brand Bold. Pick them as the font of any text.",
    );
    expect(importedText({ faces: [], existing: [{ ...face("a"), label: "Brand Regular" }], warnings: [] })).toBe("Already imported: Brand Regular.");
  });
});
