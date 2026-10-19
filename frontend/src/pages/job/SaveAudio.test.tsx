// .scratch/export-settings/issues/08: "Save audio" in the Clip's and the Candidate's actions, and the
// name its file downloads as. No jsdom in this repo: the menu's markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { downloadName } from "../../format";
import { SaveAudioButton } from "./SaveAudio";

describe("Save audio", () => {
  test("downloads the file named after the Candidate's title, or clip-<id> without one", () => {
    expect(downloadName("Why: we/ship <fast>?", "ab12", "wav")).toBe("Why we ship fast.wav");
    expect(downloadName("Podcast  tips", "ab12", "m4a")).toBe("Podcast tips.m4a");
    expect(downloadName("", "ab12", "wav")).toBe("clip-ab12.wav");
    expect(downloadName(undefined, "ab12", "mp4")).toBe("clip-ab12.mp4");
  });

  test("offers WAV and M4A from its menu", () => {
    const html = renderToStaticMarkup(<SaveAudioButton jobId="j1" candidate={{ id: "ab12", title: "Tips" }} exportPresetId="small" />);
    expect(html).toContain("Save audio");
    expect(html).toContain('aria-haspopup="menu"');
    const items = [...html.matchAll(/role="menuitem"[^>]*>(.*?)<\/button>/g)].map((item) => item[1].replace(/<[^>]+>/g, ""));
    expect(items).toEqual(["WAVLossless, 48 kHz 16-bit", "M4AAAC, small"]);
  });
});
