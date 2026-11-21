import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { vi } from "vitest";

vi.mock("../editor/playback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../editor/playback")>()),
  usePlayback: () => false,
}));

import { Playback } from "../editor/playback";
import { freezer, splitter } from "./actions";
import { PHONE_ASSET_TABS, Toolbar } from "./Chrome";

const toolbar = () =>
  renderToStaticMarkup(
    <Toolbar
      pick={null}
      actions={null}
      splitter={splitter({} as never, () => 0, () => {})}
      freezer={freezer({} as never, () => 0, () => {})}
      playback={new Playback()}
      picking={false}
      paste={null}
      mute={null}
      onAsset={() => {}}
      onInspect={() => {}}
      onTransform={() => {}}
      onSpeed={null}
      onCompare={() => {}}
      onMeters={() => {}}
      onTracks={() => {}}
      onPlayback={() => {}}
      onPicking={() => {}}
      onDeselect={() => {}}
    />,
  );

describe("phone advanced-editor entry points", () => {
  test("keeps Video Effects in the compact phone asset shelf", () => {
    expect(PHONE_ASSET_TABS.map((tab) => tab.value)).toContain("effects");
  });

  test("offers Compare and Meters as finger-sized toolbar tools", () => {
    const markup = toolbar();
    expect(markup).toMatch(/min-h-14 min-w-16[^\"]*[^>]*>.*?Compare<\/button>/s);
    expect(markup).toMatch(/min-h-14 min-w-16[^\"]*[^>]*>.*?Meters<\/button>/s);
  });
});
