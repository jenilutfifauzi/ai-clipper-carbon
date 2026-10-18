import { useEffect, useMemo, useRef } from "react";
import { mediaItemUrl, type AudioEvent, type RenderPlan } from "../../../api";
import { follow, MAX_DRIFT_SECS } from "./follow";
import { changing, CURVE_RATE, eventSound, loudness, loudnessCurve, segmentSound, type Heard } from "./loudness";
import { masterBus } from "./masterBus";
import { onOwnVideos, type Playback, type PlayedSegment } from "./playback";
import { eventPlay, soundAsk, useRetimedCopies } from "./retimedCopy";

let context: AudioContext | null = null;

// The page's AudioContext, made on first need. A browser starts it suspended until a click or a key
// press, so it is resumed on every one.
function audioContext(): AudioContext | null {
  if (context || typeof AudioContext === "undefined") return context;
  context = new AudioContext();
  const resume = () => void context?.resume();
  window.addEventListener("pointerdown", resume, true);
  window.addEventListener("keydown", resume, true);
  return context;
}

// What each element of the page plays through, once it does, into the master bus: a media element can
// be routed through Web Audio only once.
const gains = new WeakMap<HTMLMediaElement, GainNode>();

function gainOf(element: HTMLMediaElement): GainNode | null {
  const existing = gains.get(element);
  if (existing) return existing;
  const audio = audioContext();
  if (!audio) return null;
  const gain = audio.createGain();
  audio.createMediaElementSource(element).connect(gain).connect(masterBus(audio).input);
  gains.set(element, gain);
  return gain;
}

// Sets how loud `element` plays: through Web Audio, which goes past 1 as the render does, or (without
// it) as loud as the element can.
export function setVolume(element: HTMLMediaElement, volume: number) {
  const gain = gainOf(element);
  if (gain) {
    unschedule(gain);
    gain.gain.value = volume;
  } else element.volume = Math.min(1, Math.max(0, volume));
}

// The curve each gain node follows, while it does: of `event`, scheduled when the Clip's time was
// `from` and the AudioContext's `at`, at the playback's `rate`.
const curves = new WeakMap<GainNode, { event: Heard; from: number; at: number; rate: number }>();

function unschedule(gain: GainNode) {
  if (curves.delete(gain)) gain.gain.cancelScheduledValues(0);
}

/**
 * Sets how loud a keyed or faded sound's `element` plays at the playback's time: while playing, through Web
 * Audio, as a curve sampled from the playhead to its end (loudnessCurve), set on play, on every seek
 * (when the time is further than MAX_DRIFT_SECS from where the curve has got to), at a new rate and
 * for a new `event` (another object); otherwise its loudness there. A Muted one follows no curve: it
 * is held at 0. A Music Clip's, an Overlay video's, and a Segment's (`segmentSound`): on the decks'
 * masters, or on its own videos (PreviewSegments.tsx).
 */
export function followCurve(element: HTMLMediaElement, playback: Playback, event: Heard) {
  const time = playback.shownTime;
  const gain = gainOf(element);
  if (!gain || !context || context.state !== "running" || !playback.playing || event.muted) {
    setVolume(element, loudness(event, time));
    return;
  }
  const now = context.currentTime;
  const curve = curves.get(gain);
  if (curve && curve.event === event && curve.rate === playback.rate && Math.abs(curve.from + (now - curve.at) * curve.rate - time) <= MAX_DRIFT_SECS) return;
  const values = loudnessCurve(event, time);
  gain.gain.cancelScheduledValues(0);
  gain.gain.setValueCurveAtTime(values, now, (values.length - 1) / CURVE_RATE / playback.rate);
  curves.set(gain, { event, from: time, at: now, rate: playback.rate });
}

