// .scratch/voiceover/issues/02-record-a-take.md: the take flow, on a Playback driven by fake videos and
// a fake clock (Seam F's harness), a fake microphone and AudioContext, and a fake upload. The mic
// button (or Shift+R) rolls the picture from the playhead with the bus silent; Stop by the button,
// Space or Shift+R uploads the Take and lands one Music Clip marked Speech, not Ducked, Picked, with
// the playhead at its start. Outside a secure context there is no button, and a hint instead.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MediaItem, MusicClip } from "../../../api";
import { Playback, playedFrom } from "../editor/playback";
import { harness } from "../editor/playbackHarness";
import { landTake } from "./actions";
import { commandsOf } from "./commands";
import type { AdvancedEdits } from "./edits";
import { resolveShortcut } from "./keymap";
import type { Pick } from "./pick";
import { TakeButton } from "./TakeButton";
import { IDLE, takeStep, TakeFlow, type TakeState } from "./takeFlow";
import { openTake, type Block, type RecorderDeps } from "./takeRecorder";
import { canRecord, TAKE_RATE } from "./voiceover";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ITEM: MediaItem = {
  id: "take-item",
  kind: "audio",
  name: "Voiceover 2026-10-20 14.03.05",
  size_bytes: 0,
  duration: 2,
  width: null,
  height: null,
  has_audio: true,
  created: "",
};

// A 10 s Clip, the playhead at 3 s, a song already on the Music Track; and the take flow on fakes. The
// microphone's first sample comes 0.12 s after the picture rolls (its start-up), on its own clock.
async function setUp(upload: (file: File) => Promise<MediaItem> = async () => ITEM) {
  const stage = harness();
  const playback = new Playback();
  playback.setSegments(playedFrom([{ start: 100, end: 110 }]));
  stage.decks(playback);
  playback.seek(3);
  stage.settle();
  playback.setLoop({ in: 5, out: 6 });

  let block: Block = () => {};
  let clock = 50;
  const asked: MediaStreamConstraints[] = [];
  const mic: RecorderDeps = {
    getUserMedia: async (constraints) => {
      asked.push(constraints);
      return { getTracks: () => [{ stop: () => {} }] } as unknown as MediaStream;
    },
    capture: async (_stream, onBlock) => {
      block = onBlock;
      return { now: () => clock, rate: TAKE_RATE, close: () => {} };
    },
  };
  // `secs` of the microphone, from `from` on its clock.
  const speak = (from: number, secs: number) => {
    for (let at = 0; at < secs * TAKE_RATE; at += 4800) block(from + at / TAKE_RATE, new Float32Array(4800).fill(0.25));
    clock = from + secs;
  };

  const song: MusicClip = { id: "song", media: "song-item", start: 0, secs: 10, offset: 0, volume: 1, fade_in: 0, fade_out: 0, keys: {}, duck: -12 };
  const world = { edits: { music: [song] } as unknown as AdvancedEdits, pick: null as Pick, undo: [] as AdvancedEdits[] };
  const silent: boolean[] = [];
  const told: string[] = [];
  const uploaded: File[] = [];
  const flow = new TakeFlow({
    open: (capped) => openTake(mic, { capped }),
    playback,
    silence: (on) => silent.push(on),
    upload: (file) => {
      uploaded.push(file);
      return upload(file);
    },
    land: (landed) => {
      const outcome = landTake({ edits: world.edits }, landed, () => "landed");
      world.undo.push(world.edits);
      world.edits = outcome.edits;
      world.pick = outcome.pick;
      return outcome.edits.music.at(-1)!.start;
    },
    tell: (text) => told.push(text),
    now: () => new Date(2026, 9, 20, 14, 3, 5),
  });
  const commands = commandsOf({ undo: () => (world.edits = world.undo.pop() ?? world.edits), redo: () => {} }, playback, null, {
    pickAll: () => {},
    pickNone: () => {},
    paste: null,
    move: null,
    split: () => {},
    freeze: () => {},
    reverse: () => {},
    mute: () => {},
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
    take: { recording: () => flow.state.phase === "recording", press: () => void flow.press() },
  });
  // A key pressed on a desktop, nothing focused, through the keymap to its command.
  const key = (keys: Parameters<typeof resolveShortcut>[0]) => commands[resolveShortcut(keys)!]();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { stage, playback, flow, world, silent, told, uploaded, asked, speak, key, settle, commands };
}

