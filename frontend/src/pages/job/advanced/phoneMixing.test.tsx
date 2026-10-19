// .scratch/audio-mixing/issues/14-phone.md: mixing on a phone. The toolbar's Mute, by M's rule and
// off when the Pick has no sound; and Save sound as WAV in the picked item's sheet.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ClipSegment, MediaItem, MusicClip, Overlay, TextLayer } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { IDENTITY } from "../editor/picture";
import { Playback, playedFrom } from "../editor/playback";
import { freezer, muter, splitter, toggleMute, type Muter, type Outcome, type PickContext } from "./actions";
import { Toolbar } from "./Chrome";
import type { AdvancedEdits } from "./edits";
import { sheetSound } from "./itemSound";
import { picked, type ItemRef, type Pick } from "./pick";

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
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
  transform: IDENTITY,
  crop: NO_CROP,
  volume: 1,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
  ...changes,
});
const layer = (id: string) => ({ id, start: 0, secs: 2, text: id }) as unknown as TextLayer;

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [layer("t")],
    shapes: [],
    music: [music("m")],
    source_volume: 1,
    segments: [segment("s1", 100, 106), segment("f", 103, 103, { hold: 1 })],
    overlays: [overlay("o", "clip"), overlay("logo", "logo", { volume: 0 })],
    transitions: [],
    ...changes,
  };
}

function scene(state: AdvancedEdits, pick: Pick = null): PickContext {
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => "n", magnetic: true };
}

const ref = (kind: ItemRef["kind"], id: string) => ({ kind, id });
// "clip" and "song" have sound; "logo" is an image.
const sounded = (media: string) => media === "clip" || media === "song";

describe("Mute in the phone's toolbar", () => {
  function tool(state: AdvancedEdits, pick: Pick) {
    const outcomes: Outcome[] = [];
    return { mute: muter(scene(state, pick), sounded, (outcome) => outcomes.push(outcome)), outcomes };
  }

  test("is there for a Pick with sound: Mute while any is heard, Unmute once all are Muted", () => {
    const state = edits({ music: [music("m", { muted: true })] });
    expect(tool(state, picked(ref("segment", "s1"), ref("music", "m"))).mute?.muted).toBe(false);
    expect(tool(state, picked(ref("music", "m"))).mute?.muted).toBe(true);
    expect(tool(state, picked(ref("overlay", "o"))).mute?.muted).toBe(false);
  });

  test("is off for a Pick without sound: a Text Layer, a Freeze frame, an image or nothing", () => {
    const state = edits();
    expect(tool(state, picked(ref("text", "t"))).mute).toBeNull();
    expect(tool(state, picked(ref("segment", "f"), ref("overlay", "logo"))).mute).toBeNull();
    expect(tool(state, null).mute).toBeNull();
  });

  test("toggles the Pick by M's rule, as one change each time", () => {
    const state = edits({ music: [music("m", { muted: true })] });
    const pick = picked(ref("segment", "s1"), ref("music", "m"), ref("text", "t"));
    const once = tool(state, pick);
    once.mute!.toggle();
    expect(once.outcomes).toEqual([toggleMute({ edits: state, pick }, sounded)]);
    const muted = once.outcomes[0].edits;
    expect(muted.segments[0].muted).toBe(true);
    expect(muted.music[0].muted).toBe(true);

    const twice = tool(muted, pick);
    expect(twice.mute!.muted).toBe(true);
    twice.mute!.toggle();
    expect(twice.outcomes).toHaveLength(1);
    expect(twice.outcomes[0].edits.segments[0].muted).toBe(false);
    expect(twice.outcomes[0].edits.music[0].muted).toBe(false);
  });

  // Rendered without item actions: Split and Freeze frame follow the playhead, which a page without a
  // browser can't subscribe to.
  const toolbar = (mute: Muter | null, picking = false) => {
    const state = edits();
    return renderToStaticMarkup(
      <Toolbar
        pick={picked(ref("segment", "s1"))}
        actions={null}
        splitter={splitter(scene(state), () => 0, () => {})}
        freezer={freezer(scene(state), () => 0, () => {})}
        playback={new Playback()}
        picking={picking}
        paste={null}
        mute={mute}
        onAsset={() => {}}
        onInspect={() => {}}
        onTransform={() => {}}
        onSpeed={null}
        onTracks={() => {}}
        onPlayback={() => {}}
        onPicking={() => {}}
        onDeselect={() => {}}
      />,
    );
  };
  const button = (label: string) => new RegExp(`<button type="button"( disabled="")? class="[^"]*min-h-14 min-w-16[^"]*"><svg[^>]*>.*?</svg>${label}</button>`);

  test("is a tool button, a finger's size, in the bar of a Pick and of picking several", () => {
    for (const picking of [false, true]) {
      const markup = toolbar({ muted: false, toggle: () => {} }, picking);
      expect(markup).toMatch(button("Mute"));
      expect(markup).not.toMatch(/disabled=""[^>]*><svg[^>]*>.*?<\/svg>Mute</);
    }
    expect(toolbar({ muted: true, toggle: () => {} })).toMatch(button("Unmute"));
  });

  test("is shown off when the Pick has no sound", () => {
    expect(toolbar(null)).toMatch(/<button type="button" disabled="" class="[^"]*"><svg[^>]*>.*?<\/svg>Mute<\/button>/);
  });
});

describe("Save sound as WAV in the item's sheet", () => {
  const media = new Map<string, MediaItem>([
    ["clip", { id: "clip", kind: "video", has_audio: true, name: "clip" } as MediaItem],
    ["song", { id: "song", kind: "audio", has_audio: true, name: "Song" } as MediaItem],
    ["logo", { id: "logo", kind: "image", name: "logo" } as MediaItem],
  ]);
  const state = edits();

  test("is the sound of the one picked Segment, Music Clip or Overlay", () => {
    expect(sheetSound(picked(ref("segment", "s1")), state, media, true)).toMatchObject({ kind: "segment", id: "s1", silent: null });
    expect(sheetSound(picked(ref("music", "m")), state, media, true)).toMatchObject({ kind: "music", name: "Song" });
    expect(sheetSound(picked(ref("overlay", "o")), state, media, true)).toMatchObject({ kind: "overlay", silent: null });
  });

  test("says why a silent item has none", () => {
    expect(sheetSound(picked(ref("segment", "f")), state, media, true)?.silent).toBe("A Freeze frame is silent");
    expect(sheetSound(picked(ref("overlay", "logo")), state, media, true)?.silent).toBe("An image has no sound");
  });

  test("is not offered for a Text Layer, several items, nothing, or where the browser can't download", () => {
    expect(sheetSound(picked(ref("text", "t")), state, media, true)).toBeNull();
    expect(sheetSound(picked(ref("segment", "s1"), ref("music", "m")), state, media, true)).toBeNull();
    expect(sheetSound(null, state, media, true)).toBeNull();
    expect(sheetSound(picked(ref("segment", "s1")), state, media, false)).toBeNull();
  });
});
