// The fold of a Grade into tables, a matrix and the sharpen and vignette amounts
// (.scratch/color-adjust/issues/01-segment-grade-adjust-dials.md, 02-sharpen-and-vignette.md, ADR 0013),
// a Look's at an intensity included (05-built-in-looks-and-filters-tab.md),
// on the cases the backend's tests read too (backend/tests/fixtures/grade_folds.json), so that the
// preview's fold and the render's can't drift; and the preview's SVG filter and vignette layer, built from it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import cases from "../../../../../backend/tests/fixtures/grade_folds.json";
import type { Adjust, Grade, LookFit } from "../../../api";
import { ColorFields } from "../advanced/ColorFields";
import { DecksGraded } from "./GradeFilters";
import { GradeFilter, GradeFilters, GradeVignette } from "./GradeFilters";
import { adjusted, foldGrade, gradeFilter, gradeFilterId, gradeOf, NEUTRAL_GRADE, sharpenKernel, TABLE_SIZE } from "./grading";

const close = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThan(cases.tolerance));
};

describe("a Grade's fold", () => {
  for (const { name, grade, tables, matrix, sharpen, vignette, ...rest } of cases.cases) {
    test(`${name}: folds into the tables, matrix and amounts the shared cases say`, () => {
      // JSON types each case's missing dials as undefined, which a Grade leaves out. A case with a Look
      // gives its values inline.
      const look = "look" in rest ? (rest.look as Partial<Adjust>) : undefined;
      // One with an Imported Look names its table's fit, and expects it passed through (or none).
      const fit = "fit" in rest ? (cases.fits[rest.fit as keyof typeof cases.fits] as unknown as LookFit) : undefined;
      const folded = foldGrade(grade as unknown as Partial<Grade>, look, fit);
      if ("lut" in rest) {
        const lut = rest.lut as { look: string; intensity: number } | null;
        if (lut === null) expect(folded?.lut ?? null).toBeNull();
        else {
          expect([folded?.lut?.look, folded?.lut?.intensity]).toEqual([lut.look, lut.intensity]);
          expect(folded?.lut?.fit).toBe(fit);
        }
      }
      if (tables === null) expect(folded?.tables ?? null).toBeNull();
      else {
        expect(folded?.tables?.map((table) => table.length)).toEqual([TABLE_SIZE, TABLE_SIZE, TABLE_SIZE]);
        folded!.tables!.forEach((table, channel) => close(table, tables[channel]));
      }
      if (matrix === null) expect(folded?.matrix ?? null).toBeNull();
      else folded!.matrix!.forEach((row, i) => close(row, matrix[i]));
      close([folded?.sharpen ?? 0, folded?.vignette ?? 0], [sharpen, vignette]);
    });
  }

  test("a neutral Grade, or one saved before Grades, folds to nothing and has no filter", () => {
    for (const grade of [NEUTRAL_GRADE, undefined, null, { adjust: { temperature: 6500, sharpen: 0, vignette: 0 } }]) {
      expect(foldGrade(grade as Partial<Grade>)).toBeNull();
      expect(gradeFilter(grade as Partial<Grade>)).toBeUndefined();
      expect(renderToStaticMarkup(<GradeVignette grade={grade as Grade} />)).toBe("");
    }
    expect(renderToStaticMarkup(<GradeFilters grades={[NEUTRAL_GRADE, undefined]} />)).toBe("");
  });
});

describe("the preview's filter", () => {
  test("is built from the fold's output: its tables, then its matrix, in sRGB", () => {
    const grade = adjusted(NEUTRAL_GRADE, { exposure: 1, temperature: 9000, saturation: 20 });
    const id = gradeFilterId(grade)!;
    expect(gradeFilter(grade)).toBe(`url(#${id})`);
    const folded = foldGrade(grade)!;
    const markup = renderToStaticMarkup(
      <svg>
        <GradeFilter id={id} grade={grade} />
      </svg>,
    );
    // The filter's elements in order, each with its attributes.
    const elements = [...markup.matchAll(/<(\w+)([^>]*)>/g)].map(([, tag, attributes]) => ({
      tag,
      attributes: Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value])),
    }));
    const [, filter, transfer, red, green, blue, mixer] = elements;
    expect(filter.tag).toBe("filter");
    expect(filter.attributes.id).toBe(id);
    expect(filter.attributes["color-interpolation-filters"]).toBe("sRGB");
    expect(transfer.tag).toBe("feComponentTransfer");
    for (const [channel, func] of [red, green, blue].entries()) {
      expect([func.tag, func.attributes.type]).toEqual([["feFuncR", "feFuncG", "feFuncB"][channel], "table"]);
      close(func.attributes.tableValues.split(" ").map(Number), folded.tables![channel]);
    }
    expect(mixer.tag).toBe("feColorMatrix");
    const values = mixer.attributes.values.split(" ").map(Number);
    // Rows R, G, B: the matrix's weights, no alpha weight and no offset; then alpha kept.
    folded.matrix!.forEach((row, i) => close(values.slice(i * 5, i * 5 + 5), [...row, 0, 0]));
    expect(values.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });

  test("is defined once for equal Grades, which share its id", () => {
    const warm = adjusted(undefined, { temperature: 8000 });
    const markup = renderToStaticMarkup(<GradeFilters grades={[warm, gradeOf({ adjust: { ...warm.adjust } }), adjusted(undefined, { tint: 20 })]} />);
    expect(markup.match(/<filter /g)).toHaveLength(2);
    expect(gradeFilterId(warm)).not.toBe(gradeFilterId(adjusted(undefined, { temperature: 8050 })));
  });
});

