// .scratch/export-settings/issues/05: the Export Presets sheet's form, the Render menu's last item,
// and the batch the menu estimates.
// No jsdom in this repo: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Candidate, ExportPresetList, ExportSettings } from "../../api";
import { batchParts, batchSecs, sourceHeight } from "./exportPresets";
import { ExportPresetsSheet } from "./ExportPresetsSheet";
import { RenderButton } from "./RenderButton";

const SHORTS: ExportSettings = { codec: "h264", resolution: 1080, fps: null, quality: "recommended", bitrate: null, loudness: -14 };
const LIST: ExportPresetList = {
  presets: [
    { id: "shorts", name: "Shorts / TikTok / Reels", builtin: true, order: 0, settings: SHORTS },
    { id: "mine", name: "Mine", builtin: false, order: 0, settings: { ...SHORTS, codec: "hevc", resolution: 1440 } },
  ],
  default: "shorts",
  available: ["h264", "hevc"],
};

function sheet(picked: string, height: number | null = null): string {
  return renderToStaticMarkup(
    <ExportPresetsSheet open list={LIST} initial={picked} sourceHeight={height} onClose={() => {}} onChange={() => {}} />,
  );
}

// The labels of the sheet's buttons.
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));

describe("the Export Presets sheet", () => {
  test("shows a built-in Preset's form read-only, with Duplicate and no Save or Delete", () => {
    const html = sheet("shorts");
    expect(html).toMatch(/<fieldset disabled=""[^>]*aria-label="Export Settings"/);
    expect(html).toContain('value="Shorts / TikTok / Reels"');
    expect(buttons(html)).toContain("Duplicate");
    expect(buttons(html)).not.toContain("Save");
    expect(buttons(html)).not.toContain("Delete");
  });

  test("lets the owner's Preset be saved, deleted and made the default", () => {
    const html = sheet("mine");
    expect(html).not.toMatch(/<fieldset disabled=""[^>]*aria-label="Export Settings"/);
    expect(buttons(html)).toEqual(expect.arrayContaining(["Save", "Delete", "Make default", "Duplicate"]));
  });

  test("lists the Presets, the default marked and the picked one current", () => {
    const html = sheet("mine");
    expect(html).toMatch(/aria-current="true"[^>]*>.*?Mine/);
    expect(html).toMatch(/Shorts \/ TikTok \/ Reels.*?Default/);
  });

  test("says Larger than the Source by the resolutions above the Source's height", () => {
    const html = sheet("shorts", 1080);
    const notes = [...html.matchAll(/value="(\d+)"[^>]*\/>.*?<\/label>/g)].filter((match) => match[0].includes("Larger than the Source"));
    expect(notes.map((match) => match[1])).toEqual(["1440", "2160"]);
    // Not opened from a Job, nothing is said.
    expect(sheet("shorts")).not.toContain("Larger than the Source");
  });

  test("disables a codec this Mac can't encode", () => {
    const html = sheet("mine");
    expect(html).toMatch(/<input [^>]*disabled=""[^>]*value="av1"/);
    expect(html).toContain("not on this Mac");
    expect(html).not.toMatch(/<input [^>]*disabled=""[^>]*value="hevc"/);
  });
});

describe("the Render menu", () => {
  test("ends with Export Presets…", () => {
    const html = renderToStaticMarkup(
      <RenderButton label="Render selected" presets={LIST} picked="shorts" onRender={() => {}} onManage={() => {}} />,
    );
    const items = [...html.matchAll(/role="menuitem(?:radio)?"[^>]*>(.*?)<\/button>/g)].map((match) => match[1].replace(/<[^>]+>/g, ""));
    expect(items.at(-1)).toBe("Export Presets…");
  });
});

describe("the batch", () => {
  const candidate = (fields: Partial<Candidate>) => ({ start: 10, end: 40, segments: [], transitions: [], ...fields }) as Candidate;

  test("lasts its Candidates' Timelines, Segments' Speeds and Transitions' overlaps included", () => {
    expect(batchSecs([candidate({}), candidate({ start: 0, end: 15 })])).toBe(45);
    const segments = [
      { id: "a", start: 0, end: 10, speed: 2 },
      { id: "b", start: 20, end: 30 },
    ];
    expect(batchSecs([candidate({ segments, transitions: [{ after: "a", kind: "fade", secs: 1 }] as Candidate["transitions"] })])).toBe(14);
  });

  test("is estimated per Canvas Aspect, each lasting its own Candidates", () => {
    const batch = [candidate({ aspect: "16:9" }), candidate({ aspect: "9:16", start: 0, end: 15 }), candidate({ aspect: "16:9", start: 0, end: 5 })];
    expect(batchParts(batch)).toEqual([
      { aspect: "16:9", secs: 35 },
      { aspect: "9:16", secs: 15 },
    ]);
    expect(batchParts([])).toEqual([]);
  });

  test("is drawn against the Source's short side", () => {
    expect(sourceHeight({ width: 1920, height: 1080 })).toBe(1080);
    expect(sourceHeight({ width: 720, height: 1280 })).toBe(720);
  });
});
