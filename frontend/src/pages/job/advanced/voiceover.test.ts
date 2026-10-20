// .scratch/voiceover/issues/02-record-a-take.md: the take recorder's pure parts (the WAV a Take is
// uploaded as, where it lands, its file's name) and the recorder itself on a fake microphone and a
// fake AudioContext clock: what it keeps once recording, its first sample's time, the meter it
// reports, the raw input it asks for, and its eight-minute cap.
import { afterEach, describe, expect, test, vi } from "vitest";
import { FLOOR_DB } from "./ballistics";
import { browserCapture, openTake, takeConstraints, type Block, type RecorderDeps } from "./takeRecorder";
import { encodeWav, landing, pcm16, TAKE_MAX_SECS, TAKE_RATE, takeName } from "./voiceover";

// A WAV as a reader sees it: its header's fields and its samples.
function readWav(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));
  const size = view.getUint32(40, true);
  const samples = [];
  for (let at = 44; at < 44 + size; at += 2) samples.push(view.getInt16(at, true));
  return {
    riff: text(0),
    riffSize: view.getUint32(4, true),
    wave: text(8),
    fmt: text(12),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    rate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    align: view.getUint16(32, true),
    bits: view.getUint16(34, true),
    data: text(36),
    size,
    samples,
  };
}

describe("a Take's WAV", () => {
  test("round-trips its header and samples: mono 16-bit PCM at 48 kHz", () => {
    const wav = encodeWav([Int16Array.of(0, 1, -1), Int16Array.of(32767, -32768)]);
    expect(wav.length).toBe(44 + 10);
    expect(readWav(wav)).toEqual({
      riff: "RIFF",
      riffSize: 36 + 10,
      wave: "WAVE",
      fmt: "fmt ",
      format: 1,
      channels: 1,
      rate: 48000,
      byteRate: 96000,
      align: 2,
      bits: 16,
      data: "data",
      size: 10,
      samples: [0, 1, -1, 32767, -32768],
    });
  });

  test("an empty Take is a header alone", () => {
    expect(readWav(encodeWav([])).samples).toEqual([]);
  });

  test("a sample is 16-bit PCM, full scale both ways, clamped past it", () => {
    expect([1, -1, 0, 0.5, 2, -2, NaN].map(pcm16)).toEqual([32767, -32768, 0, 16384, 32767, -32768, 0]);
  });
});

describe("where a Take lands", () => {
  test("at the playhead plus the time from the roll to its first sample", () => {
    expect(landing(4, 10, 10.25)).toBeCloseTo(4.25, 9);
  });

  test("earlier when its first sample came before the roll", () => {
    expect(landing(4, 10, 9.99)).toBeCloseTo(3.99, 9);
  });

  test("at the playhead when it caught no sample", () => {
    expect(landing(4, 10, null)).toBe(4);
  });

  test("never before 0", () => {
    expect(landing(0, 10, 9.5)).toBe(0);
    expect(landing(0.1, 10, 9.5)).toBe(0);
  });
});

test("a Take is named by the local time it was recorded, its time's dots kept", () => {
  expect(takeName(new Date(2026, 9, 20, 14, 3, 5))).toBe("Voiceover 2026-10-20 14.03.05.wav");
  expect(takeName(new Date(2026, 0, 2, 9, 0, 0))).toBe("Voiceover 2026-01-02 09.00.00.wav");
});

// The microphone and its AudioContext, faked: blocks of `size` samples at `level`, pushed by the test
// one after another, each told the time it was captured from; and the AudioContext's clock, which the
// blocks keep up with and which `wait` moves on ahead of them (a block reaches the recorder a moment
// after it was captured).
function fakeMic() {
  const asked: MediaStreamConstraints[] = [];
  const stopped: string[] = [];
  let block: Block = () => {};
  let time = 0;
  let clock = 0;
  let closed = 0;
  const deps: RecorderDeps = {
    getUserMedia: async (constraints) => {
      asked.push(constraints);
      return { getTracks: () => [{ stop: () => stopped.push("track") }] } as unknown as MediaStream;
    },
    capture: async (_stream, onBlock) => {
      block = onBlock;
      return { now: () => clock, rate: TAKE_RATE, close: () => void closed++ };
    },
  };
  return {
    deps,
    asked,
    stopped,
    get closed() {
      return closed;
    },
    // `count` blocks of `size` samples at `level`, the clock moving on by each.
    push(count: number, size = 128, level = 0.5) {
      for (let i = 0; i < count; i++) {
        block(time, new Float32Array(size).fill(level));
        time += size / TAKE_RATE;
        clock = Math.max(clock, time);
      }
    },
    // The clock alone moving on, ahead of the blocks: what `record` is timed by.
    wait(secs: number) {
      clock += secs;
    },
  };
}

