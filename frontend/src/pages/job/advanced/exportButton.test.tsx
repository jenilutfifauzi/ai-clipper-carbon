// The Export button in Advanced Edit: the TopBar's main action, last after its other groups, and a
// Render button with the Export Presets as its quality menu. No jsdom in this repo, so the markup is
// checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ExportPresetList } from "../../../api";
import { RenderButton } from "../RenderButton";
import { TopBar } from "./Chrome";

const presets = {
  presets: [
    { id: "shorts", name: "Shorts", builtin: true, order: 0, settings: {} },
    { id: "high-quality", name: "High quality", builtin: true, order: 1, settings: {} },
  ],
  default: "shorts",
  available: ["h264"],
} as unknown as ExportPresetList;

describe("Export in the TopBar", () => {
  test("the primary action comes last, after the document actions and a divider", () => {
    const html = renderToStaticMarkup(
      <TopBar
        title="#1 Clip"
        status="Saved"
        actions={<button type="button">History</button>}
        primary={<button type="button">Export</button>}
        onClose={() => {}}
      />,
    );
    expect(html.indexOf(">Export<")).toBeGreaterThan(html.indexOf(">History<"));
    expect(html.slice(html.indexOf(">History<"), html.indexOf(">Export<"))).toContain("w-px");
  });

  test("groups the layout controls, the document actions and Export, each set off by a divider", () => {
    const html = renderToStaticMarkup(
      <TopBar
        title="#1 Clip"
        status="Saved"
        layout={<button type="button">Layout</button>}
        actions={<button type="button">History</button>}
        primary={<button type="button">Export</button>}
        onShortcuts={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html.match(/w-px/g)).toHaveLength(2);
    const order = [">Layout<", 'aria-label="Keyboard shortcuts"', ">History<", ">Export<"].map((mark) => html.indexOf(mark));
    expect(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1]))).toBe(true);
  });

  test("undo and redo are no longer in the top bar (they are the timeline toolbar's)", () => {
    const html = renderToStaticMarkup(<TopBar title="#1 Clip" status="Saved" primary={<button type="button">Export</button>} onClose={() => {}} />);
    expect(html).not.toContain('aria-label="Undo"');
    expect(html).not.toContain('aria-label="Redo"');
  });

  test("a compact bar (a phone's) folds the document actions behind More, into a row under the bar", () => {
    const html = renderToStaticMarkup(
      <TopBar
        title="#1 Clip"
        status="Saved"
        actions={<button type="button">History</button>}
        primary={<button type="button">Export</button>}
        compact
        onClose={() => {}}
      />,
    );
    expect(html).toContain('aria-label="More actions" aria-expanded="false"');
    expect(html.indexOf(">History<")).toBeGreaterThan(html.indexOf(">Export<"));
    expect(html).toMatch(/role="group" aria-label="More actions" class="[^"]*hidden/);
  });

  test("without a primary action there is no divider", () => {
    const html = renderToStaticMarkup(<TopBar title="#1 Clip" status="Saved" onClose={() => {}} />);
    expect(html).not.toContain("w-px");
  });

  test("Export lists every Export Preset, the picked one checked and the default marked", () => {
    const html = renderToStaticMarkup(
      <RenderButton label="Export" icon={<svg data-icon="upload" />} variant="primary" presets={presets} picked="high-quality" onRender={() => {}} />,
    );
    expect(html).toContain('data-icon="upload"');
    expect(html).toContain('aria-label="Export Preset: High quality"');
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-checked="true"[^>]*>.*High quality/);
    expect(html).toContain("Default");
  });
});
