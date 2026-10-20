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

/**
 * The mic button by the transport (GLOSSARY.md, Voiceover): it starts a Take at the playhead, and
 * while one records it reads Stop, with the microphone's level beside it. With no `flow` (the page
 * isn't a secure context, as on a phone over plain HTTP) there is no button: a hint says how to add a
 * voice memo instead.
 */
export function TakeButton({ flow }: { flow: TakeFlow | null }) {
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
  const busy = state.phase === "opening" || state.phase === "uploading";
  const label = recording ? "Stop the Take" : state.phase === "uploading" ? "Uploading the Take" : "Record a Voiceover";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        // Let go of, so that Space stops the Take through its key rather than pressing the button again.
        onClick={(event) => {
          event.currentTarget.blur();
          void flow.press();
        }}
        disabled={busy}
        aria-pressed={recording}
        aria-label={label}
        aria-keyshortcuts="Shift+R"
        title={recording ? "Stop the Take (Space or ⇧R)" : "Record a Voiceover from the playhead (⇧R): the picture rolls, its sound silent"}
        className={cx(recording && "text-danger hover:text-danger")}
      >
        {busy ? <Loader2 aria-hidden size={18} className="motion-safe:animate-spin" /> : recording ? <Square aria-hidden size={16} fill="currentColor" /> : <Mic aria-hidden size={18} />}
      </Button>
      {recording && <TakeMeter flow={flow} />}
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
