/**
 * The preview's master bus: one gain node that every heard element's own gain feeds (PreviewMusic's
 * `gainOf`), and that feeds the speakers and, through a channel splitter, an analyser for each side,
 * which the Meters read (GLOSSARY.md). What it carries is what is heard, Track mute included.
 */
export type MasterBus = { input: GainNode; sides: readonly [AnalyserNode, AnalyserNode] };

let made: { audio: BaseAudioContext; bus: MasterBus } | null = null;
// Held silent while a Take records (ADR 0018), so that the speakers don't bleed into the microphone.
let held = false;

/** The bus of `audio`, the page's AudioContext, made on first need. */
export function masterBus(audio: BaseAudioContext): MasterBus {
  if (made?.audio === audio) return made.bus;
  const input = audio.createGain();
  // Two channels always: a mono Source or song is heard on both sides, and metered on both.
  input.channelCount = 2;
  input.channelCountMode = "explicit";
  input.channelInterpretation = "speakers";
  const splitter = audio.createChannelSplitter(2);
  const sides = [audio.createAnalyser(), audio.createAnalyser()] as const;
  input.connect(audio.destination);
  input.connect(splitter);
  sides.forEach((side, channel) => splitter.connect(side, channel));
  made = { audio, bus: { input, sides } };
  input.gain.value = held ? 0 : 1;
  return made.bus;
}

/** How long the bus takes to fall silent, or to come back: short, but not a step, which would click. */
export const HOLD_RAMP_SECS = 0.015;

/**
 * The bus held silent (true) or heard again (false): the speakers and the Meters, everything the
 * preview plays, as one, along a ramp of HOLD_RAMP_SECS from where its gain is. Kept for a bus made
 * later, which starts in that state at once (nothing plays through it yet).
 *
 * Without Web Audio the preview sets each element's own volume (PreviewMusic's `setVolume`), past
 * any bus. That can't happen while a Take records: the take recorder captures on an AudioContext of
 * its own, so a browser without one opens no microphone, and no Take rolls.
 */
export function holdBus(silent: boolean) {
  held = silent;
  if (!made) return;
  const { gain } = made.bus.input;
  const now = made.audio.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(silent ? 0 : 1, now + HOLD_RAMP_SECS);
}

/** The bus, once anything plays through Web Audio; null before. */
export const heardBus = (): MasterBus | null => made?.bus ?? null;
