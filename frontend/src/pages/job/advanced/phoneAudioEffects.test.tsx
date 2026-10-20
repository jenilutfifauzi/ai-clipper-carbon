// .scratch/audio-effects/issues/07-audio-effects-on-a-phone.md: Audio Effects on a phone (ADR 0017).
// The toolbar's Audio effects for a picked item with sound (a Segment, a Music Clip, a video Overlay;
// not a Freeze frame or an image), and its sheet: the desktop section's controls, each action one
// step of undo, every control a finger's size.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AudioEffect, AudioEffectKind, ClipSegment, MusicClip, Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { IDENTITY } from "../editor/picture";
import { Playback, playedFrom } from "../editor/playback";
import { freezer, splitter, type PickContext } from "./actions";
import { audioEffectChanges, AudioEffectsFields } from "./AudioEffectsFields";
import { Toolbar } from "./Chrome";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import { stepped, undone, type Steps } from "./useEditHistory";

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const music = (id: string): MusicClip => ({ id, media: "song", start: 0, secs: 4, offset: 0, volume: 1, fade_in: 0, fade_out: 0, keys: {} });
const overlay = (id: string, media: string): Overlay => ({
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
});

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
    music: [music("m1")],
    source_volume: 1,
    segments: [segment("s1", 100, 106), segment("f", 103, 103, { hold: 1 })],
    overlays: [overlay("o1", "clip"), overlay("still", "png")],
    transitions: [],
    ...changes,
  };
}

function scene(state: AdvancedEdits, pick: Pick = null): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, magnetic: true };
}

// A video with sound ("clip") and a song; the image ("png") has none.
const sounded = (media: string) => media === "clip" || media === "song";
const seg = (id: string) => ({ kind: "segment", id }) as const;
const over = (id: string) => ({ kind: "overlay", id }) as const;

const setting = (key: string, intensity: boolean) => ({ key, label: key, min: 0, max: 100, default: 50, step: 1, unit: "%", intensity });
const KINDS: AudioEffectKind[] = [
  { id: "denoise", name: "Reduce noise", group: "Clean", order: 0, description: "", settings: [setting("strength", true)] },
  { id: "enhance-voice", name: "Enhance voice", group: "Clean", order: 1, description: "", settings: [setting("amount", true)] },
  { id: "normalize", name: "Normalize loudness", group: "Clean", order: 2, description: "", settings: [setting("target", true)] },
  { id: "radio", name: "Radio", group: "Voice", order: 0, description: "Thin and boxy", settings: [setting("amount", true), setting("drive", false)] },
  { id: "echo", name: "Echo", group: "Space", order: 0, description: "", settings: [setting("mix", true)] },
];
const kind = (id: string) => KINDS.find((each) => each.id === id)!;

// The Advanced Edit's history as the sheet changes it: each `set` its own step.
function workspace(start: AdvancedEdits) {
  let history: Steps<AdvancedEdits> = { past: [], value: start, future: [] };
  return {
    now: () => history.value,
    steps: () => history.past.length,
    undo: () => {
      history = undone(history)!;
    },
    onEdits: (next: AdvancedEdits) => {
      history = stepped(history, next, false);
    },
  };
}

describe("Audio effects in the phone's toolbar", () => {
  const state = edits();
  const shown = (pick: Pick) => audioEffectChanges({ edits: state, pick }, sounded, () => {}) !== null;

  test("is there for a Segment with sound, a Music Clip and a video Overlay", () => {
    expect(shown(picked(seg("s1")))).toBe(true);
    expect(shown(picked({ kind: "music", id: "m1" }))).toBe(true);
    expect(shown(picked(over("o1")))).toBe(true);
  });

  test("isn't there for a Freeze frame, an image Overlay or nothing picked", () => {
    expect(shown(picked(seg("f")))).toBe(false);
    expect(shown(picked(over("still")))).toBe(false);
    expect(shown(null)).toBe(false);
  });

  const toolbar = (onAudioEffects: (() => void) | null) =>
    renderToStaticMarkup(
      <Toolbar
        pick={picked(seg("s1"))}
        actions={null}
        splitter={splitter(scene(state, picked(seg("s1"))), () => 0, () => {})}
        freezer={freezer(scene(state, picked(seg("s1"))), () => 0, () => {})}
        playback={new Playback()}
        picking={false}
        paste={null}
        mute={null}
        onAsset={() => {}}
        onInspect={() => {}}
        onTransform={() => {}}
        onSpeed={null}
        onAudioEffects={onAudioEffects}
        onTracks={() => {}}
        onPlayback={() => {}}
        onPicking={() => {}}
        onDeselect={() => {}}
      />,
    );

  test("is a tool button, a finger's size, while the Pick has sound", () => {
    expect(toolbar(() => {})).toMatch(/<button type="button" class="[^"]*min-h-14 min-w-16[^"]*"><svg[^>]*>.*?<\/svg>Audio effects<\/button>/);
    expect(toolbar(null)).not.toContain("Audio effects");
  });
});

