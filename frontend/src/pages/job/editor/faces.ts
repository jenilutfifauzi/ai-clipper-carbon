import type { FontInfo } from "../../../api";

/**
 * A family of Faces, as the Face picker lists it: its Faces, lightest first and upright before italic.
 * An imported family is listed apart from a bundled one of the same name.
 */
export interface Family {
  name: string;
  imported: boolean;
  faces: FontInfo[];
}

/** The Faces' families, each once: the imported ones first, then the bundled, each by name. */
export function families(fonts: FontInfo[]): Family[] {
  const byKey = new Map<string, Family>();
  for (const font of fonts) {
    const key = `${font.bundled ? "b" : "i"}:${font.typographic_family}`;
    const family = byKey.get(key) ?? { name: font.typographic_family, imported: !font.bundled, faces: [] };
    family.faces.push(font);
    byKey.set(key, family);
  }
  const listed = [...byKey.values()];
  for (const family of listed) family.faces.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));
  return listed.sort((a, b) => Number(b.imported) - Number(a.imported) || a.name.localeCompare(b.name));
}

/** The families whose name holds `query`, ignoring case and the spaces around it. */
export function searchFamilies(listed: Family[], query: string): Family[] {
  const wanted = query.trim().toLocaleLowerCase();
  return listed.filter((family) => family.name.toLocaleLowerCase().includes(wanted));
}

/** The family the Face `id` is in. */
export function familyOf(listed: Family[], id: string): Family | undefined {
  return listed.find((family) => family.faces.some((font) => font.id === id));
}

/** The weights the family has a Face in, lightest first. */
export function weightsOf(family: Family): number[] {
  return [...new Set(family.faces.map((font) => font.weight))];
}

/**
 * The family's Face nearest `weight` (the heavier of two as near), italic when it has one at that
 * weight. Picking a weight, or another family, keeps what it can of the Face before.
 */
export function faceAt(family: Family, weight: number, italic: boolean): FontInfo {
  const nearest = weightsOf(family).reduce((best, other) => (Math.abs(other - weight) <= Math.abs(best - weight) ? other : best));
  const atWeight = family.faces.filter((font) => font.weight === nearest);
  return atWeight.find((font) => font.italic === italic) ?? atWeight[0];
}

/** Whether the family has `font`'s weight in the other slant too, so that italic can be switched. */
export function italicOffered(family: Family, font: FontInfo): boolean {
  return family.faces.some((other) => other.weight === font.weight && other.italic !== font.italic);
}

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

/** What a weight (OS/2 usWeightClass) is called, or its number. */
export const weightName = (weight: number) => WEIGHT_NAMES[weight] ?? String(weight);