// Recorded: pressed, then 2 s spoken, the first sample 0.12 s after the roll.
async function recorded(press: (env: Awaited<ReturnType<typeof setUp>>) => unknown, env?: Awaited<ReturnType<typeof setUp>>) {
  const it = env ?? (await setUp());
  await it.flow.press();
  expect(it.flow.state.phase).toBe("recording");
  it.speak(50.12, 2);
  it.stage.advance(0.5);
  press(it);
  await it.settle();
  return it;
}

describe("recording a Take", () => {
  test("the button rolls the picture from the playhead, ignoring the Loop, with the bus silent; the input raw", async () => {
    const { flow, playback, silent, asked, stage } = await setUp();
    await flow.press();
    expect(flow.state).toMatchObject({ phase: "recording", playhead: 3, rolledAt: 50 });
    expect(playback.playing).toBe(true);
    expect(playback.loop).toBeNull();
    expect(silent).toEqual([true]);
    expect(asked[0].audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    // It plays on past the Loop's Out.
    stage.advance(3.5);
    expect(playback.time).toBeGreaterThan(6);
  });

  const lands = (it: Awaited<ReturnType<typeof setUp>>) => {
    const { world, playback, silent, uploaded, flow } = it;
    expect(flow.state).toEqual(IDLE);
    expect(silent).toEqual([true, false]);
    expect(uploaded.map((file) => [file.name, file.type])).toEqual([["Voiceover 2026-10-20 14.03.05.wav", "audio/wav"]]);
    // One Music Clip added, beside the song: of the item, where the first sample was heard against
    // the picture (3 s + 0.12 s), as long as the Take, marked Speech and not Ducked.
    expect(world.edits.music).toHaveLength(2);
    const clip = world.edits.music[1];
    expect(clip).toMatchObject({ id: "landed", media: ITEM.id, start: 3.12, secs: 2, speech: true, offset: 0, volume: 1 });
    expect(clip.duck ?? null).toBeNull();
    expect(world.pick).toEqual({ kind: "items", items: [{ kind: "music", id: "landed" }] });
    expect(playback.playing).toBe(false);
    expect(playback.time).toBe(3.12);
  };

  test("Stop by the button lands one Music Clip, Picked, the playhead at its start", async () => {
    lands(await recorded(({ flow }) => flow.press()));
  });

  test("Stop by Space lands it the same", async () => {
    lands(await recorded(({ key }) => key({ key: " " })));
  });

  test("Shift+R starts a Take, and stops it", async () => {
    const it = await setUp();
    it.key({ key: "R", shift: true });
    await it.settle();
    expect(it.flow.state.phase).toBe("recording");
    it.speak(50.12, 2);
    it.stage.advance(0.5);
    it.key({ key: "R", shift: true });
    await it.settle();
    lands(it);
  });

  test("undone, the Music Clip goes; the item stays uploaded", async () => {
    const it = await recorded(({ flow }) => flow.press());
    it.key({ key: "z", command: true });
    expect(it.world.edits.music.map((clip) => clip.id)).toEqual(["song"]);
    expect(it.uploaded).toHaveLength(1);
  });

  test("past the Clip's end the picture stops, and the Take records on", async () => {
    const it = await setUp();
    await it.flow.press();
    it.stage.advance(8);
    expect(it.playback.playing).toBe(false);
    expect(it.flow.state.phase).toBe("recording");
  });

  test("Space plays and pauses as ever when no Take records", async () => {
    const { key, playback } = await setUp();
    key({ key: " " });
    expect(playback.playing).toBe(true);
  });

  test("at eight minutes it stops itself, with a notice, and lands", async () => {
    const it = await setUp();
    await it.flow.press();
    it.speak(50, 8 * 60 + 1);
    await it.settle();
    expect(it.told).toContain("The Take stopped at eight minutes, the longest a Take can be.");
    expect(it.world.edits.music[1]).toMatchObject({ secs: 480, speech: true });
  });

  test("a microphone that can't be opened is told, and nothing rolls or changes", async () => {
    const it = await setUp();
    const flow = new TakeFlow({
      open: () => Promise.reject(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })),
      playback: it.playback,
      silence: (on) => it.silent.push(on),
      upload: async () => ITEM,
      land: () => null,
      tell: (text) => it.told.push(text),
    });
    await flow.press();
    expect(flow.state).toEqual(IDLE);
    expect(it.told).toEqual(["Couldn't open the microphone: Permission denied"]);
    expect(it.playback.playing).toBe(false);
    expect(it.silent).toEqual([]);
  });

  test("a failed upload is told and lands nothing", async () => {
    const it = await recorded(({ flow }) => flow.press(), await setUp(() => Promise.reject(new Error("The upload stopped"))));
    expect(it.flow.state).toEqual(IDLE);
    expect(it.told).toEqual(["Couldn't upload the Take: The upload stopped"]);
    expect(it.world.edits.music).toHaveLength(1);
  });
});

