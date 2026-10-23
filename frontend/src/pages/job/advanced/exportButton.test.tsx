// The Export button in Advanced Edit: the TopBar's main action, last after undo and redo, and a
// Render button with the Export Presets as its quality menu. No jsdom in this repo, so the markup is
// checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ExportPresetList } from "../../../api";
import { RenderButton } from "../RenderButton";
import { TopBar } from "./Chrome";

const history = { undo: () => {}, redo: () => {}, canUndo: false, canRedo: false } as unknown as Parameters<typeof TopBar>[0]["history"];

const presets = {
  presets: [
    { id: "shorts", name: "Shorts", builtin: true, order: 0, settings: {} },
    { id: "high-quality", name: "High quality", builtin: true, order: 1, settings: {} },
  ],
  default: "shorts",
  available: ["h264"],
} as unknown as ExportPresetList;

describe("Export in the TopBar", () => {
  test("the primary action comes after Redo", () => {
    const html = renderToStaticMarkup(
      <TopBar title="#1 Clip" status="Saved" history={history} primary={<button type="button">Export</button>} onClose={() => {}} />,
    );
    expect(html.indexOf('aria-label="Redo"')).toBeGreaterThan(-1);
    expect(html.indexOf(">Export<")).toBeGreaterThan(html.indexOf('aria-label="Redo"'));
  });

  test("without a primary action there is no divider", () => {
    const html = renderToStaticMarkup(<TopBar title="#1 Clip" status="Saved" history={history} onClose={() => {}} />);
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