describe("the take recorder", () => {
  test("opens the input raw: echo cancellation, noise suppression and automatic gain off", async () => {
    const mic = fakeMic();
    await openTake(mic.deps);
    expect(mic.asked).toHaveLength(1);
    expect(mic.asked[0].audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(takeConstraints("usb").audio).toMatchObject({ deviceId: { exact: "usb" }, echoCancellation: false });
  });

  test("keeps nothing until it records, and then everything from the block holding that moment, its first sample's time told", async () => {
    const mic = fakeMic();
    const recorder = await openTake(mic.deps);
    // The meter moves before recording, from the microphone's level.
    mic.push(10, 480, 0.5);
    expect(recorder.meter.left.level).toBeCloseTo(-6.02, 1);
    // Asked half a block into the next one, not yet come.
    mic.wait(0.005);
    expect(recorder.now()).toBeCloseTo(0.105, 9);
    recorder.record();
    mic.push(100, 480);
    const take = recorder.stop();
    // That block counts, from its start.
    expect(take.firstSample).toBeCloseTo(0.1, 9);
    expect(take.secs).toBeCloseTo(1, 9);
    expect(readWav(take.wav).samples.slice(0, 2)).toEqual([16384, 16384]);
    expect(readWav(take.wav).samples).toHaveLength(48000);
    // Stopped, the microphone is released.
    expect(mic.stopped).toEqual(["track"]);
    expect(mic.closed).toBe(1);
  });

  test("closed, it keeps nothing and lets the microphone go", async () => {
    const mic = fakeMic();
    const recorder = await openTake(mic.deps);
    recorder.record();
    recorder.close();
    expect(mic.stopped).toEqual(["track"]);
    expect(mic.closed).toBe(1);
  });

  test("stops itself at eight minutes, saying so once, and keeps no sample past it", async () => {
    const mic = fakeMic();
    const capped = vi.fn();
    const recorder = await openTake(mic.deps, { capped });
    recorder.record();
    // A second a block, 7 min 59 s: not yet.
    mic.push(TAKE_MAX_SECS - 1, TAKE_RATE);
    expect(capped).not.toHaveBeenCalled();
    // The last second goes in a block that runs past the cap: it is cut there.
    mic.push(1, TAKE_RATE + 1000);
    expect(capped).toHaveBeenCalledTimes(1);
    mic.push(5, TAKE_RATE);
    expect(capped).toHaveBeenCalledTimes(1);
    const take = recorder.stop();
    expect(take.secs).toBe(TAKE_MAX_SECS);
    expect(take.wav.length).toBe(44 + TAKE_MAX_SECS * TAKE_RATE * 2);
  });

  test("a silent microphone leaves the meter on its foot", async () => {
    const mic = fakeMic();
    const recorder = await openTake(mic.deps);
    mic.push(10, 128, 0);
    expect(recorder.meter.left.level).toBe(FLOOR_DB);
  });

  test("a refused microphone rejects as getUserMedia does", async () => {
    const refused = Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
    const deps: RecorderDeps = { getUserMedia: () => Promise.reject(refused), capture: () => Promise.reject(new Error("unused")) };
    await expect(openTake(deps)).rejects.toBe(refused);
  });
});

describe("the browser's capture", () => {
  afterEach(() => vi.unstubAllGlobals());

  // An AudioContext and AudioWorkletNode as the capture uses them, recording what it made of them.
  function fakeAudio() {
    const made: { options?: AudioContextOptions; modules: string[]; links: string[]; closed: boolean } = { modules: [], links: [], closed: false };
    const nodes: { name: string; options: AudioWorkletNodeOptions; port: { onmessage: ((event: { data: unknown }) => void) | null } }[] = [];
    const node = (name: string) => ({ connect: (to: { name: string }) => (made.links.push(`${name}→${to.name}`), to), disconnect: () => {}, name });
    class FakeContext {
      currentTime = 12.5;
      sampleRate: number;
      state = "running";
      destination = { name: "destination" };
      audioWorklet = { addModule: async (url: string) => void made.modules.push(url) };
      constructor(options: AudioContextOptions) {
        made.options = options;
        this.sampleRate = options.sampleRate ?? 44100;
      }
      createMediaStreamSource = () => node("microphone");
      close = async () => void (made.closed = true);
    }
    class FakeWorkletNode {
      port = { onmessage: null };
      name = "capture";
      constructor(_context: unknown, name: string, options: AudioWorkletNodeOptions) {
        nodes.push({ name, options, port: this.port });
      }
      connect = (to: { name: string }) => (made.links.push(`capture→${to.name}`), to);
      disconnect = () => {};
    }
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:take-capture" });
    return { made, nodes };
  }

  test("captures mono at 48 kHz through the worklet on a context of its own, each block timed on its clock", async () => {
    const { made, nodes } = fakeAudio();
    const blocks: [number, number][] = [];
    const capture = await browserCapture({} as MediaStream, (time, samples) => blocks.push([time, samples.length]));
    expect(made.options?.sampleRate).toBe(48000);
    expect(made.modules).toEqual(["blob:take-capture"]);
    expect(nodes.map(({ name, options }) => [name, options.channelCount, options.channelCountMode])).toEqual([["take-capture", 1, "explicit"]]);
    expect(made.links).toEqual(["microphone→capture", "capture→destination"]);
    nodes[0].port.onmessage?.({ data: { time: 12.5, samples: new Float32Array(128) } });
    expect(blocks).toEqual([[12.5, 128]]);
    expect([capture.now(), capture.rate]).toEqual([12.5, 48000]);
    capture.close();
    expect(made.closed).toBe(true);
  });
});
