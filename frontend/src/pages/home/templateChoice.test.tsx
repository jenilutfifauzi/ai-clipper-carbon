// .scratch/templates/issues/08: the New Job form's Template choice, and what the Job is asked for.
// No jsdom in this repo: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DEFAULT_TEMPLATE, type TemplateInfo } from "../../api";
import { chosenName, NO_TEMPLATE, templateChoices, templateOption } from "./templateChoice";
import { TemplateField } from "./TemplateField";

const AT = "2026-10-22T00:00:00Z";
const template = (id: string, name: string, isDefault = false): TemplateInfo => ({
  id,
  name,
  created_at: AT,
  updated_at: AT,
  default: isDefault,
});
const BRAND = template("brand", "Podcast — main", true);
const TEASER = template("teaser", "Podcast — short teaser");

describe("the New Job form's Template choice", () => {
  test("offers the default by name, the others, and none", () => {
    expect(templateChoices([TEASER, BRAND])).toEqual([
      { value: DEFAULT_TEMPLATE, label: "Podcast — main (default)" },
      { value: "teaser", label: "Podcast — short teaser" },
      { value: NO_TEMPLATE, label: "No Template" },
    ]);
  });

  test("with no default, the default choice is No Template", () => {
    expect(templateChoices([TEASER])).toEqual([
      { value: DEFAULT_TEMPLATE, label: "No Template" },
      { value: "teaser", label: "Podcast — short teaser" },
    ]);
  });

  test("sends the chosen Template, none as null, and leaves the default to the backend", () => {
    expect(templateOption("teaser")).toEqual({ template: "teaser" });
    expect(templateOption(NO_TEMPLATE)).toEqual({ template: null });
    expect(templateOption(DEFAULT_TEMPLATE)).toEqual({});
  });

  test("names the chosen Template for the options' summary", () => {
    expect(chosenName(DEFAULT_TEMPLATE, [TEASER, BRAND])).toBe("Podcast — main");
    expect(chosenName("teaser", [TEASER, BRAND])).toBe("Podcast — short teaser");
    expect(chosenName(NO_TEMPLATE, [TEASER, BRAND])).toBeNull();
    expect(chosenName(DEFAULT_TEMPLATE, [TEASER])).toBeNull();
  });

  test("is a labelled select with the chosen one selected, and absent with no Templates", () => {
    const html = renderToStaticMarkup(<TemplateField templates={[TEASER, BRAND]} value="teaser" onChange={() => {}} />);
    expect(html).toMatch(/<label[^>]*>Template<\/label>/);
    expect(html).toMatch(/<option value="teaser" selected="">Podcast — short teaser<\/option>/);
    expect(html).toContain("Podcast — main (default)");
    expect(renderToStaticMarkup(<TemplateField templates={[]} value={DEFAULT_TEMPLATE} onChange={() => {}} />)).toBe("");
  });
});
