// .scratch/voiceover/issues/02-record-a-take.md: the take flow, on a Playback driven by fake videos and
// a fake clock (Seam F's harness), a fake microphone and AudioContext, and a fake upload. The mic
// button (or Shift+R) rolls the picture from the playhead with the bus silent; Stop by the button,
// Space or Shift+R uploads the Take and lands one Music Clip marked Speech, not Ducked, Picked, with
// the playhead at its start. Outside a secure context there is no button, and a hint instead.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MediaItem, MusicClip } from "../../../api";
import { Playback, playedFrom } from "../editor/playback";
import { harness } from "../editor/playbackHarness";
import { landTake } from "./actions";
import { commandsOf } from "./commands";
import type { AdvancedEdits } from "./edits";
import { resolveShortcut } from "./keymap";
import type { Pick } from "./pick";
import { AT_END_HINT, TakeButton, WaitingTakeNotice } from "./TakeButton";
import {
  asksBeforeLeaving,
  guardLeaving,
  IDLE,
  locksEditing,
  MIC_BUSY,
  MIC_MISSING,
  MIC_REFUSED,
  microphoneTrouble,
  TAKE_WAITING,
  takeStep,
  TakeFlow,
  type TakeState,
} from "./takeFlow";
import { lockedWhile } from "./useEditHistory";
import { openTake, type Block, type RecorderDeps } from "./takeRecorder";
import { atClipEnd, canRecord, TAKE_RATE } from "./voiceover";

// The countdown's seconds on fake timers; the playback's clock is the harness's own.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
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
  const closed: string[] = [];
  const mic: RecorderDeps = {
    getUserMedia: async (constraints) => {
      asked.push(constraints);
      return { getTracks: () => [{ stop: () => closed.push("track") }] } as unknown as MediaStream;
    },
    capture: async (_stream, onBlock) => {
      block = onBlock;
      return { now: () => clock, rate: TAKE_RATE, close: () => closed.push("capture") };
    },
  };
  // `secs` of the microphone, from `from` on its clock.
  const speak = (from: number, secs: number) => {
    for (let at = 0; at < secs * TAKE_RATE; at += 4800) block(from + at / TAKE_RATE, new Float32Array(4800).fill(0.25));
    clock = from + secs;
  };

  const song: MusicClip = { id: "song", media: "song-item", start: 0, secs: 10, offset: 0, volume: 1, fade_in: 0, fade_out: 0, keys: {}, duck: -12 };
  const world = { edits: { music: [song] } as unknown as AdvancedEdits, pick: null as Pick, undo: [] as AdvancedEdits[], musicLocked: false };
  const saved: { blob: Blob; name: string }[] = [];
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
      if (world.musicLocked) return null;
      const outcome = landTake({ edits: world.edits }, landed, () => "landed");
      world.undo.push(world.edits);
      world.edits = outcome.edits;
      world.pick = outcome.pick;
      return outcome.edits.music.at(-1)!.start;
    },
    tell: (text) => told.push(text),
    save: (blob, name) => void saved.push({ blob, name }),
    now: () => new Date(2026, 9, 20, 14, 3, 5),
    atEnd: () => atClipEnd(playback.time, playback.duration, 30),
  });
  const picked: string[] = [];
  const split: string[] = [];
  const commands = commandsOf({ undo: () => (world.edits = world.undo.pop() ?? world.edits), redo: () => {} }, playback, null, {
    pickAll: () => {},
    pickNone: () => void picked.push("none"),
    paste: null,
    move: null,
    split: () => void split.push("split"),
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
    take: { state: () => flow.state, press: () => void flow.press(), cancel: () => flow.cancel() },
  });
  // A key pressed on a desktop, nothing focused, through the keymap to its command.
  const key = (keys: Parameters<typeof resolveShortcut>[0]) => commands[resolveShortcut(keys)!]();
  const settle = () => vi.advanceTimersByTimeAsync(0);
  // Pressed, and the countdown run out: the picture rolls.
  const roll = async () => {
    await flow.press();
    vi.advanceTimersByTime(3000);
  };
  return { stage, playback, flow, world, silent, told, uploaded, saved, asked, closed, picked, split, speak, key, settle, roll, commands };
}

// Recorded: pressed, then 2 s spoken, the first sample 0.12 s after the roll.
async function recorded(press: (env: Awaited<ReturnType<typeof setUp>>) => unknown, env?: Awaited<ReturnType<typeof setUp>>) {
  const it = env ?? (await setUp());
  await it.roll();
  expect(it.flow.state.phase).toBe("recording");
  it.speak(50.12, 2);
  it.stage.advance(0.5);
  press(it);
  await it.settle();
  return it;
}

