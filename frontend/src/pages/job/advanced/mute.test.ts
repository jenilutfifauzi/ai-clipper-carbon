// .scratch/audio-mixing/issues/03-mute-in-the-advanced-edit.md: M on the Pick (toggleMute), one change
// each time; the items without sound it leaves alone; its key; and a new video Overlay made Muted at
// full volume.
import { describe, expect, test, vi } from "vitest";
import type { ClipSegment, Ease, MediaItem, MusicClip, Overlay, Shape, TextLayer } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { BLURRED, IDENTITY } from "../editor/picture";
import { Playback, playedFrom } from "../editor/playback";
import { toggleMute } from "./actions";
import { commandsOf } from "./commands";
import type { AdvancedEdits } from "./edits";
import { resolveShortcut, shortcutSheet } from "./keymap";
import { newOverlay } from "./Overlays";
import { picked, type ItemRef } from "./pick";

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const video = (id: string, media: string, changes: Partial<ClipSegment> = {}): ClipSegment =>
  segment(id, 0, 4, { media, framing: { transform: IDENTITY, crop: NO_CROP, background: BLURRED }, volume: 1, ...changes });
const held = (id: string, at: number): ClipSegment => segment(id, at, at, { hold: 1 });
const music = (id: string, changes: Partial<MusicClip> = {}): MusicClip => ({
  id,
  media: "song",
  start: 0,
  secs: 4,
  offset: 0,
  volume: 0.8,
  fade_in: 0,
  fade_out: 0,
  keys: {},
  ...changes,
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
const layer = (id: string) => ({ id, start: 0, secs: 2, text: id }) as unknown as TextLayer;
const shape = (id: string) => ({ id, start: 0, secs: 2 }) as unknown as Shape;

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    preset_id: "default",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    cue_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [],
    shapes: [],
    music: [],
    source_volume: 1,
    segments: [segment("s1", 100, 110)],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

// The Media Library's items with sound: "clip" and "song" have it; "mute-clip" (a video without) and
// "logo" (an image) don't.
const sounded = (media: string) => media === "clip" || media === "song";
const ref = (kind: ItemRef["kind"], id: string) => ({ kind, id });

describe("M on the Pick", () => {
  test("a heard Segment and a Muted Music Clip are both Muted, then both unmuted, each one change; the Pick stays", () => {
    const before = edits({ segments: [segment("s1", 100, 110), segment("s2", 120, 125)], music: [music("m", { muted: true })] });
    const pick = picked(ref("segment", "s1"), ref("music", "m"));

    const muted = toggleMute({ edits: before, pick }, sounded);
    expect(muted).toEqual({
      edits: { ...before, segments: [segment("s1", 100, 110, { muted: true }), segment("s2", 120, 125)], music: [music("m", { muted: true })] },
      pick,
    });

    const unmuted = toggleMute({ edits: muted!.edits, pick }, sounded);
    expect(unmuted).toEqual({
      edits: { ...before, segments: [segment("s1", 100, 110, { muted: false }), segment("s2", 120, 125)], music: [music("m", { muted: false })] },
      pick,
    });
  });

  test("they keep their volume, Keyframes and fades", () => {
    const linear: Ease = [0, 0, 1, 1];
    const keys = { volume: [{ at: 0, value: 0.5, ease: linear }, { at: 2, value: 1.5, ease: linear }] };
    const before = edits({ music: [music("m", { volume: 1.4, keys, fade_in: 1, fade_out: 0.5 })] });

    expect(toggleMute({ edits: before, pick: picked(ref("music", "m")) }, sounded)?.edits.music).toEqual([
      music("m", { volume: 1.4, keys, fade_in: 1, fade_out: 0.5, muted: true }),
    ]);
  });

  test("a video Overlay and a video's Segment with sound are Muted too", () => {
    const before = edits({ segments: [segment("s1", 100, 110), video("v", "clip")], overlays: [overlay("o", "clip")] });

    const after = toggleMute({ edits: before, pick: picked(ref("segment", "v"), ref("overlay", "o")) }, sounded)!.edits;
    expect(after.segments).toEqual([segment("s1", 100, 110), video("v", "clip", { muted: true })]);
    expect(after.overlays).toEqual([overlay("o", "clip", { muted: true })]);
  });

  test("Text Layers, Shapes, images, Freeze frames and videos without sound are left alone", () => {
    const before = edits({
      segments: [segment("s1", 100, 110), held("f", 104), video("quiet", "mute-clip")],
      text_layers: [layer("t")],
      shapes: [shape("sh")],
      overlays: [overlay("img", "logo", { volume: 0 }), overlay("o", "clip")],
    });
    const pick = picked(ref("text", "t"), ref("shape", "sh"), ref("segment", "f"), ref("segment", "quiet"), ref("overlay", "img"), ref("overlay", "o"));

    const after = toggleMute({ edits: before, pick }, sounded)!.edits;
    expect(after).toEqual({ ...before, overlays: [overlay("img", "logo", { volume: 0 }), overlay("o", "clip", { muted: true })] });
  });

  test("one heard item among Muted ones Mutes them all: only when every one is Muted does M unmute", () => {
    const before = edits({
      segments: [segment("s1", 100, 110, { muted: true })],
      music: [music("m", { muted: true }), music("n")],
    });
    const pick = picked(ref("segment", "s1"), ref("music", "m"), ref("music", "n"));

    const after = toggleMute({ edits: before, pick }, sounded)!.edits;
    expect(after.segments[0].muted).toBe(true);
    expect(after.music.map((clip) => clip.muted)).toEqual([true, true]);
  });

  test("an unmuted Freeze frame or image doesn't count as heard: only what has sound decides", () => {
    const before = edits({ segments: [segment("s1", 100, 110), held("f", 104)], overlays: [overlay("img", "logo")], music: [music("m", { muted: true })] });

    const after = toggleMute({ edits: before, pick: picked(ref("segment", "f"), ref("overlay", "img"), ref("music", "m")) }, sounded)!.edits;
    expect(after).toEqual({ ...before, music: [music("m", { muted: false })] });
  });

  test("a Pick of only a Text Layer and a Shape changes nothing and makes no change to undo", () => {
    const before = edits({ text_layers: [layer("t")], shapes: [shape("sh")] });

    expect(toggleMute({ edits: before, pick: picked(ref("text", "t"), ref("shape", "sh")) }, sounded)).toBeNull();
  });

  test("the hook, the captions, a join or nothing picked: nothing", () => {
    const before = edits();
    for (const pick of [{ kind: "hook" } as const, { kind: "captions" } as const, { kind: "join", after: "s1" } as const, null]) {
      expect(toggleMute({ edits: before, pick }, sounded)).toBeNull();
    }
  });
});

describe("its key", () => {
  test("M mutes, in either case; with Cmd or Ctrl, or typing, it gives nothing", () => {
    expect(resolveShortcut({ key: "m" })).toBe("mute");
    expect(resolveShortcut({ key: "M" })).toBe("mute");
    expect(resolveShortcut({ key: "m", command: true })).toBeNull();
    expect(resolveShortcut({ key: "m" }, { typing: true })).toBeNull();
  });

  test("the shortcuts sheet lists it under Editing", () => {
    const editing = shortcutSheet().find((group) => group.group === "editing")!;
    expect(editing.shortcuts.map((shortcut) => shortcut.id)).toContain("mute");
  });

  test("the command runs the Pick's mute, and is left to the browser when it can't", () => {
    const playback = new Playback();
    playback.setSegments(playedFrom([{ start: 100, end: 110 }]));
    const mute = vi.fn(() => false);
    const commands = commandsOf({ undo: () => {}, redo: () => {} }, playback, null, {
      pickAll: () => {},
      pickNone: () => {},
      paste: null,
      move: null,
      split: () => {},
      freeze: () => {},
      reverse: () => {},
      mute,
      fit: () => {},
      zoom: () => {},
      shortcuts: () => {},
      editPoints: [],
      markIn: () => {},
      markOut: () => {},
      loop: () => {},
      clearMarks: () => {},
      fps: 30,
      setFullscreen: () => {},
      toggleAssets: () => {},
      toggleInspector: () => {},
      keyframes: null,
    });
    expect(commands.mute()).toBe(false);
    expect(mute).toHaveBeenCalledTimes(1);
  });
});

describe("a new video Overlay", () => {
  const item = (changes: Partial<MediaItem>): MediaItem => ({
    id: "clip",
    kind: "video",
    name: "Clip",
    size_bytes: 1,
    duration: 4,
    width: 1920,
    height: 1080,
    has_audio: true,
    created: "2026-10-18T00:00:00Z",
    ...changes,
  });

  test("is made at full volume and Muted, so that unmuting it gives its sound at once", () => {
    const made = newOverlay(item({}), 0, 10);
    expect(made.volume).toBe(1);
    expect(made.muted).toBe(true);
  });

  test("an image's is as before: volume 0, not Muted", () => {
    const made = newOverlay(item({ id: "logo", kind: "image", duration: null, has_audio: false }), 0, 10);
    expect(made.volume).toBe(0);
    expect(made.muted).toBeUndefined();
  });
});
