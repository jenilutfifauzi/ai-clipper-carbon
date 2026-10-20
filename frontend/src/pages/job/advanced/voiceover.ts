/**
 * The take recorder's pure parts (GLOSSARY.md, Voiceover and Take; ADR 0018): the WAV a Take is
 * uploaded as, where it lands on the Timeline, its eight-minute cap and its file's name. Kept apart
 * from the recorder (./takeRecorder.ts), which captures the microphone, so that each is tested alone.
 */

/** A Take's sample rate: mono 16-bit PCM at 48 kHz. */
export const TAKE_RATE = 48000;

/**
 * The longest a Take records before it stops itself: eight minutes of mono 48 kHz 16-bit WAV is
 * about 46 MB, under the Media Library's 50 MB for sound.
 */
export const TAKE_MAX_SECS = 8 * 60;

/** How many samples a Take at `rate` keeps at most. */
export const takeCap = (rate = TAKE_RATE) => Math.round(TAKE_MAX_SECS * rate);

/**
 * How many of `incoming` samples a Take that has kept `kept` already may keep: all of them, or what
 * is left under its cap, never less than none.
 */
export const roomFor = (kept: number, incoming: number, rate = TAKE_RATE) => Math.max(0, Math.min(incoming, takeCap(rate) - kept));

/** A sample (1 is full scale) as 16-bit PCM, clamped to it. */
export function pcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample || 0));
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
}

/**
 * `chunks` of mono 16-bit samples, one after another, as a WAV file at `rate`: the plain 44-byte
 * RIFF header (PCM, one channel), then the samples, little-endian.
 */
export function encodeWav(chunks: readonly Int16Array[], rate = TAKE_RATE): Uint8Array<ArrayBuffer> {
  const samples = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const data = samples * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  // PCM, one channel, at `rate`, two bytes a sample.
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, data, true);
  let at = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      view.setInt16(at, sample, true);
      at += 2;
    }
  }
  return bytes;
}

/**
 * Where a Take lands on the Timeline (Concat's `record::landing`): the playhead it was recorded from,
 * plus the time from the moment the picture rolled to its first captured sample, both on the
 * recorder's AudioContext clock, so that the browser's start-up latency drops out. A Take with no
 * sample lands at the playhead; none lands before 0.
 */
export function landing(playhead: number, rolledAt: number, firstSample: number | null): number {
  return Math.max(0, playhead + (firstSample === null ? 0 : firstSample - rolledAt));
}

const two = (n: number) => String(n).padStart(2, "0");

/** A Take's file name, from the local time it was recorded: "Voiceover 2026-10-20 14.03.05.wav". */
export function takeName(at: Date): string {
  const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  return `Voiceover ${day} ${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}.wav`;
}

/**
 * Whether this page can record a Take: only in a secure context (localhost, say), where the browser
 * gives a microphone. A phone reaching the app over plain HTTP gets none (ADR 0018).
 */
export function canRecord(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true && typeof navigator !== "undefined" && !!navigator.mediaDevices;
}