describe("recording a Take", () => {
  test("the button rolls the picture from the playhead, ignoring the Loop, with the bus silent; the input raw", async () => {
    const { flow, playback, silent, asked, stage, roll } = await setUp();
    await roll();
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
    expect(it.flow.state.phase).toBe("countdown");
    vi.advanceTimersByTime(3000);
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
    await it.roll();
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
    await it.roll();
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
    expect(it.told).toEqual([MIC_REFUSED]);
    expect(it.playback.playing).toBe(false);
    expect(it.silent).toEqual([]);
  });
});

// .scratch/voiceover/issues/05-when-recording-fails.md: a broken microphone explained, and a Take
// that fails to upload (or to land) kept in the tab, with Try again and Save WAV.
describe("when the microphone fails", () => {
  // The take flow on a microphone that rejects with `name`.
  async function failing(name: string) {
    const it = await setUp();
    let uploads = 0;
    let lands = 0;
    const flow = new TakeFlow({
      open: () => Promise.reject(Object.assign(new Error("browser words"), { name })),
      playback: it.playback,
      silence: (on) => it.silent.push(on),
      upload: async () => (uploads++, ITEM),
      land: () => (lands++, 0),
      tell: (text) => it.told.push(text),
    });
    await flow.press();
    return { flow, told: it.told, uploads, lands, playing: it.playback.playing };
  }

  test("refused, missing and busy inputs each say what is wrong and how to fix it, and add nothing", async () => {
    const said = new Map<string, string>();
    for (const name of ["NotAllowedError", "SecurityError", "NotFoundError", "OverconstrainedError", "NotReadableError", "AbortError"]) {
      const { flow, told, uploads, lands, playing } = await failing(name);
      expect(flow.state).toEqual(IDLE);
      expect(locksEditing(flow.state)).toBe(false);
      expect([uploads, lands, playing]).toEqual([0, 0, false]);
      expect(told).toHaveLength(1);
      said.set(name, told[0]);
    }
    expect(said.get("NotAllowedError")).toBe(MIC_REFUSED);
    expect(said.get("SecurityError")).toBe(MIC_REFUSED);
    expect(MIC_REFUSED).toMatch(/site settings/);
    expect(said.get("NotFoundError")).toBe(MIC_MISSING);
    expect(said.get("OverconstrainedError")).toBe(MIC_MISSING);
    expect(MIC_MISSING).toMatch(/[Pp]lug one in/);
    expect(said.get("NotReadableError")).toBe(MIC_BUSY);
    expect(said.get("AbortError")).toBe(MIC_BUSY);
    expect(MIC_BUSY).toMatch(/other app/);
    expect(new Set([MIC_REFUSED, MIC_MISSING, MIC_BUSY]).size).toBe(3);
  });

  test("anything else is told with the browser's words", async () => {
    expect(microphoneTrouble(Object.assign(new Error("odd"), { name: "TypeError" }))).toBe("Couldn't open the microphone: odd");
    const { told } = await failing("TypeError");
    expect(told).toEqual(["Couldn't open the microphone: browser words"]);
  });
});