/**
 * The plan's music, heard in step with the preview's playback: an <audio> per Music Clip (and Overlay
 * video's sound, at its Speed and pitch), playing its part of its song while the Clip's time is in it, at its volume (a keyed one's Keyframes, as a
 * curve) through its fades. An Overlay's sound in Reverse or at a Speed a browser won't play is its Retimed copy's
 * (retimedCopy.ts), silent until the copy is made. A Music Clip of the Source plays the Source's `src` (the decks'
 * proxy) or its Retimed copy (of Job `jobId`), at the plan's `source_volume` too (`eventSound`). The Clip's own sound
 * (each deck's master video, heard while its deck is live) is set to the plan's `source_volume`, times the Segment's
 * own volume (a keyed one's Keyframes, as a curve), through its fades, or held at 0 while it is Muted, as a Muted
 * Music Clip or Overlay sound is (`loudness`). Every element is heard through Web Audio and its master bus
 * (masterBus.ts), which the Meters read.
 */
export function PreviewMusic({
  plan,
  playback,
  masters,
  src,
  jobId,
}: {
  plan: RenderPlan | null;
  playback: Playback;
  masters: React.RefObject<HTMLVideoElement | null>[];
  src: string;
  jobId: string;
}) {
  const players = useRef(new Map<string, HTMLAudioElement>());
  const events = useMemo(() => plan?.audio ?? [], [plan]);
  const sourceVolume = plan?.source_volume ?? 1;
  // As heard: a Music Clip of the Source's at the Clip's own sound too.
  const sounds = useMemo(() => events.map((event) => eventSound(event, sourceVolume)), [events, sourceVolume]);
  // The Segments' sounds as planned (their fades fitted, each to its end past a Transition's start),
  // which the decks' masters play while the plan has the Segments the playback plays.
  const planned = useMemo(() => plan?.segments.map((segment) => segmentSound(segment, plan.source_volume)) ?? [], [plan]);
  const copies = useRetimedCopies(events.map((event) => soundAsk(event, jobId)));
  const played = events.map((event, i) => eventPlay(event, event.media ? mediaItemUrl(event.media) : src, copies[i]));
  // Followed on each tick as they are now, and at once when a copy comes.
  const plays = useRef(played);
  plays.current = played;
  const sources = played.map((play) => play.src).join(" ");

  useEffect(() => {
    // Otherwise each Source Segment's sound as drafted (keyed, unfaded), made once while it is shown,
    // so that its curve isn't set again.
    const drafted = new WeakMap<PlayedSegment, Heard>();
    const soundOf = (shown: PlayedSegment) => drafted.get(shown) ?? drafted.set(shown, segmentSound(shown, sourceVolume)).get(shown)!;
    const sync = () => {
      // A skim's snippet is heard at the skimmed Segment's volume, and through its fades; a Muted one's not at all.
      const index = playback.shownSegmentIndex;
      const shown = playback.segments[index];
      const sound = onOwnVideos(shown) ? null : planned.length === playback.segments.length ? planned[index] : soundOf(shown);
      const volume = shown.muted ? 0 : sourceVolume * (shown.media ? 1 : (shown.volume ?? 1));
      for (const { current: video } of masters) {
        if (video && sound && changing(sound)) followCurve(video, playback, sound);
        else if (video) setVolume(video, volume);
      }
      sounds.forEach((sound, i) => {
        const element = players.current.get(key(sound, i));
        if (element && follow(element, playback, plays.current[i].span)) {
          if (sound.gain.length) followCurve(element, playback, sound);
          else setVolume(element, loudness(sound, playback.shownTime));
        }
      });
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, sounds, masters, sourceVolume, planned, sources]);

  return (
    <>
      {events.map((event, i) => (
        <audio
          key={key(event, i)}
          ref={(element) => {
            if (element) players.current.set(key(event, i), element);
            else players.current.delete(key(event, i));
          }}
          src={played[i].src}
          preload="auto"
          hidden
        />
      ))}
    </>
  );
}

const key = (event: AudioEvent, i: number) => `${i}:${event.media ?? "source"}`;
