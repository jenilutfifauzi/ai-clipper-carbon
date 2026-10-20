// The fold of a Grade into tables and a matrix (.scratch/color-adjust/issues/01-segment-grade-adjust-dials.md,
// ADR 0013), on the cases the backend's tests read too (backend/tests/fixtures/grade_folds.json), so
// that the preview's fold and the render's can't drift; and the preview's SVG filter, built from it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import cases from "../../../../../backend/tests/fixtures/grade_folds.json";
import type { Grade } from "../../../api";
import { GradeFilter, GradeFilters } from "./GradeFilters";
import { adjusted, foldGrade, gradeFilter, gradeFilterId, gradeOf, NEUTRAL_GRADE, TABLE_SIZE } from "./grading";

const close = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThan(cases.tolerance));
};

describe("a Grade's fold", () => {
  for (const { name, grade, tables, matrix } of cases.cases) {
    test(`${name}: folds into the tables and matrix the shared cases say`, () => {
      const folded = foldGrade(grade as Partial<Grade>);
      if (tables === null) expect(folded?.tables ?? null).toBeNull();
      else {
        expect(folded?.tables?.map((table) => table.length)).toEqual([TABLE_SIZE, TABLE_SIZE, TABLE_SIZE]);
        folded!.tables!.forEach((table, channel) => close(table, tables[channel]));
      }
      if (matrix === null) expect(folded?.matrix ?? null).toBeNull();
      else folded!.matrix!.forEach((row, i) => close(row, matrix[i]));
    });
  }

  test("a neutral Grade, or one saved before Grades, folds to nothing and has no filter", () => {
    for (const grade of [NEUTRAL_GRADE, undefined, null, { adjust: { temperature: 6500 } }]) {
      expect(foldGrade(grade as Partial<Grade>)).toBeNull();
      expect(gradeFilter(grade as Partial<Grade>)).toBeUndefined();
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