describe("when the upload fails", () => {
  // A Take recorded on an upload that fails `fails` times, then answers.
  async function failedTake(fails = 1) {
    let left = fails;
    const env = await setUp(async () => {
      if (left-- > 0) throw new Error("The upload stopped");
      return ITEM;
    });
    return recorded(({ flow }) => flow.press(), env);
  }

  test("the Take is kept, with what went wrong; nothing lands and editing isn't locked", async () => {
    const it = await failedTake();
    const state = it.flow.state;
    expect(state.phase).toBe("failed");
    if (state.phase !== "failed") return;
    expect(state.why).toBe("Couldn't upload the Take: The upload stopped");
    expect(state.take).toMatchObject({ name: "Voiceover 2026-10-20 14.03.05.wav", media: null });
    expect(state.take.landing).toBeCloseTo(3.12);
    expect(state.take.secs).toBeCloseTo(2);
    expect(state.take.wav.byteLength).toBe(44 + 2 * 2 * TAKE_RATE);
    expect(it.world.edits.music).toHaveLength(1);
    expect(locksEditing(state)).toBe(false);
  });

  test("its notice offers Try again, Save WAV and Discard", async () => {
    const it = await failedTake();
    const html = renderToStaticMarkup(<WaitingTakeNotice flow={it.flow} />);
    expect(html).toContain("Couldn&#x27;t upload the Take: The upload stopped");
    expect(html).toContain("Try again");
    expect(html).toContain("Save WAV");
    expect(html).toContain('aria-label="Discard the Take"');
    expect(renderToStaticMarkup(<WaitingTakeNotice flow={(await setUp()).flow} />)).toBe("");
  });

  test("Try again uploads it again and lands it at its recorded landing, Picked, the playhead at its start", async () => {
    const it = await failedTake();
    // Moved meanwhile: the Take still lands where it was recorded.
    it.playback.seek(7);
    await it.flow.retry();
    expect(it.uploaded).toHaveLength(2);
    expect(it.uploaded[1].name).toBe("Voiceover 2026-10-20 14.03.05.wav");
    expect(it.flow.state).toEqual(IDLE);
    expect(it.world.edits.music).toHaveLength(2);
    expect(it.world.edits.music[1]).toMatchObject({ media: "take-item", start: 3.12, speech: true, duck: null });
    expect(it.world.pick).toEqual({ kind: "items", items: [{ kind: "music", id: "landed" }] });
    expect(it.playback.time).toBeCloseTo(3.12);
  });

  test("failing again, it is kept again", async () => {
    const it = await failedTake(2);
    await it.flow.retry();
    expect(it.flow.state.phase).toBe("failed");
    await it.flow.retry();
    expect(it.flow.state).toEqual(IDLE);
    expect(it.world.edits.music).toHaveLength(2);
  });

  test("Save WAV downloads the Take under its name, and keeps it waiting", async () => {
    const it = await failedTake();
    it.flow.save();
    expect(it.saved).toHaveLength(1);
    expect(it.saved[0].name).toBe("Voiceover 2026-10-20 14.03.05.wav");
    expect(it.saved[0].blob.type).toBe("audio/wav");
    const bytes = new Uint8Array(await it.saved[0].blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(bytes.byteLength).toBe(44 + 2 * 2 * TAKE_RATE);
    expect(it.flow.state.phase).toBe("failed");
  });

  test("Discard lets it go", async () => {
    const it = await failedTake();
    it.flow.discard();
    expect(it.flow.state).toEqual(IDLE);
    it.flow.save();
    expect(it.saved).toEqual([]);
  });

  test("Record while a Take waits refuses, and says to save or discard it first", async () => {
    const it = await failedTake();
    await it.flow.press();
    expect(it.flow.state.phase).toBe("failed");
    expect(it.told.at(-1)).toBe(TAKE_WAITING);
    expect(it.asked).toHaveLength(1);
  });

  test("a land refused (the Music Track locked) keeps the uploaded Take; Try again only lands it", async () => {
    const env = await setUp();
    env.world.musicLocked = true;
    const it = await recorded(({ flow }) => flow.press(), env);
    const state = it.flow.state;
    expect(state.phase).toBe("failed");
    if (state.phase !== "failed") return;
    expect(state.take.media).toBe("take-item");
    expect(it.world.edits.music).toHaveLength(1);
    // Still locked: kept again, not uploaded again.
    await it.flow.retry();
    expect(it.flow.state.phase).toBe("failed");
    it.world.musicLocked = false;
    await it.flow.retry();
    expect(it.uploaded).toHaveLength(1);
    expect(it.flow.state).toEqual(IDLE);
    expect(it.world.edits.music[1]).toMatchObject({ media: "take-item", start: 3.12, speech: true });
  });
});

describe("the take flow's states", () => {
  const recordingState: TakeState = { phase: "recording", playhead: 2, rolledAt: 10, began: new Date(0) };

  test("idle → opening → countdown 3, 2, 1 → recording → uploading (at its landing) → idle", () => {
    const opening = takeStep(IDLE, { type: "open" });
    expect(opening).toEqual({ phase: "opening" });
    // It rolls only from the countdown.
    expect(takeStep(opening, { type: "rolled", playhead: 2, at: 10, began: new Date(0) })).toBe(opening);
    const three = takeStep(opening, { type: "opened" });
    expect(three).toEqual({ phase: "countdown", left: 3 });
    const one = takeStep(takeStep(three, { type: "tick" }), { type: "tick" });
    expect(one).toEqual({ phase: "countdown", left: 1 });
    expect(takeStep(one, { type: "tick" })).toBe(one);
    expect(takeStep(one, { type: "rolled", playhead: 2, at: 10, began: new Date(0) })).toEqual(recordingState);
    const uploading = takeStep(recordingState, { type: "stopped", secs: 1.5, firstSample: 10.25 });
    expect(uploading).toEqual({ phase: "uploading", landing: 2.25, secs: 1.5 });
    expect(takeStep(uploading, { type: "landed" })).toEqual(IDLE);
  });

  test("an event out of turn changes nothing; a failure goes back to idle", () => {
    expect(takeStep(IDLE, { type: "stopped", secs: 1, firstSample: 0 })).toBe(IDLE);
    expect(takeStep(recordingState, { type: "open" })).toBe(recordingState);
    expect(takeStep(recordingState, { type: "failed" })).toEqual(IDLE);
    // Cancelled while opening or counting down only.
    expect(takeStep({ phase: "countdown", left: 2 }, { type: "cancel" })).toEqual(IDLE);
    expect(takeStep({ phase: "opening" }, { type: "cancel" })).toEqual(IDLE);
    expect(takeStep(recordingState, { type: "cancel" })).toBe(recordingState);
  });

  test("uploading → failed (the Take kept) → uploading again on Try again, or idle on Discard", () => {
    const take = { wav: new Uint8Array(44), name: "Voiceover.wav", landing: 2.25, secs: 1.5, media: null };
    const uploading = { phase: "uploading", landing: 2.25, secs: 1.5 } as const;
    const failed = takeStep(uploading, { type: "kept", take, why: "Couldn't upload the Take: no" });
    expect(failed).toEqual({ phase: "failed", take, why: "Couldn't upload the Take: no" });
    expect(takeStep(IDLE, { type: "kept", take, why: "no" })).toBe(IDLE);
    expect(takeStep(failed, { type: "retry" })).toEqual(uploading);
    expect(takeStep(failed, { type: "discard" })).toEqual(IDLE);
    expect(takeStep(failed, { type: "open" })).toBe(failed);
    expect(takeStep(uploading, { type: "discard" })).toBe(uploading);
    expect(asksBeforeLeaving(failed)).toBe(true);
    expect(locksEditing(failed)).toBe(false);
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
    await it.roll();
    const live = renderToStaticMarkup(<TakeButton flow={it.flow} />);
    expect(live).toContain('aria-label="Stop the Take"');
    expect(live).toContain('aria-pressed="true"');
    expect(live).toContain("The microphone&#x27;s level");
  });
});

// .scratch/voiceover/issues/03-countdown-and-lock.md: the countdown, the editing lock, leaving the
// page, and the button off at the Clip's end.
describe("the countdown", () => {
  test("three seconds with the playhead still and the microphone open, then the roll", async () => {
    const it = await setUp();
    await it.flow.press();
    expect(it.flow.state).toEqual({ phase: "countdown", left: 3 });
    // The microphone is open, so the meter already moves; nothing records yet.
    expect(it.flow.mic).not.toBeNull();
    expect(it.asked).toHaveLength(1);
    expect(renderToStaticMarkup(<TakeButton flow={it.flow} />)).toContain("The microphone&#x27;s level");
    vi.advanceTimersByTime(1000);
    it.stage.advance(1);
    expect(it.flow.state).toEqual({ phase: "countdown", left: 2 });
    expect(renderToStaticMarkup(<TakeButton flow={it.flow} />)).toMatch(/>2<\/span>/);
    vi.advanceTimersByTime(1000);
    it.stage.advance(1);
    expect(it.flow.state).toEqual({ phase: "countdown", left: 1 });
    expect(it.playback.playing).toBe(false);
    expect(it.playback.time).toBe(3);
    expect(it.silent).toEqual([]);
    vi.advanceTimersByTime(999);
    expect(it.flow.state.phase).toBe("countdown");
    vi.advanceTimersByTime(1);
    expect(it.flow.state).toMatchObject({ phase: "recording", playhead: 3 });
    expect(it.playback.playing).toBe(true);
    expect(it.silent).toEqual([true]);
  });

  test("a press while the picture plays pauses it where it is, for the countdown", async () => {
    const it = await setUp();
    it.playback.play();
    it.stage.advance(0.5);
    await it.flow.press();
    expect(it.playback.playing).toBe(false);
    const at = it.playback.time;
    it.stage.advance(2);
    expect(it.playback.time).toBe(at);
  });

  test("Esc cancels it: the microphone closed, nothing picked, rolled, uploaded or added", async () => {
    const it = await setUp();
    await it.flow.press();
    vi.advanceTimersByTime(1500);
    it.key({ key: "Escape" });
    expect(it.flow.state).toEqual(IDLE);
    expect(it.flow.mic).toBeNull();
    expect(it.closed).toEqual(expect.arrayContaining(["track", "capture"]));
    // Esc cancelled the countdown, and didn't also pick nothing.
    expect(it.picked).toEqual([]);
    vi.advanceTimersByTime(5000);
    await it.settle();
    expect(it.flow.state).toEqual(IDLE);
    expect(it.playback.playing).toBe(false);
    expect(it.silent).toEqual([]);
    expect(it.uploaded).toEqual([]);
    expect(it.world.edits.music).toHaveLength(1);
    // With no countdown, Esc picks nothing as ever.
    it.key({ key: "Escape" });
    expect(it.picked).toEqual(["none"]);
  });

  test("pressed again (the button or Shift+R), it is cancelled the same", async () => {
    const it = await setUp();
    await it.flow.press();
    it.key({ key: "R", shift: true });
    expect(it.flow.state).toEqual(IDLE);
    expect(it.closed).toContain("track");
    vi.advanceTimersByTime(5000);
    expect(it.playback.playing).toBe(false);
  });

  test("Esc while the microphone is still asked for: once it opens, it is closed, and nothing rolls", async () => {
    const it = await setUp();
    const pending = it.flow.press();
    expect(it.flow.state.phase).toBe("opening");
    it.key({ key: "Escape" });
    expect(it.flow.state).toEqual(IDLE);
    await pending;
    expect(it.closed).toContain("track");
    vi.advanceTimersByTime(5000);
    expect(it.flow.state).toEqual(IDLE);
    expect(it.playback.playing).toBe(false);
  });

  test("Space during the countdown leaves the playhead still", async () => {
    const it = await setUp();
    await it.flow.press();
    it.key({ key: " " });
    expect(it.playback.playing).toBe(false);
    expect(it.flow.state.phase).toBe("countdown");
  });
});

describe("the editing lock", () => {
  test("editing and navigation shortcuts are refused during the countdown and the recording; Space and the view's still work", async () => {
    const it = await setUp();
    const undone = () => it.world.edits;
    it.world.undo.push(it.world.edits);
    await it.flow.press();
    for (const phase of ["countdown", "recording"]) {
      expect(it.flow.state.phase).toBe(phase);
      // Taken, so the browser doesn't do them either (⌘D, ⌥←), but done: nothing.
      expect(it.key({ key: "b", command: true })).toBeUndefined();
      it.key({ key: "z", command: true });
      it.key({ key: "ArrowRight" });
      it.key({ key: "End" });
      expect(it.split).toEqual([]);
      expect(undone().music).toHaveLength(1);
      expect(it.world.undo).toHaveLength(1);
      expect(it.playback.time).toBeCloseTo(phase === "countdown" ? 3 : it.playback.time);
      vi.advanceTimersByTime(3000);
    }
    expect(it.playback.playing).toBe(true);
    // Space stops the Take; once it has landed, the shortcuts are back.
    it.speak(50.12, 1);
    it.key({ key: " " });
    await it.settle();
    expect(it.flow.state).toEqual(IDLE);
    it.key({ key: "b", command: true });
    expect(it.split).toEqual(["split"]);
  });

  test("the history's hand edits, undo and redo are refused while locked; a change from elsewhere still applies", () => {
    let locked = true;
    const calls: string[] = [];
    const history = {
      value: 0,
      set: (value: number) => void calls.push(`set ${value}`),
      undo: () => void calls.push("undo"),
      redo: () => void calls.push("redo"),
      canUndo: true,
      canRedo: false,
      flush: async () => {},
      waiting: () => false,
      elsewhere: (value: number) => void calls.push(`elsewhere ${value}`),
    };
    const refused: string[] = [];
    const hands = lockedWhile(history, () => {
      if (locked) refused.push("told");
      return locked;
    });
    hands.set(1);
    hands.undo();
    hands.redo();
    hands.elsewhere(2, (step) => step, false);
    expect(calls).toEqual(["elsewhere 2"]);
    expect(refused).toEqual(["told", "told", "told"]);
    locked = false;
    hands.set(3);
    hands.undo();
    expect(calls).toEqual(["elsewhere 2", "set 3", "undo"]);
  });

  test("it holds from the press until the Take has landed", async () => {
    let answer: (item: MediaItem) => void = () => {};
    const it = await setUp(() => new Promise((resolve) => (answer = resolve)));
    expect(locksEditing(it.flow.state)).toBe(false);
    const pending = it.flow.press();
    expect(locksEditing(it.flow.state)).toBe(true);
    await pending;
    expect(locksEditing(it.flow.state)).toBe(true);
    vi.advanceTimersByTime(3000);
    it.speak(50.12, 1);
    void it.flow.press();
    expect(it.flow.state.phase).toBe("uploading");
    expect(locksEditing(it.flow.state)).toBe(true);
    answer(ITEM);
    await it.settle();
    expect(locksEditing(it.flow.state)).toBe(false);
    expect(it.world.edits.music).toHaveLength(2);
  });
});

describe("leaving the page", () => {
  // `beforeunload` as the browser fires it: it asks when the event's default is prevented.
  const leave = (target: EventTarget) => {
    const event = new Event("beforeunload", { cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  test("asks while the countdown runs or the Take records, and not otherwise", async () => {
    const it = await setUp();
    const page = new EventTarget();
    const unguard = guardLeaving(page, it.flow);
    expect(leave(page)).toBe(false);
    await it.flow.press();
    expect(leave(page)).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(it.flow.state.phase).toBe("recording");
    expect(leave(page)).toBe(true);
    it.speak(50.12, 1);
    await it.flow.press();
    await it.settle();
    expect(it.flow.state).toEqual(IDLE);
    expect(leave(page)).toBe(false);
    unguard();
    await it.roll();
    expect(leave(page)).toBe(false);
    expect(asksBeforeLeaving({ phase: "uploading", landing: 0, secs: 1 })).toBe(false);
    expect(asksBeforeLeaving({ phase: "opening" })).toBe(false);
  });

  test("asks while a failed Take waits, and not after it has landed or been discarded", async () => {
    let fails = 2;
    const it = await recorded(
      ({ flow }) => flow.press(),
      await setUp(async () => {
        if (fails-- > 0) throw new Error("The upload stopped");
        return ITEM;
      }),
    );
    const page = new EventTarget();
    guardLeaving(page, it.flow);
    expect(it.flow.state.phase).toBe("failed");
    expect(leave(page)).toBe(true);
    // Leaving the page (pagehide) doesn't throw it away: the tab may yet come back.
    page.dispatchEvent(new Event("pagehide"));
    expect(it.flow.state.phase).toBe("failed");
    await it.flow.retry();
    expect(leave(page)).toBe(true);
    await it.flow.retry();
    expect(it.flow.state).toEqual(IDLE);
    expect(leave(page)).toBe(false);

    const other = await recorded(({ flow }) => flow.press(), await setUp(() => Promise.reject(new Error("no"))));
    const tab = new EventTarget();
    guardLeaving(tab, other.flow);
    expect(leave(tab)).toBe(true);
    other.flow.discard();
    expect(leave(tab)).toBe(false);
    expect(asksBeforeLeaving({ phase: "opening" })).toBe(false);
  });

  test("leaving cancels the Take: the microphone closed, the bus heard, nothing uploaded", async () => {
    const it = await setUp();
    const page = new EventTarget();
    guardLeaving(page, it.flow);
    await it.roll();
    page.dispatchEvent(new Event("pagehide"));
    expect(it.flow.state).toEqual(IDLE);
    expect(it.closed).toContain("track");
    expect(it.silent).toEqual([true, false]);
    await it.settle();
    expect(it.uploaded).toEqual([]);
  });
});

describe("at the Clip's end", () => {
  test("the end is the End key's: the Clip's last frame, or past it", () => {
    expect(atClipEnd(10 - 1 / 30, 10, 30)).toBe(true);
    expect(atClipEnd(10, 10, 30)).toBe(true);
    expect(atClipEnd(10 - 2 / 30, 10, 30)).toBe(false);
  });

  test("the button is off, with its hint, and neither it nor Shift+R starts a Take", async () => {
    const it = await setUp();
    it.key({ key: "End" });
    it.stage.settle();
    expect(atClipEnd(it.playback.time, it.playback.duration, 30)).toBe(true);
    const html = renderToStaticMarkup(<TakeButton flow={it.flow} atEnd />);
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain(AT_END_HINT);
    await it.flow.press();
    it.key({ key: "R", shift: true });
    await it.settle();
    expect(it.flow.state).toEqual(IDLE);
    expect(it.asked).toEqual([]);
    // In the Clip, it is on.
    expect(renderToStaticMarkup(<TakeButton flow={it.flow} atEnd={false} />)).not.toMatch(/<button[^>]*disabled=""/);
  });
});
