import { useEffect, useMemo, useRef } from "react";
import { mediaItemUrl, type AudioEvent, type RenderPlan } from "../../../api";
import { follow, MAX_DRIFT_SECS } from "./follow";
import { CURVE_RATE, loudness, loudnessCurve } from "./loudness";
import type { Playback } from "./playback";
import { eventCopy, eventPlay, useRetimedCopies } from "./retimedCopy";

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

// What each element of the page plays through, once it does: a media element can be routed through
// Web Audio only once.
const gains = new WeakMap<HTMLMediaElement, GainNode>();

function gainOf(element: HTMLMediaElement): GainNode | null {
  const existing = gains.get(element);
  if (existing) return existing;
  const audio = audioContext();
  if (!audio) return null;
  const gain = audio.createGain();
  audio.createMediaElementSource(element).connect(gain).connect(audio.destination);
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
const curves = new WeakMap<GainNode, { event: AudioEvent; from: number; at: number; rate: number }>();

function unschedule(gain: GainNode) {
  if (curves.delete(gain)) gain.gain.cancelScheduledValues(0);
}

/**
 * Sets how loud a keyed sound's `element` plays at the playback's time: while playing, through Web
 * Audio, as a curve sampled from the playhead to its end (loudnessCurve), set on play, on every seek
 * (when the time is further than MAX_DRIFT_SECS from where the curve has got to), at a new rate and
 * for a new `event` (another object); otherwise its loudness there. A Muted one follows no curve: it
 * is held at 0. A Music Clip's, an Overlay video's, and a video Segment's (PreviewSegments.tsx, as an
 * event of its own).
 */
export function followCurve(element: HTMLMediaElement, playback: Playback, event: AudioEvent) {
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
 * (retimedCopy.ts), silent until the copy is made. The Clip's own sound (each deck's master video, heard while its deck is
 * live) is set to the plan's `source_volume`, times the Segment's own volume, or held at 0 while it is
 * Muted, as a Muted Music Clip or Overlay sound is (`loudness`). Nothing is routed
 * through Web Audio until the plan has music or another volume.
 */
export function PreviewMusic({
  plan,
  playback,
  masters,
}: {
  plan: RenderPlan | null;
  playback: Playback;
  masters: React.RefObject<HTMLVideoElement | null>[];
}) {
  const players = useRef(new Map<string, HTMLAudioElement>());
  const events = useMemo(() => plan?.audio ?? [], [plan]);
  const sourceVolume = plan?.source_volume ?? 1;
  const copies = useRetimedCopies(
    events.map((event) => {
      const range = eventCopy(event);
      return range && { media: event.media, range };
    }),
  );
  const played = events.map((event, i) => eventPlay(event, mediaItemUrl(event.media), copies[i]));
  // Followed on each tick as they are now, and at once when a copy comes.
  const plays = useRef(played);
  plays.current = played;
  const sources = played.map((play) => play.src).join(" ");

  useEffect(() => {
    const sync = () => {
      // A skim's snippet is heard at the skimmed Segment's volume; a Muted one's not at all.
      const shown = playback.segments[playback.shownSegmentIndex];
      const volume = shown.muted ? 0 : sourceVolume * (shown.media ? 1 : (shown.volume ?? 1));
      for (const { current: video } of masters) if (video && (volume !== 1 || gains.has(video))) setVolume(video, volume);
      events.forEach((event, i) => {
        const element = players.current.get(key(event, i));
        if (element && follow(element, playback, plays.current[i].span)) {
          if (event.gain.length) followCurve(element, playback, event);
          else setVolume(element, loudness(event, playback.shownTime));
        }
      });
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, events, masters, sourceVolume, sources]);

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

const key = (event: AudioEvent, i: number) => `${i}:${event.media}`;
