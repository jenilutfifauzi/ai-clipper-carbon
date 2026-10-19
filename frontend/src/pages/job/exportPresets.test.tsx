// .scratch/export-settings/issues/04: the Render button's menu of Export Presets, "Render again"'s
// Preset, and the settings line on a Clip's card.
// No jsdom in this repo: the menu's markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ExportPresetList, ExportSettings } from "../../api";
import { againPreset, pickedPreset, settingsLine } from "./exportPresets";
import { RenderButton } from "./RenderButton";

const SHORTS: ExportSettings = { codec: "h264", resolution: 1080, fps: null, quality: "recommended", bitrate: null, loudness: -14 };
const LIST: ExportPresetList = {
  presets: [
    { id: "shorts", name: "Shorts / TikTok / Reels", builtin: true, order: 0, settings: SHORTS },
    { id: "small", name: "Small", builtin: true, order: 10, settings: { ...SHORTS, resolution: 720, quality: "smallest" } },
    { id: "mine", name: "Mine", builtin: false, order: 0, settings: { ...SHORTS, codec: "hevc", resolution: 1440, quality: "high" } },
  ],
  default: "shorts",
  available: ["h264", "hevc"],
};

describe("the Render menu", () => {
  test("picks the default until another is picked", () => {
    expect(pickedPreset(LIST, null)).toBe("shorts");
    expect(pickedPreset({ ...LIST, default: "mine" }, null)).toBe("mine");
    expect(pickedPreset(LIST, "small")).toBe("small");
  });

  test("goes back to the default when the one picked is gone", () => {
    expect(pickedPreset(LIST, "deleted")).toBe("shorts");
  });

  test("lists the Presets, the default marked and picked", () => {
    const html = renderToStaticMarkup(<RenderButton label="Render selected" presets={LIST} picked={pickedPreset(LIST, null)} onRender={() => {}} />);
    const items = [...html.matchAll(/role="menuitemradio" aria-checked="(true|false)"[^>]*>(.*?)<\/button>/g)];
    expect(items.map((item) => item[2].replace(/<[^>]+>/g, ""))).toEqual(["Shorts / TikTok / ReelsDefault", "Small", "Mine"]);
    expect(items.map((item) => item[1])).toEqual(["true", "false", "false"]);
    expect(html).toContain('aria-label="Export Preset: Shorts / TikTok / Reels"');
  });

  test("is a plain button while the Presets aren't loaded", () => {
    const html = renderToStaticMarkup(<RenderButton label="Render selected" presets={null} picked={null} onRender={() => {}} />);
    expect(html).not.toContain('role="menu"');
    expect(html).toContain("Render selected");
  });
});

describe("Render again", () => {
  test("picks the Clip's Preset", () => {
    expect(againPreset(LIST, { export_preset_id: "small", output: null })).toBe("small");
  });

  test("picks the default once the Clip's Preset is deleted, or for a Clip from before Presets", () => {
    expect(againPreset(LIST, { export_preset_id: "deleted", output: null })).toBe("shorts");
    expect(againPreset(LIST, { export_preset_id: null, output: null })).toBe("shorts");
  });
});

describe("a Clip's settings line", () => {
  const output = { export_preset_id: "shorts", export: SHORTS, bitrate_fallback: false };

  test("says the resolution, codec, quality, loudness and Preset", () => {
    expect(settingsLine(output, LIST)).toBe("1080p · H.264 · Recommended · −14 LUFS · Shorts / TikTok / Reels");
    const archive: ExportSettings = { ...SHORTS, codec: "hevc", resolution: 2160, quality: "high", loudness: null };
    expect(settingsLine({ ...output, export_preset_id: "archive", export: archive }, LIST)).toBe("4K · HEVC · High · Loudness off");
  });

  test("names a chosen frame rate and a bitrate of the Preset's own", () => {
    const own: ExportSettings = { ...SHORTS, codec: "av1", fps: 59.94, bitrate: { mode: "cbr", kbps: 6000 }, loudness: -16 };
    expect(settingsLine({ ...output, export_preset_id: "mine", export: own }, LIST)).toBe("1080p · 59.94 fps · AV1 · CBR 6000 kb/s · −16 LUFS · Mine");
  });

  test("leaves out a Preset deleted since, or while the Presets aren't loaded", () => {
    expect(settingsLine({ ...output, export_preset_id: "deleted" }, LIST)).toBe("1080p · H.264 · Recommended · −14 LUFS");
    expect(settingsLine(output, null)).toBe("1080p · H.264 · Recommended · −14 LUFS");
  });

  test("is 1080p H.264 for a Clip rendered before Export Presets", () => {
    expect(settingsLine({ export_preset_id: null, export: null, bitrate_fallback: false }, LIST)).toBe("1080p · H.264");
  });
});
