// .scratch/text-advanced/issues/07: the Face picker lists each family once, can be searched by its
// name, and offers a family's own weights and italics, each a Face of its own.
import { describe, expect, test } from "vitest";
import type { FontInfo } from "../../../api";
import { faceAt, families, familyOf, italicOffered, searchFamilies, weightName, weightsOf } from "./faces";

const face = (id: string, family: string, weight = 400, italic = false, bundled = true): FontInfo => ({
  id,
  label: id,
  family: id,
  typographic_family: family,
  weight,
  italic,
  bundled,
  copyright: "",
  licence: "",
  licence_url: "",
  restricted: false,
  url: `/api/fonts/${id}?v=1`,
  units: 1000,
  em: 1000,
  ascent: 800,
  cap_height: 700,
  descent: 200,
});

const FONTS = [
  face("passion-one-black", "Passion One", 900),
  face("anton", "Anton"),
  face("passion-one-regular", "Passion One", 400),
  face("kanit-black-italic", "Kanit", 900, true),
  face("kanit-regular", "Kanit", 400),
  face("passion-one-bold", "Passion One", 700),
  face("kanit-black", "Kanit", 900),
  face("brand-bold", "Brand Sans", 700, false, false),
  face("brand-regular", "Brand Sans", 400, false, false),
];

const names = (list: { name: string }[]) => list.map((family) => family.name);

describe("the Face picker's families", () => {
  test("each family is listed once: imported ones first, then the bundled, each by name", () => {
    expect(names(families(FONTS))).toEqual(["Brand Sans", "Anton", "Kanit", "Passion One"]);
    expect(families(FONTS).map((family) => family.imported)).toEqual([true, false, false, false]);
  });

  test("an imported family named as a bundled one is listed apart from it", () => {
    const listed = families([...FONTS, face("my-anton", "Anton", 400, false, false)]);
    expect(names(listed)).toEqual(["Anton", "Brand Sans", "Anton", "Kanit", "Passion One"]);
    expect(familyOf(listed, "my-anton")?.imported).toBe(true);
    expect(familyOf(listed, "anton")?.imported).toBe(false);
  });

  test("typing part of a family's name, in any case, filters the list", () => {
    const listed = families(FONTS);
    expect(names(searchFamilies(listed, "SSIO"))).toEqual(["Passion One"]);
    expect(names(searchFamilies(listed, " an"))).toEqual(["Brand Sans", "Anton", "Kanit"]);
    expect(names(searchFamilies(listed, ""))).toEqual(names(listed));
    expect(searchFamilies(listed, "nothing")).toEqual([]);
  });
});

describe("weight and italic", () => {
  const passion = familyOf(families(FONTS), "passion-one-regular")!;
  const kanit = familyOf(families(FONTS), "kanit-regular")!;

  test("a family with Regular, Bold and Black offers exactly those weights", () => {
    expect(weightsOf(passion)).toEqual([400, 700, 900]);
    expect(weightsOf(passion).map(weightName)).toEqual(["Regular", "Bold", "Black"]);
    expect(weightsOf(kanit)).toEqual([400, 900]);
  });

  test("picking a weight sets that weight's Face, italic where the family has it", () => {
    expect(faceAt(passion, 700, false).id).toBe("passion-one-bold");
    expect(faceAt(kanit, 900, true).id).toBe("kanit-black-italic");
    // No Regular Italic: the Regular.
    expect(faceAt(kanit, 400, true).id).toBe("kanit-regular");
  });

  test("another family keeps the nearest weight, the heavier of two as near", () => {
    expect(faceAt(passion, 800, false).id).toBe("passion-one-black");
    expect(faceAt(kanit, 700, false).id).toBe("kanit-black");
    expect(faceAt(passion, 300, false).id).toBe("passion-one-regular");
  });

  test("italic is offered only where the Face's weight has the other slant", () => {
    expect(italicOffered(kanit, faceAt(kanit, 900, false))).toBe(true);
    expect(italicOffered(kanit, faceAt(kanit, 900, true))).toBe(true);
    expect(italicOffered(kanit, faceAt(kanit, 400, false))).toBe(false);
    expect(italicOffered(passion, faceAt(passion, 700, false))).toBe(false);
  });

  test("a weight without a usual name says its number", () => {
    expect(weightName(450)).toBe("450");
    expect([100, 200, 300, 500, 600, 800].map(weightName)).toEqual(["Thin", "ExtraLight", "Light", "Medium", "SemiBold", "ExtraBold"]);
  });
});
