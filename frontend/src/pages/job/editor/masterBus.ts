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

/**
 * The bus held silent (true) or heard again (false): the speakers and the Meters, everything the
 * preview plays, as one. Kept for a bus made later.
 */
export function holdBus(silent: boolean) {
  held = silent;
  if (made) made.bus.input.gain.value = silent ? 0 : 1;
}

/** The bus, once anything plays through Web Audio; null before. */
export const heardBus = (): MasterBus | null => made?.bus ?? null;
