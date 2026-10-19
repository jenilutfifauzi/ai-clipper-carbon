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
    expect(heard.source_volume).toBeUndefined();
    expect(heard.segments?.map(({ volume, muted }) => ({ volume, muted }))).toEqual([{ volume: 0, muted: true }, { volume: 0, muted: undefined }]);
    expect(heard.overlays?.map(({ volume, muted }) => ({ volume, muted }))).toEqual([{ volume: 0, muted: undefined }]);
  });

  test("silences keyed items too, by their volume Keyframes, keeping their other Keyframes", () => {
    const volume = [{ at: 0, value: 1, ease: [0, 0, 1, 1] as [number, number, number, number] }];
    const opacity = [{ at: 0, value: 0.5, ease: [0, 0, 1, 1] as [number, number, number, number] }];
    const keyed: CandidateChange = {
      segments: [{ id: "a", start: 1, end: 3, keys: { volume } }],
      overlays: draft.overlays?.map((overlay) => ({ ...overlay, keys: { volume, opacity } })),
    };
    const heard = heardDraft(keyed, { ...UNTOUCHED, muted: ["video", "overlay"] });
    expect(heard.segments?.[0].keys).toEqual({});
    expect(heard.overlays?.[0].keys).toEqual({ opacity });
  });

  test("leaves a Detached sound of the Source on the Music Track heard when the Video Track is muted", () => {
    const detached: CandidateChange = {
      ...draft,
      source_volume: 0.8,
      music: [{ id: "m", media: null, start: 0, secs: 2, offset: 1, volume: 1, fade_in: 0, fade_out: 0, keys: {}, detached_from: "a" }],
    };
    const heard = heardDraft(detached, { ...UNTOUCHED, muted: ["video"] });
    expect(heard.source_volume).toBe(0.8);
    expect(heard.music).toEqual(detached.music);
    expect(heard.segments?.map(({ volume }) => volume)).toEqual([0, 0]);
  });
});
