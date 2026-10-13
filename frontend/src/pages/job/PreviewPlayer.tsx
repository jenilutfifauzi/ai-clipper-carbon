import { Play, SkipForward } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "../../components/Button";

// How much of the ending "Play ending" plays.
const ENDING_SECS = 3;

/**
 * The Source, previewed between a Candidate's edges: "Play clip" plays it from its start and stops
 * at its end. Playback started anywhere inside the clip also stops at its end; outside it, the
 * player plays freely, to hear what comes before or after. When an edge moves, the player waits
 * at the new start, or just before the new end.
 */
export function PreviewPlayer({ src, start, end }: { src: string; start: number; end: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const range = useRef({ start, end });
  range.current = { start, end };
  const last = useRef<{ start: number; end: number } | null>(null);

  // Stop at the end, checked every frame (timeupdate comes only about 4 times a second).
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let frame = 0;
    let armed = false;
    const tick = () => {
      if (armed && element.currentTime >= range.current.end) {
        element.pause();
        element.currentTime = range.current.end;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      const { start, end } = range.current;
      armed = element.currentTime >= start - 0.05 && element.currentTime < end;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => cancelAnimationFrame(frame);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    const element = video.current;
    const before = last.current;
    last.current = { start, end };
    if (!element || !element.paused) return;
    if (before && before.start === start && before.end !== end) seek(Math.max(start, end - ENDING_SECS));
    else seek(start);
  }, [start, end]);

  function seek(time: number) {
    const element = video.current;
    if (element) element.currentTime = time;
  }

  function play(from: number) {
    seek(from);
    void video.current?.play();
  }

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={video}
        src={src}
        controls
        playsInline
        preload="metadata"
        className="aspect-video w-full rounded-control bg-black outline-1 -outline-offset-1 outline-white/10"
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => play(start)}>
          <Play aria-hidden size={18} />
          Play clip
        </Button>
        <Button onClick={() => play(Math.max(start, end - ENDING_SECS))}>
          <SkipForward aria-hidden size={18} />
          Play ending
        </Button>
      </div>
    </div>
  );
}
