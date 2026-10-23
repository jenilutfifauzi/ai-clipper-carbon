// The timeline toolbar in groups (ADR 0025), each set off by a divider: Undo/Redo | the picked items'
// buttons | Magnet and Skim | Add Text and Add Audio, with the zoom on the right. No jsdom in this
// repo, so the markup is checked with renderToStaticMarkup.
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { Playback, playedFrom } from "../editor/playback";
import { AdvancedTimeline } from "./AdvancedTimeline";
import { AddTools, HistoryTools } from "./Chrome";
import type { EditHistory } from "./useEditHistory";
import type { AdvancedEdits } from "./edits";

// The playhead's and the Skim's hooks read straight away: a page rendered without a browser has no
// store to subscribe to.
vi.mock("../editor/playback", async (original) => ({
  ...(await original<typeof import("../editor/playback")>()),
  usePlayback: (playback: Playback, select: (time: number, playback: Playback) => unknown) => select(playback.time, playback),
}));
vi.mock("./skim", async (original) => ({
  ...(await original<typeof import("./skim")>()),
  useSkim: () => false,
  useSkimSound: () => false,
}));

function toolbar(skimmable: boolean) {
  const playback = new Playback();
  playback.setSegments(playedFrom([{ start: 0, end: 10 }]));
  return renderToStaticMarkup(
    <AdvancedTimeline
      duration={10}
      playback={playback}
      fps={30}
      snapPoints={[]}
      history={<button type="button">History</button>}
      tools={<button type="button">Tools</button>}
      modes={<button type="button">Magnet</button>}
      adds={<button type="button">Adds</button>}
      toFit={() => ({ zoom: 1, scroll: 0 }) as never}
      fitRef={createRef()}
      zoomStepRef={createRef()}
      skimmable={skimmable}
    >
      {() => null}
    </AdvancedTimeline>,
  );
}

// Each mark found after the one before it.
const inOrder = (html: string, marks: string[]) => {
  let from = 0;
  for (const mark of marks) {
    const at = html.indexOf(mark, from);
    if (at < 0) return false;
    from = at + mark.length;
  }
  return true;
};

describe("the timeline toolbar", () => {
  test("is undo and redo, the item tools, Magnet and Skim, the adds, then the zoom", () => {
    const html = toolbar(true);
    expect(inOrder(html, [">History<", ">Tools<", ">Magnet<", 'aria-label="Skim"', ">Adds<", 'aria-label="Zoom out"'])).toBe(true);
  });

  test("sets each group off by a divider", () => {
    const html = toolbar(true);
    const bar = html.slice(0, html.indexOf('aria-label="Zoom"'));
    expect(bar.match(/w-px/g)).toHaveLength(3);
    expect(inOrder(bar, [">History<", "w-px", ">Tools<", "w-px", ">Magnet<", "w-px", ">Adds<"])).toBe(true);
  });

  test("without the Skim (a phone), Magnet keeps its group", () => {
    const html = toolbar(false);
    expect(html).not.toContain('aria-label="Skim"');
    expect(html.slice(0, html.indexOf('aria-label="Zoom"')).match(/w-px/g)).toHaveLength(3);
  });

  test("undo and redo carry their shortcuts, off when there is nothing to take back", () => {
    const history = { undo: () => {}, redo: () => {}, canUndo: false, canRedo: true } as unknown as EditHistory<AdvancedEdits>;
    const html = renderToStaticMarkup(<HistoryTools history={history} />);
    expect(html).toMatch(/disabled=""[^>]*aria-label="Undo"|aria-label="Undo"[^>]*disabled=""/);
    expect(html).toMatch(/title="Undo \((⌘|Ctrl\+)Z\)"/);
    expect(html).toContain('aria-label="Redo"');
  });

  test("Add Text and Add Audio are named for a screen reader", () => {
    const html = renderToStaticMarkup(<AddTools onText={() => {}} onAudio={() => {}} />);
    expect(inOrder(html, ['aria-label="Add text"', 'aria-label="Add audio"'])).toBe(true);
  });
});
