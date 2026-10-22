// .scratch/canvas-aspect/issues/05-aspect-picker.md: the aspect picker saves the edits waiting
// before it sends the aspect, sends nothing for the aspect the Candidate has, and is a labelled group
// of buttons with the Candidate's pressed. No jsdom in this repo, so the markup is checked with
// renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Aspect, Candidate } from "../../../api";
import { AspectPicker, changeAspect } from "./AspectPicker";

function steps() {
  const calls: string[] = [];
  const answer = { id: "c", aspect: "16:9", revision: 3 } as Candidate;
  return {
    calls,
    answer,
    flush: async () => {
      await Promise.resolve();
      calls.push("flush");
    },
    send: async (aspect: Aspect) => {
      calls.push(`send ${aspect}`);
      return answer;
    },
  };
}

describe("changing the aspect", () => {
  test("saves the edits waiting first, then sends the aspect, and gives its Revision", async () => {
    const given = steps();
    expect(await changeAspect("9:16", "16:9", given)).toBe(given.answer);
    expect(given.calls).toEqual(["flush", "send 16:9"]);
  });

  test("sends nothing, not even the edits waiting, when the Candidate's aspect is picked again", async () => {
    const given = steps();
    expect(await changeAspect("4:5", "4:5", given)).toBeNull();
    expect(given.calls).toEqual([]);
  });

  test("sends nothing when the save of the edits waiting fails", async () => {
    const given = steps();
    const failing = { ...given, flush: () => Promise.reject(new Error("offline")) };
    await expect(changeAspect("9:16", "1:1", failing)).rejects.toThrow("offline");
    expect(given.calls).toEqual([]);
  });
});

describe("the picker", () => {
  test("is a labelled group of the four aspects, the Candidate's pressed", () => {
    const html = renderToStaticMarkup(<AspectPicker value="1:1" onPick={() => {}} />);
    expect(html).toContain('role="group" aria-label="Canvas aspect"');
    const buttons = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*aria-label="([^"]+)"/g)].map((m) => [m[2], m[1]]);
    expect(buttons).toEqual([
      ["Vertical 9:16 (Shorts, Reels, TikTok)", "false"],
      ["Portrait 4:5 (feed)", "false"],
      ["Square 1:1", "true"],
      ["Landscape 16:9 (YouTube, X)", "false"],
    ]);
    expect(html).not.toContain('aria-disabled="');
  });

  test("is busy and can't be used while a change is being saved", () => {
    const html = renderToStaticMarkup(<AspectPicker value="9:16" onPick={() => {}} busy />);
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(4);
  });
});
