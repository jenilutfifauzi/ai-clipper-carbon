import { Loader2, Mic, Square } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "../../../components/Button";
import { InfoTip } from "../../../components/InfoTip";
import { cx } from "../../../format";
import { FLOOR_DB } from "./ballistics";
import { IDLE, type TakeFlow } from "./takeFlow";

const unsubscribed = () => () => {};

// Green to −12 dB, orange to −3 dB, red above, as the Meters' bars, left to right.
const BAR_FILL = "bg-[linear-gradient(to_right,var(--success)_80%,var(--accent)_80%_95%,var(--danger)_95%)]";

/** What the mic button says while it is off at the Clip's end. */
export const AT_END_HINT = "Move the playhead into the Clip to record a Voiceover: a Take from its end would never be heard";

/**
 * The mic button by the transport (GLOSSARY.md, Voiceover): it starts a Take at the playhead, counts
 * 3, 2, 1 (pressed again, or Esc, cancels), and while one records it reads Stop; from the countdown on
 * the microphone's level is beside it. Off while the playhead is `atEnd` of the Clip, with a hint.
 * With no `flow` (the page isn't a secure context, as on a phone over plain HTTP) there is no button:
 * a hint says how to add a voice memo instead.
 */
export function TakeButton({ flow, atEnd = false }: { flow: TakeFlow | null; atEnd?: boolean }) {
  const read = () => flow?.state ?? IDLE;
  const state = useSyncExternalStore(flow?.subscribe ?? unsubscribed, read, read);
  if (!flow) {
    return (
      <InfoTip label="Recording a Voiceover">
        Recording a Voiceover needs the microphone, which the browser gives only on a secure page, such as AI Clipper opened at localhost on
        its Mac. On a phone, record a voice memo, upload it in the Audio tab and mark its Music Clip Speech.
      </InfoTip>
    );
  }
  const recording = state.phase === "recording";
  const counting = state.phase === "countdown";
  const busy = state.phase === "opening" || state.phase === "uploading";
  const off = state.phase === "idle" && atEnd;
  const label = recording
    ? "Stop the Take"
    : counting
      ? `Recording in ${state.left}: cancel`
      : state.phase === "uploading"
        ? "Uploading the Take"
        : "Record a Voiceover";
  const title = recording
    ? "Stop the Take (Space or ⇧R)"
    : counting
      ? "Cancel the countdown (Esc or ⇧R)"
      : off
        ? AT_END_HINT
        : "Record a Voiceover from the playhead (⇧R): a three-second countdown, then the picture rolls, its sound silent";
  return (
    // The hint on the wrapper too: an off button takes no pointer, and so shows no title of its own.
    <div className="flex shrink-0 items-center gap-1.5" title={off ? AT_END_HINT : undefined}>
      <Button
        variant="ghost"
        size="icon"
        // Let go of, so that Space stops the Take through its key rather than pressing the button again.
        onClick={(event) => {
          event.currentTarget.blur();
          void flow.press();
        }}
        disabled={busy || off}
        aria-pressed={recording || counting}
        aria-label={label}
        aria-keyshortcuts="Shift+R"
        title={title}
        className={cx((recording || counting) && "text-danger hover:text-danger")}
      >
        {busy ? (
          <Loader2 aria-hidden size={18} className="motion-safe:animate-spin" />
        ) : recording ? (
          <Square aria-hidden size={16} fill="currentColor" />
        ) : counting ? (
          // 3, 2, 1, read out as it goes.
          <span aria-live="assertive" className="text-lg font-semibold tabular-nums">
            {state.left}
          </span>
        ) : (
          <Mic aria-hidden size={18} />
        )}
      </Button>
      {off && <span className="sr-only">{AT_END_HINT}</span>}
      {(recording || counting) && <TakeMeter flow={flow} />}
    </div>
  );
}

// How far along its bar `db` is, from 0 at FLOOR_DB to 1 at 0 dBFS.
const width = (db: number) => (db - FLOOR_DB) / -FLOOR_DB;

/**
 * The microphone's level while a Take records, through the Meters' ballistics (the recorder keeps
 * them): drawn straight onto the bar on each frame, without a re-render.
 */
function TakeMeter({ flow }: { flow: TakeFlow }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const level = flow.mic?.meter.left.level ?? FLOOR_DB;
      if (bar.current) bar.current.style.clipPath = `inset(0 ${(1 - width(level)) * 100}% 0 0)`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [flow]);
  return (
    <div role="img" aria-label="The microphone's level" title="The microphone's level" className="relative h-1.5 w-16 overflow-hidden rounded-full bg-fill">
      <div ref={bar} className={cx("absolute inset-0", BAR_FILL)} style={{ clipPath: "inset(0 100% 0 0)" }} />
    </div>
  );
}
