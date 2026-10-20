import { clearClip, meterStep, QUIET, type Meter } from "./ballistics";
import { encodeWav, pcm16, roomFor, TAKE_RATE } from "./voiceover";

/**
 * The take recorder (GLOSSARY.md, Take; ADR 0018): the microphone, raw, as mono 48 kHz PCM captured
 * through an AudioWorklet on an AudioContext of its own, written as WAV. No React: the take flow
 * (./takeFlow.ts) drives it.
 *
 * Opened, the microphone is live and its level moves the meter, but nothing is kept until `record`
 * (so that a countdown can show the meter first). From then on every sample is kept, from the block
 * that holds the moment it was called, up to eight minutes, when it stops keeping and says so once.
 */

/** What a Take gives once stopped: its WAV, its length, and the AudioContext time of its first sample. */
export interface Take {
  wav: Uint8Array<ArrayBuffer>;
  secs: number;
  // Null when it caught no sample.
  firstSample: number | null;
}

/** A block of the microphone's samples, mono, captured from `time` on the AudioContext's clock. */
export type Block = (time: number, samples: Float32Array) => void;

/** The capture under way: its AudioContext's clock, and what releases it. */
export interface Capture {
  now: () => number;
  rate: number;
  close: () => void;
}

/** What the recorder is made with: the browser's, or a test's fakes. */
export interface RecorderDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  // The stream captured, each block of it given to `block`.
  capture: (stream: MediaStream, block: Block) => Promise<Capture>;
}

export interface TakeRecorder {
  // The microphone's level, through the Meters' ballistics (mono: both sides alike).
  readonly meter: Meter;
  // The recorder's AudioContext time now, which the picture's roll is timed by.
  now: () => number;
  // From now on, what the microphone hears is kept.
  record: () => void;
  // The Take kept, and the microphone closed.
  stop: () => Take;
  // The microphone closed, nothing kept.
  close: () => void;
  // The meter's clip light off.
  clearClip: () => void;
}

/**
 * The input as the take is recorded from it: raw, the browser's echo cancellation, noise suppression
 * and automatic gain off, on `deviceId` when one is chosen (else the default input).
 */
export function takeConstraints(deviceId?: string | null): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  };
}

/**
 * The microphone opened for a Take; `capped` is called once if it reaches eight minutes, after which
 * nothing more is kept. Rejects as `getUserMedia` does when the microphone is refused, missing or busy.
 */
export async function openTake(deps: RecorderDeps, options: { deviceId?: string | null; capped?: () => void } = {}): Promise<TakeRecorder> {
  const stream = await deps.getUserMedia(takeConstraints(options.deviceId));
  const release = () => stream.getTracks().forEach((track) => track.stop());
  let meter = QUIET;
  // Kept since `record` was called: from the block holding `from`, in 16-bit chunks.
  let from: number | null = null;
  let firstSample: number | null = null;
  const chunks: Int16Array[] = [];
  let kept = 0;
  let full = false;
  let closed = false;
  let rate = TAKE_RATE;

  const block: Block = (time, samples) => {
    if (closed) return;
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    meter = meterStep(meter, [peak, peak], samples.length / rate);
    if (from === null || full || time + samples.length / rate <= from) return;
    if (firstSample === null) firstSample = time;
    const room = roomFor(kept, samples.length, rate);
    const chunk = new Int16Array(room);
    for (let i = 0; i < room; i++) chunk[i] = pcm16(samples[i]);
    chunks.push(chunk);
    kept += room;
    if (room < samples.length || roomFor(kept, 1, rate) === 0) {
      full = true;
      options.capped?.();
    }
  };

  let capture: Capture;
  try {
    capture = await deps.capture(stream, block);
  } catch (reason) {
    release();
    throw reason;
  }
  rate = capture.rate;
  const close = () => {
    if (closed) return;
    closed = true;
    capture.close();
    release();
  };

  return {
    get meter() {
      return meter;
    },
    now: capture.now,
    record() {
      if (from === null) from = capture.now();
    },
    stop() {
      close();
      return { wav: encodeWav(chunks, rate), secs: kept / rate, firstSample };
    },
    close,
    clearClip() {
      meter = clearClip(meter);
    },
  };
}

// The AudioWorklet's processor: each block of its input (mixed to mono by the node) posted with the
// AudioContext time of its first sample. It outputs silence, so that it can be pulled by the
// destination without being heard.
const PROCESSOR = `
class TakeCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage({ time: currentTime, samples: channel.slice(0) });
    return true;
  }
}
registerProcessor("take-capture", TakeCapture);
`;

let processorUrl: string | null = null;

/**
 * The browser's capture: an AudioContext of its own at 48 kHz, the stream into the "take-capture"
 * worklet (its source inlined as a Blob URL, so the build needs no worklet entry), mixed down to one
 * channel, and through it to the destination, silent.
 */
export async function browserCapture(stream: MediaStream, block: Block): Promise<Capture> {
  const context = new AudioContext({ sampleRate: TAKE_RATE, latencyHint: "interactive" });
  try {
    processorUrl ??= URL.createObjectURL(new Blob([PROCESSOR], { type: "text/javascript" }));
    await context.audioWorklet.addModule(processorUrl);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "take-capture", { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers" });
    node.port.onmessage = (event: MessageEvent<{ time: number; samples: Float32Array }>) => block(event.data.time, event.data.samples);
    source.connect(node).connect(context.destination);
    // Opened by a click or a key, it may still start suspended (Safari).
    if (context.state === "suspended") await context.resume();
    return {
      now: () => context.currentTime,
      rate: context.sampleRate,
      close: () => {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        void context.close();
      },
    };
  } catch (reason) {
    void context.close();
    throw reason;
  }
}

/** The recorder as the browser makes it. */
export const browserRecorder = (): RecorderDeps => ({
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  capture: browserCapture,
});