describe("the Audio effects sheet", () => {
  const radio: AudioEffect = { id: "radio", params: { amount: 50, drive: 50 }, enabled: true };
  const echo: AudioEffect = { id: "echo", params: { mix: 50 }, enabled: true };
  const pick = picked(seg("s1"));
  // The sheet's controls as the phone's sheet draws them from the Advanced Edit's edits now.
  const controls = (space: ReturnType<typeof workspace>) => audioEffectChanges({ edits: space.now(), pick }, sounded, space.onEdits)!;

  test("switches on Enhance voice, adds Radio, reorders and removes, each one step of undo", () => {
    const space = workspace(edits());
    controls(space).onClean(kind("enhance-voice"), true);
    expect(space.now().segments[0].audio_effects?.map((entry) => entry.id)).toEqual(["enhance-voice"]);
    controls(space).onAdd(kind("radio"));
    controls(space).onAdd(kind("echo"));
    expect(space.now().segments[0].audio_effects?.map((entry) => entry.id)).toEqual(["enhance-voice", "radio", "echo"]);
    controls(space).onMove(2, -1);
    expect(space.now().segments[0].audio_effects?.map((entry) => entry.id)).toEqual(["enhance-voice", "echo", "radio"]);
    controls(space).onEnabled(2, false);
    expect(space.now().segments[0].audio_effects?.[2].enabled).toBe(false);
    controls(space).onRemove(1);
    expect(space.now().segments[0].audio_effects?.map((entry) => entry.id)).toEqual(["enhance-voice", "radio"]);
    expect(space.steps()).toBe(6);
    space.undo();
    expect(space.now().segments[0].audio_effects?.map((entry) => entry.id)).toEqual(["enhance-voice", "echo", "radio"]);
  });

  test("has every control a finger's size", () => {
    const state = edits({ segments: [segment("s1", 100, 106, { audio_effects: [{ id: "enhance-voice", params: { amount: 50 }, enabled: true }, radio, echo] })] });
    const markup = renderToStaticMarkup(
      <div data-sheet="">
        <AudioEffectsFields {...audioEffectChanges({ edits: state, pick }, sounded, () => {})!} kinds={KINDS} />
      </div>,
    );
    const controls = [...markup.matchAll(/<(button|input)\b[^>]*>/g)].map((match) => match[0]);
    // Add effect, the library's search and its two effects; three switches, the rows' switches, More,
    // up, down and remove; and the sliders.
    expect(controls.length).toBeGreaterThan(15);
    for (const tag of controls.filter((tag) => !tag.includes('role="switch"'))) expect(tag).toMatch(/min-h-11|in-data-sheet:h-11|in-data-sheet:min-h-11/);
    // A switch is a hidden checkbox: its label is what a finger taps.
    const switches = [...markup.matchAll(/<label class="[^"]*"><input type="checkbox" role="switch"/g)];
    expect(switches).toHaveLength(5);
    for (const [tag] of switches) expect(tag).toContain("in-data-sheet:min-h-11");
  });

  test("names itself once: the sheet's title, not the section's heading too", () => {
    const markup = renderToStaticMarkup(<AudioEffectsFields {...audioEffectChanges({ edits: edits(), pick }, sounded, () => {})!} kinds={KINDS} />);
    expect(markup).toMatch(/<h3[^>]*class="[^"]*in-data-sheet:sr-only[^"]*"[^>]*>Audio effects<\/h3>/);
  });
});
