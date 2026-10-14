import { useEffect, useRef } from "react";
import { mediaItemUrl, type AudioEvent, type RenderPlan } from "../../../api";
import type { Playback } from "./playback";

// A song further than this from where the Clip's time puts it is moved back in step.
const MAX_DRIFT_SECS = 0.15;

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
function setVolume(element: HTMLMediaElement, volume: number) {
  const gain = gainOf(element);
  if (gain) gain.gain.value = volume;
  else element.volume = Math.min(1, Math.max(0, volume));
}

// A Music Clip's volume at `time`, through its fades, as the renderer's afade ramps it.
function loudness(event: AudioEvent, time: number): number {
  let share = 1;
  if (event.fade_in > 0) share = Math.min(share, (time - event.start) / event.fade_in);
  if (event.fade_out > 0) share = Math.min(share, (event.end - time) / event.fade_out);
  return event.volume * Math.max(0, Math.min(1, share));
}

/**
 * The plan's music, heard in step with the preview's playback: an <audio> per Music Clip, playing its
 * part of its song while the Clip's time is in it, at its volume through its fades. The Clip's own
 * sound (the master video) is set to the plan's `source_volume`. Nothing is routed through Web Audio
 * until the plan has music or another volume.
 */
export function PreviewMusic({
  plan,
  playback,
  master,
}: {
  plan: RenderPlan | null;
  playback: Playback;
  master: React.RefObject<HTMLVideoElement | null>;
}) {
  const players = useRef(new Map<string, HTMLAudioElement>());
  const events = plan?.audio ?? [];
  const sourceVolume = plan?.source_volume ?? 1;

  useEffect(() => {
    const video = master.current;
    if (video && (sourceVolume !== 1 || gains.has(video))) setVolume(video, sourceVolume);
  }, [master, sourceVolume, events.length]);

  useEffect(() => {
    const sync = () => {
      const time = playback.time;
      events.forEach((event, i) => {
        const element = players.current.get(key(event, i));
        if (!element) return;
        const inside = time >= event.start && time < event.end;
        const want = event.offset + (time - event.start);
        if (inside) {
          setVolume(element, loudness(event, time));
          if (Math.abs(element.currentTime - want) > MAX_DRIFT_SECS) element.currentTime = want;
          if (playback.playing && element.paused) void element.play().catch(() => {});
          if (!playback.playing && !element.paused) element.pause();
        } else if (!element.paused) element.pause();
      });
    };
    sync();
    return playback.subscribe(sync);
  }, [playback, events]);

  return (
    <>
      {events.map((event, i) => (
        <audio
          key={key(event, i)}
          ref={(element) => {
            if (element) players.current.set(key(event, i), element);
            else players.current.delete(key(event, i));
          }}
          src={mediaItemUrl(event.media)}
          preload="auto"
          hidden
        />
      ))}
    </>
  );
}

const key = (event: AudioEvent, i: number) => `${i}:${event.media}`;
