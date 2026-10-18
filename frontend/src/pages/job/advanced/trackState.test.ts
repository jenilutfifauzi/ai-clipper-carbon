// Track mute stays the editor's alone (.scratch/audio-mixing/issues/02-muted-agent-render-preview.md):
// the heard draft silences muted Tracks by volume 0 and never writes an item's saved `muted`.
import { describe, expect, test } from "vitest";
import type { CandidateChange } from "../../../api";
import { heardDraft, UNTOUCHED } from "./trackState";

const draft: CandidateChange = {
  segments: [{ id: "a", start: 1, end: 3, volume: 0.5, muted: true }, { id: "b", start: 5, end: 7 }],
  overlays: [
    {
      id: "o",
      media: "clip",
      start: 0,
      secs: 2,
      offset: 0,
      transform: { x: 540, y: 960, scale: 0.5, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      volume: 1,
      radius: 0,
      border: null,
      shadow: null,
      keys: {},
    },
  ],
};

describe("a muted Track", () => {
  test("is heard at volume 0, each item's Muted left as it is", () => {
    const heard = heardDraft(draft, { ...UNTOUCHED, muted: ["video", "overlay"] });
    expect(heard.source_volume).toBe(0);
    expect(heard.segments?.map(({ volume, muted }) => ({ volume, muted }))).toEqual([{ volume: 0, muted: true }, { volume: 0, muted: undefined }]);
    expect(heard.overlays?.map(({ volume, muted }) => ({ volume, muted }))).toEqual([{ volume: 0, muted: undefined }]);
  });
});
