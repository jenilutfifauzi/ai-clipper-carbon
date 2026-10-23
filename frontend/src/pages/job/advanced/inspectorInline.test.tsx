// .scratch/workspace-polish/issues/05: the Inspector's fields as inline rows, label left and value
// right, in groups that fold, while the same fields outside it (the clip editor) render exactly as
// they did before.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ColorField } from "../../../components/ColorField";
import { InspectorLayout } from "../../../components/inspectorLayout";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { Group } from "../editor/StyleFields";

const noop = () => {};

const fields = {
  slider: <Slider label="Size" value={6.6} min={0} max={20} step={0.1} format={(v) => `${v} %`} onChange={noop} />,
  sliderAfter: <Slider label="Opacity" value={1} min={0} max={1} onChange={noop} after={<i>k</i>} />,
  switch: (
    <Switch checked onChange={noop}>
      Italic
    </Switch>
  ),
  select: <Select label="Font" value="a" options={[{ value: "a", label: "A" }]} onChange={noop} />,
  color: <ColorField label="Color" value="#FFFFFF" onChange={noop} />,
  group: (
    <Group title="Typography">
      <p>x</p>
    </Group>
  ),
};

// Each field's markup before this ticket, rendered from the components as they were.
const BEFORE: Record<keyof typeof fields, string> = {
  slider: "<div class=\"flex min-w-0 flex-col gap-1\"><div class=\"flex items-center justify-between gap-2 text-sm\"><label for=\":R0:\" class=\"flex items-center gap-1.5 font-medium\">Size</label><output for=\":R0:\" class=\"ml-auto text-muted tabular-nums\">6.6 %</output></div><input id=\":R0:\" type=\"range\" min=\"0\" max=\"20\" step=\"0.1\" class=\"h-7 w-full cursor-pointer accent-accent disabled:cursor-default disabled:opacity-50 in-data-sheet:h-11\" value=\"6.6\"/></div>",
  sliderAfter: "<div class=\"flex min-w-0 flex-col gap-1\"><div class=\"flex items-center justify-between gap-2 text-sm\"><label for=\":R0:\" class=\"flex items-center gap-1.5 font-medium\">Opacity</label><output for=\":R0:\" class=\"ml-auto text-muted tabular-nums\">1</output><i>k</i></div><input id=\":R0:\" type=\"range\" min=\"0\" max=\"1\" step=\"1\" class=\"h-7 w-full cursor-pointer accent-accent disabled:cursor-default disabled:opacity-50 in-data-sheet:h-11\" value=\"1\"/></div>",
  switch: "<label class=\"flex min-h-11 items-center gap-3 cursor-pointer\"><input type=\"checkbox\" role=\"switch\" class=\"peer sr-only\" checked=\"\"/><span aria-hidden=\"true\" class=\"relative h-7.5 w-12.5 shrink-0 rounded-full bg-fill peer-checked:bg-linear-to-b peer-checked:from-accent peer-checked:to-accent-end peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus after:absolute after:top-0.5 after:left-0.5 after:size-6.5 after:rounded-full after:bg-white after:shadow-[0_0_0_0.5px_rgb(0_0_0/0.06),0_3px_8px_rgb(0_0_0/0.2)] peer-checked:after:translate-x-5 motion-safe:after:transition-transform motion-safe:after:duration-[380ms] motion-safe:after:ease-spring\"></span>Italic</label>",
  select: "<div class=\"flex min-w-0 flex-col gap-1\"><label for=\":R0:\" class=\"flex items-center gap-1.5 text-sm font-medium\">Font</label><div class=\"relative\"><select id=\":R0:\" class=\"min-h-10 w-full appearance-none enabled:cursor-pointer disabled:opacity-60 rounded-[10px] border border-border bg-fill py-2 pr-9 pl-3 text-base\"><option value=\"a\" selected=\"\">A</option></select><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-chevron-down pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted\" aria-hidden=\"true\"><path d=\"m6 9 6 6 6-6\"></path></svg></div></div>",
  color: "<div class=\"flex min-w-0 flex-col gap-1\"><label for=\":R0:-code\" class=\"flex items-center gap-1.5 text-sm font-medium\">Color</label><div class=\"flex items-center gap-2\"><input type=\"color\" aria-label=\"Color: pick\" class=\"size-10 shrink-0 cursor-pointer rounded-[10px] border border-border bg-fill p-1\" value=\"#ffffff\"/><input id=\":R0:-code\" aria-label=\"Color: code\" maxLength=\"7\" spellcheck=\"false\" autoComplete=\"off\" class=\"min-h-10 w-full min-w-0 rounded-[10px] border bg-fill px-3 font-mono text-base uppercase tabular-nums border-border\" value=\"#FFFFFF\"/></div></div>",
  group: "<fieldset class=\"flex min-w-0 flex-col gap-3 border-t border-border pt-4\"><legend class=\"float-left mb-1 text-sm font-semibold text-muted\">Typography</legend><p>x</p></fieldset>",
};

const inInspector = (node: ReactNode, folded: string[] = []) =>
  renderToStaticMarkup(<InspectorLayout.Provider value={{ folded, onFold: noop }}>{node}</InspectorLayout.Provider>);

describe("outside the Inspector", () => {
  test.each(Object.keys(fields) as (keyof typeof fields)[])("%s renders byte for byte as before", (name) => {
    expect(renderToStaticMarkup(fields[name])).toBe(BEFORE[name]);
  });
});

describe("in the Inspector", () => {
  test("a slider is one row: its label, then its track, then its value", () => {
    const markup = inInspector(fields.slider);
    expect(markup).not.toBe(BEFORE.slider);
    expect(markup).toMatch(/^<div class="flex min-h-9 min-w-0 items-center gap-2">/);
    expect(markup.indexOf("<label")).toBeLessThan(markup.indexOf('type="range"'));
    expect(markup.indexOf('type="range"')).toBeLessThan(markup.indexOf("<output"));
    // Still labelled: the label is for the range.
    const id = /<input id="([^"]+)" type="range"/.exec(markup)![1];
    expect(markup).toContain(`<label for="${id}"`);
  });

  test("a slider with a cluster after its value keeps its track the full width under its row", () => {
    expect(inInspector(fields.sliderAfter)).toBe(BEFORE.sliderAfter);
  });

  test("a switch has its label left and the switch right", () => {
    expect(inInspector(fields.switch)).toContain("flex-row-reverse items-center justify-between");
  });

  test("a switch labelled from elsewhere sits in its owner's row as it is", () => {
    const labelled = (
      <Switch checked onChange={noop} labelledBy="name">
        {null}
      </Switch>
    );
    expect(inInspector(labelled)).toBe(renderToStaticMarkup(labelled));
  });

  test("a select and a colour have their label left of the control", () => {
    for (const name of ["select", "color"] as const) {
      expect(inInspector(fields[name])).toMatch(/^<div class="flex min-w-0 items-center gap-2"><label for="[^"]+" class="flex w-\[38%\] shrink-0/);
    }
  });

  test("a group is a disclosure titled by its summary, open unless folded", () => {
    const open = inInspector(fields.group);
    expect(open).toMatch(/^<details open="" class="group\/fold/);
    expect(open).toContain(">Typography</span></summary>");
    expect(open).not.toContain("<fieldset");
    expect(inInspector(fields.group, ["Typography"])).toMatch(/^<details class="group\/fold/);
    // Another group's fold doesn't shut this one.
    expect(inInspector(fields.group, ["Transform"])).toBe(open);
  });
});
