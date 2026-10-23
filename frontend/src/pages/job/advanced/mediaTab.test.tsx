// One Media tab (ADR 0025): the Audio tab is gone, Media shows its songs under the Audio category,
// with All, Video and Images beside it. No jsdom in this repo, so the markup is checked with
// renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { MediaItem } from "../../../api";
import { AssetPanel } from "./AssetPanel";
import { ASSET_TABS, AssetTabs, PHONE_ASSET_TABS } from "./Chrome";
import { MediaCategories, mediaSections, uploadOf, type MediaCategory, type MediaLibrary } from "./MediaLibrary";

const item = (id: string, kind: MediaItem["kind"]) =>
  ({ id, kind, name: `${kind} ${id}`, has_audio: kind !== "image", duration: kind === "image" ? null : 10, width: 1080, height: 1920, size_bytes: 1000 }) as unknown as MediaItem;

const library = {
  items: [item("v", "video"), item("i", "image"), item("a", "audio")],
  error: null,
  uploads: [{ key: 1, name: "song.mp3", percent: 50, error: null }],
} as unknown as MediaLibrary;

const panel = (category: MediaCategory) =>
  renderToStaticMarkup(
    <AssetPanel
      tab="media"
      category={category}
      fonts={null}
      library={library}
      transcript={null}
      near={{ id: "s1", start: 0, end: 10 }}
      transitions={null}
      filters={null}
      effects={null}
      templates={null}
      narrate={null}
      onAddText={() => {}}
      onAddShape={() => {}}
      onAddMusic={() => {}}
      onAddSource={() => {}}
      onAddVideo={() => {}}
      onAddOverlay={() => {}}
    />,
  );

describe("the asset tabs", () => {
  test("have no Audio tab, on a desktop or a phone", () => {
    expect(ASSET_TABS.map((tab) => tab.value)).not.toContain("audio");
    expect(PHONE_ASSET_TABS.map((tab) => tab.value)).not.toContain("audio");
    expect(ASSET_TABS.map((tab) => tab.value)).toContain("media");
    expect(renderToStaticMarkup(<AssetTabs value="media" onChange={() => {}} />)).not.toContain('title="Audio"');
  });

  test("put the open tab on a filled background", () => {
    expect(renderToStaticMarkup(<AssetTabs value="media" onChange={() => {}} />)).toMatch(/aria-selected="true"[^>]*title="Media"[^>]*class="[^"]*bg-fill/);
  });
});

describe("the Media tab's categories", () => {
  test("All shows the moments, the videos and images, then the songs; each other category its own", () => {
    expect(mediaSections("all")).toEqual({ source: true, sections: [["video", "image"], ["audio"]] });
    expect(mediaSections("video")).toEqual({ source: true, sections: [["video"]] });
    expect(mediaSections("images")).toEqual({ source: false, sections: [["image"]] });
    expect(mediaSections("audio")).toEqual({ source: false, sections: [["audio"]] });
  });

  test("each section uploads its own kind", () => {
    expect(uploadOf(["audio"])).toMatchObject({ accept: "audio/*", label: "Upload music" });
    expect(uploadOf(["video"])).toMatchObject({ accept: "video/*", label: "Upload video" });
    expect(uploadOf(["image"])).toMatchObject({ accept: "image/png,image/jpeg,image/webp", label: "Upload image" });
    expect(uploadOf(["video", "image"]).label).toBe("Upload video or image");
  });

  test("Audio lists the songs alone, with their upload", () => {
    const html = panel("audio");
    expect(html).toContain("Upload music");
    expect(html).toContain("audio a");
    expect(html).not.toContain("Upload video");
    expect(html).not.toContain("video v");
  });

  test("Images lists the images alone", () => {
    const html = panel("images");
    expect(html).toContain("Upload image");
    expect(html).toContain("image i");
    expect(html).not.toContain("video v");
    expect(html).not.toContain("audio a");
  });

  test("All heads each section and shows the uploads under way once", () => {
    const html = panel("all");
    expect(html).toContain("Videos and images");
    expect(html).toContain(">Audio<");
    expect(html).toContain("Upload video or image");
    expect(html).toContain("Upload music");
    expect(html.match(/>song\.mp3</g)).toHaveLength(1);
  });

  test("the sub-nav lists All, Video, Audio and Images, the picked one selected", () => {
    const html = renderToStaticMarkup(<MediaCategories value="audio" onChange={() => {}} column />);
    expect(html).toContain('aria-label="Media categories"');
    expect([...html.matchAll(/role="tab"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)</g)].map((m) => m[1])).toEqual(["All", "Video", "Audio", "Images"]);
    expect(html).toMatch(/aria-selected="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)Audio</);
  });
});
