// .scratch/templates/issues/07: the Review page's Apply Template dialog, a Template applied to the
// ticked Candidates in one request.
// No jsdom in this repo: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, NO_TEMPLATE, type Candidate, type TemplateInfo } from "../../api";
import { ApplyTemplateDialog, ApplyTemplateForm } from "./ApplyTemplateDialog";
import { appliedText, applyToTicked, firstPick, pickChoices, ticked, ticksOf } from "./applyTemplate";

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

const candidate = (id: string, title: string, selected: boolean) =>
  ({ id, title, selected, origin: "ai", start: 10, end: 40, revision: 1 }) as Candidate;
const CANDIDATES = [candidate("a", "First", true), candidate("b", "Second", false), candidate("c", "Third", true)];

// The checkboxes' labels, ticked or not.
const boxes = (html: string) =>
  [...html.matchAll(/<input type="checkbox"([^>]*)\/>/g)].map((match) => ({
    label: match[1].match(/aria-label="([^"]*)"/)?.[1],
    checked: match[1].includes('checked=""'),
  }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Apply Template dialog", () => {
  test("ticks the Candidates selected for rendering", () => {
    expect([...ticksOf(CANDIDATES)]).toEqual(["a", "c"]);
    const html = renderToStaticMarkup(<ApplyTemplateDialog open jobId="job" candidates={CANDIDATES} onClose={() => {}} onApplied={() => {}} />);
    expect(boxes(html)).toEqual([
      { label: "Apply to First", checked: true },
      { label: "Apply to Second", checked: false },
      { label: "Apply to Third", checked: true },
    ]);
  });

  test("offers No Template, the default picked first", () => {
    expect(pickChoices([TEASER, BRAND])).toEqual([
      { value: "teaser", label: "Podcast — short teaser" },
      { value: "brand", label: "Podcast — main (default)" },
      { value: NO_TEMPLATE, label: "No Template" },
    ]);
    expect(firstPick([TEASER, BRAND])).toBe("brand");
    expect(firstPick([TEASER])).toBe("teaser");
    expect(firstPick([])).toBe(NO_TEMPLATE);
    const html = renderToStaticMarkup(form({ templates: [TEASER, BRAND], pick: "brand" }));
    expect(html).toContain('<option value="">No Template</option>');
    expect(html).toContain('<option value="brand" selected="">Podcast — main (default)</option>');
  });

  test("shows each ticked Candidate's notices from the dry run", () => {
    const html = renderToStaticMarkup(
      form({ preview: { a: ["2 Template items changed by hand were replaced"], c: ["The lower-third was cut to fit"] } }),
    );
    const first = html.indexOf("Apply to First");
    const third = html.indexOf("Apply to Third");
    const handReplaced = html.indexOf("2 Template items changed by hand were replaced");
    const cut = html.indexOf("The lower-third was cut to fit");
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(handReplaced);
    expect(handReplaced).toBeLessThan(third);
    expect(third).toBeLessThan(cut);
  });

  test("leaves an unticked Candidate out of the request", async () => {
    const ticks = ticked(ticksOf(CANDIDATES), "c", false);
    expect([...ticks]).toEqual(["a"]);
    expect([...ticked(ticks, "b", true)]).toEqual(["a", "b"]);
    const sent = vi.spyOn(api, "applyTemplate").mockResolvedValue({ candidates: [] });
    await applyToTicked("job", "brand", CANDIDATES, ticks);
    expect(sent.mock.calls[0][1].candidate_ids).toEqual(["a"]);
  });

  test("sends one request for all the ticked Candidates, in the list's order", async () => {
    const sent = vi.spyOn(api, "applyTemplate").mockResolvedValue({ candidates: [] });
    await applyToTicked("job", "brand", CANDIDATES, new Set(["c", "b"]));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith("job", { template_id: "brand", candidate_ids: ["b", "c"], dry_run: false });
  });

  test("says what was applied, and to how many", () => {
    expect(appliedText("Podcast — main", 5)).toBe("Applied Podcast — main to 5 clips");
    expect(appliedText(null, 1)).toBe("Took the Template items off 1 clip");
  });

  test("sends No Template as null", async () => {
    const sent = vi.spyOn(api, "applyTemplate").mockResolvedValue({ candidates: [] });
    await applyToTicked("job", NO_TEMPLATE, CANDIDATES, new Set(["a"]), true);
    expect(sent).toHaveBeenCalledWith("job", { template_id: null, candidate_ids: ["a"], dry_run: true });
  });
});

function form(props: Partial<Parameters<typeof ApplyTemplateForm>[0]>) {
  return (
    <ApplyTemplateForm
      templates={[TEASER, BRAND]}
      pick="brand"
      onPick={() => {}}
      candidates={CANDIDATES}
      ticks={ticksOf(CANDIDATES)}
      onTick={() => {}}
      preview={{}}
      checking={false}
      {...props}
    />
  );
}
