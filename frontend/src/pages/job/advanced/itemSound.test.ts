// .scratch/audio-mixing/issues/12-save-sound-as-wav.md: which items "Save sound as WAV" saves (and
// why not, when the menu offers it off), the request that makes the WAV from the draft, and the name
// the browser saves it under.
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, type ClipSegment, type MediaItem, type MusicClip, type Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { LINEAR } from "../editor/keyframes";
import type { AdvancedEdits } from "./edits";
import { attachmentName, itemSound } from "./itemSound";

afterEach(() => {
  vi.unstubAllGlobals();
});

const segment = (id: string, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start: 100, end: 104, ...changes });
const music = (id: string, media: string | null): MusicClip => ({
  id,
  media,
  start: 0,
  secs: 4,
  offset: 0,
  volume: 1,
  fade_in: 0,
  fade_out: 0,
  keys: {},
});
const overlay = (id: string, media: string, changes: Partial<Overlay> = {}): Overlay => ({
  id,
  media,
  start: 0,
  secs: 2,
  offset: 0,
  transform: { x: 540, y: 400, scale: 0.5, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
  crop: NO_CROP,
  volume: 1,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
  ...changes,
});
const item = (id: string, kind: MediaItem["kind"], has_audio: boolean): MediaItem => ({
  id,
  kind,
  name: id,
  size_bytes: 1,
  duration: kind === "image" ? null : 4,
  width: kind === "audio" ? null : 320,
  height: kind === "audio" ? null : 240,
  has_audio,
  created: "",
});
const library = new Map(
  [item("clip", "video", true), item("mute-clip", "video", false), item("song", "audio", true), item("logo", "image", false)].map((media) => [media.id, media]),
);

const edits = {
  segments: [segment("s1", { muted: true }), segment("still", { start: 102, end: 102, hold: 1 }), segment("v", { media: "mute-clip" })],
  music: [music("m", "song"), music("e", null)],
  overlays: [overlay("o", "clip", { muted: true }), overlay("i", "logo"), overlay("quiet", "clip", { volume: 0 }), overlay("keyed", "clip", { volume: 0, keys: { volume: [{ at: 0, value: 1, ease: LINEAR }] } })],
} as unknown as AdvancedEdits;

describe("Save sound as WAV", () => {
  test("is offered on Segments, Music Clips and Overlays, Muted ones too, named as the notices say them", () => {
    expect(itemSound({ kind: "segment", id: "s1" }, edits, library)).toEqual({ kind: "segment", id: "s1", name: "Segment 1", silent: null });
    expect(itemSound({ kind: "music", id: "m" }, edits, library)).toMatchObject({ kind: "music", name: "song", silent: null });
    expect(itemSound({ kind: "music", id: "e" }, edits, library)).toMatchObject({ name: "the episode's sound", silent: null });
    expect(itemSound({ kind: "overlay", id: "o" }, edits, library)).toMatchObject({ kind: "overlay", name: "Overlay clip", silent: null });
    expect(itemSound({ kind: "overlay", id: "keyed" }, edits, library)?.silent).toBeNull();
  });

  test("is off, saying why, on a Freeze frame, a silent video, an image and an Overlay turned down to nothing", () => {
    expect(itemSound({ kind: "segment", id: "still" }, edits, library)?.silent).toBe("A Freeze frame is silent");
    expect(itemSound({ kind: "segment", id: "v" }, edits, library)?.silent).toBe("Its video has no sound");
    expect(itemSound({ kind: "overlay", id: "i" }, edits, library)?.silent).toBe("An image has no sound");
    expect(itemSound({ kind: "overlay", id: "quiet" }, edits, library)?.silent).toBe("Its sound is turned down to nothing");
  });

  test("isn't on a Text Layer, a Shape or an item that is gone", () => {
    expect(itemSound({ kind: "text", id: "s1" }, edits, library)).toBeNull();
    expect(itemSound({ kind: "shape", id: "m" }, edits, library)).toBeNull();
    expect(itemSound({ kind: "segment", id: "gone" }, edits, library)).toBeNull();
  });

  test("posts the draft for the item and gives the WAV with its file name", async () => {
    const fetched = vi.fn(async () => new Response(new Blob(["RIFF"]), { headers: { "Content-Disposition": "attachment; filename*=utf-8''Halo%20%E2%80%93%20Segment%201.wav" } }));
    vi.stubGlobal("fetch", fetched);
    const { wav, disposition } = await api.saveSound("job", "c1", "segment", "s 1", { source_volume: 0.5 });
    expect(fetched).toHaveBeenCalledWith("/api/jobs/job/candidates/c1/sound/segment/s%201", expect.objectContaining({ method: "POST", body: '{"source_volume":0.5}' }));
    expect(await wav.text()).toBe("RIFF");
    expect(attachmentName(disposition)).toBe("Halo – Segment 1.wav");
  });

  test("says the backend's refusal", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: "Segment 2 is a Freeze frame, which is silent" }), { status: 422 }));
    await expect(api.saveSound("job", "c1", "segment", "still", {})).rejects.toThrow("Segment 2 is a Freeze frame, which is silent");
  });

  test("reads the plain file name too, and none from no header", () => {
    expect(attachmentName('attachment; filename="clip - song.wav"')).toBe("clip - song.wav");
    expect(attachmentName("attachment; filename=clip.wav")).toBe("clip.wav");
    expect(attachmentName(null)).toBeNull();
  });
});
