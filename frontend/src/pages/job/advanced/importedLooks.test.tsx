// .scratch/color-adjust/issues/06-imported-looks.md: Imported Looks (ADR 0013). The preview draws an
// Imported Look's table as the tables and matrix fitted to it, mixed over the picture by the intensity;
// the Filters tab lists them on the Imported shelf with Import Look and a delete action. (The fold
// itself is pinned by the shared fixture in editor/grading.test.tsx.)
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Look, LookFit } from "../../../api";
import { GradeFilter } from "../editor/GradeFilters";
import { foldGrade, gradeFilter, knowLooks, NEUTRAL_ADJUST, NEUTRAL_GRADE } from "../editor/grading";
import { LookCards } from "./LookPanel";

const ramp = (gamma: number) => Array.from({ length: 256 }, (_, i) => (i / 255) ** gamma);
const SWAP: LookFit = {
  tables: [ramp(1), ramp(0.8), ramp(1)],
  matrix: [
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
  ],
};
const LOOKS: Look[] = [
  { id: "noir", name: "Noir", category: "Black & White", order: 500, adjust: { ...NEUTRAL_ADJUST, saturation: -100 } },
  { id: "c0ffee", name: "Swap", category: "Imported", order: 10_000, adjust: NEUTRAL_ADJUST, has_table: true, fit: SWAP },
];
knowLooks(LOOKS);

// The filter's elements in `markup`, in order, each with its attributes.
const elementsOf = (markup: string) =>
  [...markup.matchAll(/<(\w+)([^>]*)>/g)].map(([, tag, attributes]) => ({
    tag,
    attributes: Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value])),
  }));

describe("an Imported Look in the preview", () => {
  test("folds to its fit, from the catalogue, at the Grade's intensity", () => {
    const folded = foldGrade({ ...NEUTRAL_GRADE, look: "c0ffee", intensity: 40 });
    expect(folded?.tables).toBeNull();
    expect(folded?.lut).toEqual({ look: "c0ffee", intensity: 40, fit: SWAP });
    // At 0 it is no Look: nothing to draw.
    expect(foldGrade({ ...NEUTRAL_GRADE, look: "c0ffee", intensity: 0 })).toBeNull();
    expect(gradeFilter({ ...NEUTRAL_GRADE, look: "c0ffee" })).toMatch(/^url\(#/);
  });

  test("is drawn after the dials' tables and matrix as its fit, mixed over them by the intensity", () => {
    const grade = { adjust: { ...NEUTRAL_ADJUST, exposure: 0.5, saturation: 20, sharpen: 30 }, look: "c0ffee", intensity: 40 };
    const tags = elementsOf(renderToStaticMarkup(<svg><GradeFilter id="g" grade={grade} /></svg>));
    expect(tags.map(({ tag }) => tag)).toEqual([
      "svg", "filter",
      "feComponentTransfer", "feFuncR", "feFuncG", "feFuncB", "feColorMatrix",
      "feComponentTransfer", "feFuncR", "feFuncG", "feFuncB", "feColorMatrix", "feComposite",
      "feConvolveMatrix",
    ]);
    const [graded, fitTables, fitMatrix, mix] = [tags[6], tags[7], tags[11], tags[12]].map(({ attributes }) => attributes);
    expect(graded.result).toBe("graded");
    expect(fitTables.in).toBe("graded");
    expect(tags[9].attributes.tableValues.split(" ").map(Number)[128]).toBeCloseTo((128 / 255) ** 0.8, 5); // its green table
    expect(fitMatrix.values.split(" ").map(Number).slice(0, 5)).toEqual([0, 0, 1, 0, 0]);
    expect([mix.in, mix.in2, mix.operator, Number(mix.k2), Number(mix.k3)]).toEqual(["looked", "graded", "arithmetic", 0.4, 0.6]);
  });

  test("alone at full intensity, it reads the picture itself and needs no mix", () => {
    const tags = elementsOf(renderToStaticMarkup(<svg><GradeFilter id="g" grade={{ ...NEUTRAL_GRADE, look: "c0ffee" }} /></svg>));
    expect(tags.map(({ tag }) => tag)).toEqual(["svg", "filter", "feComponentTransfer", "feFuncR", "feFuncG", "feFuncB", "feColorMatrix"]);
    expect(tags[2].attributes.in).toBe("SourceGraphic");
  });
});

describe("the Filters tab's Imported Looks", () => {
  test("are on the Imported shelf with a delete action, beside Import Look; built-in cards have none", () => {
    const markup = renderToStaticMarkup(<LookCards frame={null} current={null} onPick={() => {}} onAudition={() => {}} looks={LOOKS} />);
    expect(markup).toContain("Import Look (.cube)");
    expect(markup).toContain('accept=".cube"');
    expect(markup).toMatch(/<h3[^>]*>Imported<\/h3>/);
    expect(markup).toContain('aria-label="Delete Swap"');
    expect(markup).not.toContain('aria-label="Delete Noir"');
  });
});