describe("the take flow's states", () => {
  const recordingState: TakeState = { phase: "recording", playhead: 2, rolledAt: 10, began: new Date(0) };

  test("idle → opening → recording → uploading (at its landing) → idle", () => {
    const opening = takeStep(IDLE, { type: "open" });
    expect(opening).toEqual({ phase: "opening" });
    expect(takeStep(opening, { type: "rolled", playhead: 2, at: 10, began: new Date(0) })).toEqual(recordingState);
    const uploading = takeStep(recordingState, { type: "stopped", secs: 1.5, firstSample: 10.25 });
    expect(uploading).toEqual({ phase: "uploading", landing: 2.25, secs: 1.5 });
    expect(takeStep(uploading, { type: "landed" })).toEqual(IDLE);
  });

  test("an event out of turn changes nothing; a failure goes back to idle", () => {
    expect(takeStep(IDLE, { type: "stopped", secs: 1, firstSample: 0 })).toBe(IDLE);
    expect(takeStep(recordingState, { type: "open" })).toBe(recordingState);
    expect(takeStep(recordingState, { type: "failed" })).toEqual(IDLE);
  });
});

describe("the mic button", () => {
  test("only in a secure context with a microphone", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { mediaDevices: {} });
    expect(canRecord()).toBe(true);
    vi.stubGlobal("window", { isSecureContext: false });
    expect(canRecord()).toBe(false);
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {});
    expect(canRecord()).toBe(false);
  });

  test("outside one, there is no button: a hint says to upload a voice memo and mark it Speech", () => {
    const html = renderToStaticMarkup(<TakeButton flow={null} />);
    expect(html).not.toContain("Record a Voiceover");
    expect(html).toContain("Recording a Voiceover");
    expect(html).toMatch(/record a voice memo, upload it in the Audio tab and mark its Music Clip Speech/);
  });

  test("records from idle, and reads Stop while a Take records", async () => {
    const it = await setUp();
    const idle = renderToStaticMarkup(<TakeButton flow={it.flow} />);
    expect(idle).toContain('aria-label="Record a Voiceover"');
    expect(idle).toContain('aria-keyshortcuts="Shift+R"');
    await it.flow.press();
    const live = renderToStaticMarkup(<TakeButton flow={it.flow} />);
    expect(live).toContain('aria-label="Stop the Take"');
    expect(live).toContain('aria-pressed="true"');
    expect(live).toContain("The microphone&#x27;s level");
  });
});
