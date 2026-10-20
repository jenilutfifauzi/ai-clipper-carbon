import { useEffect, useMemo, useRef } from "react";
import type { RenderPlan } from "../../../api";
import { copySounds, effectedAsks, lostCopy, setHeardFromCopy, urlOf, useEffectedVersion, type CopySound } from "./effectedCopy";
import { follow } from "./follow";
import { changing, loudness } from "./loudness";
import type { Playback } from "./playback";
import { followCurve, setVolume } from "./PreviewMusic";

/**
 * The plan's items heard from their Effected copies (effectedCopy.ts, ADR 0017): a hidden <audio>
 * per copy made, playing it at 1× in its item's own time (`follow`), as loud as its item's own sound
 * (a keyed, faded, ducked or crossed one along its curve, `followCurve`), through Web Audio and the
 * master bus, which the Meters read. Once its element can play, its item is heard from it
 * (`setHeardFromCopy`): the item's own media (a deck's master over its Segment, its own video, its
 * song) is then silent while playing. Until then the item is heard from its own media, plain.
 */
export function PreviewEffected({ plan, playback }: { plan: RenderPlan | null; playback: Playback }) {
  const version = useEffectedVersion();
  const sounds = useMemo(() => {
    if (!plan) return [];
    const ready = effectedAsks(plan).flatMap((ask) => {
      const url = urlOf(ask);
      return url ? [{ kind: ask.kind, id: ask.id, url }] : [];
    });
    return copySounds(plan, ready);
    // `version` changes as copies are made.
  }, [plan, version]);
  return (
    <>
      {sounds.map((sound) => (
        <CopyPlayer key={`${sound.item.kind}:${sound.item.id}:${sound.url}`} sound={sound} playback={playback} />
      ))}
    </>
  );
}

function CopyPlayer({ sound, playback }: { sound: CopySound; playback: Playback }) {
  const element = useRef<HTMLAudioElement>(null);
  const { item } = sound;

  useEffect(() => {
    const audio = element.current;
    if (!audio) return;
    const ready = () => setHeardFromCopy(item, audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
    const sync = () => {
      follow(audio, playback, sound.span, true);
      if (changing(sound.sound)) followCurve(audio, playback, sound.sound, sound.crossed);
      else setVolume(audio, loudness(sound.sound, playback.shownTime, sound.crossed));
    };
    // Gone (swept after a save): asked for again, the item heard plain meanwhile.
    const gone = () => {
      setHeardFromCopy(item, false);
      lostCopy(sound.url);
    };
    ready();
    audio.addEventListener("canplay", ready);
    audio.addEventListener("error", gone);
    sync();
    const unsubscribe = playback.subscribe(sync);
    return () => {
      unsubscribe();
      audio.removeEventListener("canplay", ready);
      audio.removeEventListener("error", gone);
      setHeardFromCopy(item, false);
      audio.pause();
    };
  }, [playback, sound, item]);

  return <audio ref={element} src={sound.url} preload="auto" hidden />;
}