// The filter's elements in `markup`, in order, each with its attributes.
const elementsOf = (markup: string) =>
  [...markup.matchAll(/<(\w+)([^>]*)>/g)].map(([, tag, attributes]) => ({
    tag,
    attributes: Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value])),
  }));

describe("sharpen and vignette in the preview (color-adjust/02)", () => {
  test("sharpen is an feConvolveMatrix after the tables and matrix, its kernel the picture plus its difference from a 3x3 blur", () => {
    const grade = adjusted(NEUTRAL_GRADE, { contrast: 30, saturation: 10, sharpen: 50 });
    const tags = elementsOf(renderToStaticMarkup(<svg><GradeFilter id="g" grade={grade} /></svg>));
    expect(tags.map(({ tag }) => tag)).toEqual(["svg", "filter", "feComponentTransfer", "feFuncR", "feFuncG", "feFuncB", "feColorMatrix", "feConvolveMatrix"]);
    const convolve = tags.at(-1)!.attributes;
    expect([convolve.order, convolve.divisor, convolve.preserveAlpha, convolve.edgeMode]).toEqual(["3", "1", "true", "duplicate"]);
    const kernel = convolve.kernelMatrix.split(" ").map(Number);
    close(kernel, sharpenKernel(50));
    // It keeps a flat patch (it sums to 1) and lifts the centre against its neighbours.
    expect(Math.abs(kernel.reduce((sum, weight) => sum + weight, 0) - 1)).toBeLessThan(1e-5);
    expect(kernel[4]).toBeGreaterThan(1);
    expect(kernel.filter((_, i) => i !== 4).every((weight) => weight < 0)).toBe(true);
    // Sharpen alone needs the filter; at 0 there is no convolution.
    expect(gradeFilter(adjusted(undefined, { sharpen: 20 }))).toMatch(/^url\(#/);
    expect(renderToStaticMarkup(<svg><GradeFilter id="g" grade={adjusted(undefined, { contrast: 30 })} /></svg>)).not.toContain("feConvolveMatrix");
  });

  test("vignette is a radial gradient layer, darker towards the corners, over the filtered picture", () => {
    const grade = adjusted(NEUTRAL_GRADE, { exposure: 1, vignette: 60 });
    const markup = renderToStaticMarkup(
      <DecksGraded grade={grade}>
        <span id="panel" />
      </DecksGraded>,
    );
    // The filtered panels first, then the layer, outside the filter: the vignette comes last, as the render's.
    const [filteredBox, panel, layer] = elementsOf(markup);
    expect(filteredBox.attributes.style).toContain(`filter:${gradeFilter(grade)}`);
    expect(panel.attributes.id).toBe("panel");
    expect(layer.attributes["data-vignette"]).toBeDefined();
    const alphas = [...layer.attributes.style.matchAll(/rgba\(0, 0, 0, ([\d.]+)\) (\d+)%/g)].map(([, alpha]) => Number(alpha));
    expect(layer.attributes.style).toContain("radial-gradient(circle farthest-corner");
    expect(alphas[0]).toBe(0);
    expect(alphas.at(-1)!).toBeGreaterThan(0.8);
    expect(alphas.every((alpha, i) => i === 0 || alpha >= alphas[i - 1])).toBe(true);

    // A vignette alone has no SVG filter, only its layer; one at 0 has no layer.
    const alone = adjusted(undefined, { vignette: 40 });
    expect(gradeFilter(alone)).toBeUndefined();
    expect(renderToStaticMarkup(<GradeFilters grades={[alone]} />)).toBe("");
    expect(renderToStaticMarkup(<GradeVignette grade={alone} />)).toContain("radial-gradient");
    expect(renderToStaticMarkup(<GradeVignette grade={adjusted(undefined, { exposure: 1 })} />)).toBe("");
  });

  test("the Color section's Effects group shows Sharpen, Fade and Vignette, and Reset takes them back too", () => {
    const noop = () => {};
    const effects = (grades: (Grade | undefined)[]) => {
      const markup = renderToStaticMarkup(<ColorFields grades={grades} onDial={noop} onReset={noop} onLook={noop} />);
      return { markup, reset: /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Reset/s.test(markup) ? "disabled" : "enabled" };
    };
    const { markup } = effects([undefined]);
    const at = (label: string) => markup.indexOf(`>${label}<`);
    expect(at("Effects")).toBeGreaterThan(-1);
    expect([at("Effects"), at("Sharpen"), at("Fade"), at("Vignette")].every((place, i, all) => i === 0 || place > all[i - 1])).toBe(true);
    expect(effects([undefined]).reset).toBe("disabled");
    expect(effects([adjusted(undefined, { sharpen: 30 })]).reset).toBe("enabled");
    expect(effects([adjusted(undefined, { vignette: 30 })]).reset).toBe("enabled");
  });
});
