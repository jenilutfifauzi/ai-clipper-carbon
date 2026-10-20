import { ChevronDown, Loader2, Mic, Square } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Button } from "../../../components/Button";
import { InfoTip } from "../../../components/InfoTip";
import { Select } from "../../../components/Select";
import { Switch } from "../../../components/Switch";
import { cx } from "../../../format";
import { FLOOR_DB } from "./ballistics";
import type { RecordingSettings } from "./recordingSettings";
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
export function TakeButton({ flow, atEnd = false, settings = null }: { flow: TakeFlow | null; atEnd?: boolean; settings?: RecordingSettings | null }) {
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
      {settings && <TakeSettingsButton settings={settings} busy={state.phase !== "idle"} />}
      {off && <span className="sr-only">{AT_END_HINT}</span>}
      {(recording || counting) && <LevelBar read={() => flow.mic?.meter.left.level ?? FLOOR_DB} />}
    </div>
  );
}

// How far along its bar `db` is, from 0 at FLOOR_DB to 1 at 0 dBFS.
const width = (db: number) => (db - FLOOR_DB) / -FLOOR_DB;

/**
 * The microphone's level (`read`, in dB, through the Meters' ballistics, which the recorder keeps):
 * drawn straight onto the bar on each frame, without a re-render. Beside the button while a Take
 * counts down or records, and in the settings as the test meter.
 */
function LevelBar({ read, className = "w-16" }: { read: () => number; className?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      if (bar.current) bar.current.style.clipPath = `inset(0 ${(1 - width(latest.current())) * 100}% 0 0)`;
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      role="img"
      aria-label="The microphone's level"
      title="The microphone's level"
      className={cx("relative h-1.5 overflow-hidden rounded-full bg-fill", className)}
    >
      <div ref={bar} className={cx("absolute inset-0", BAR_FILL)} style={{ clipPath: "inset(0 100% 0 0)" }} />
    </div>
  );
}

// The popover's distance from its chevron, and from the window's edges.
const GAP_PX = 4;
const EDGE_PX = 8;

/**
 * The chevron beside the mic button, and its popover of recording settings: the microphone, "Hear
 * the Clip (headphones)" and a test meter reading the chosen input while the popover is open. The
 * popover is in the top layer, as the Save audio menu's is; light dismiss and Escape close it. Off,
 * and closed, while a Take is under way (`busy`), which has the microphone.
 */
export function TakeSettingsButton({ settings, busy = false }: { settings: RecordingSettings; busy?: boolean }) {
  const read = () => settings.state;
  const state = useSyncExternalStore(settings.subscribe, read, read);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();

  // Open, the test meter reads the microphone; closed (by any means), it lets go of it.
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const toggled = (event: Event) => {
      const opened = (event as ToggleEvent).newState === "open";
      setOpen(opened);
      if (opened) void settings.openTest();
      else settings.closeTest();
    };
    element.addEventListener("toggle", toggled);
    const unwatch = settings.watch();
    return () => {
      element.removeEventListener("toggle", toggled);
      unwatch();
      settings.closeTest();
    };
  }, [settings]);

  const hide = () => {
    if (panel.current?.matches(":popover-open")) panel.current.hidePopover();
  };
  // A Take started (Shift+R, say) closes it.
  useEffect(() => {
    if (busy) hide();
  }, [busy]);

  function show() {
    const anchor = toggle.current?.getBoundingClientRect();
    const element = panel.current;
    if (!anchor || !element) return;
    element.showPopover();
    const left = Math.min(Math.max(anchor.right - element.offsetWidth, EDGE_PX), window.innerWidth - element.offsetWidth - EDGE_PX);
    // Over the transport, or under it where there is no room above.
    const above = anchor.top - GAP_PX - element.offsetHeight;
    const top = above < EDGE_PX ? anchor.bottom + GAP_PX : above;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(EDGE_PX, top)}px`;
  }

  // Escape closes the popover, and goes no further: not the editor's Esc (which would pick nothing).
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !panel.current?.matches(":popover-open")) return;
    event.stopPropagation();
    hide();
    toggle.current?.focus();
  }

  const options = [{ value: "", label: "Default" }, ...(state.inputs ?? []).map((input) => ({ value: input.deviceId, label: input.label }))];
  return (
    <div className="contents" onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        type="button"
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-label="Recording settings"
        title="Recording settings: the microphone, Hear the Clip and a test meter"
        onClick={() => (open ? hide() : show())}
        className="-ml-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50"
      >
        <ChevronDown aria-hidden size={16} />
      </button>
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-label="Recording settings"
        {...{ popover: "auto" }}
        className="glass fixed inset-auto m-0 w-72 flex-col gap-3 rounded-[10px] bg-bg/90! p-3 text-text [&:popover-open]:flex"
      >
        <Select label="Microphone" value={settings.deviceId ?? ""} options={options} onChange={(value) => settings.choose(value || null)} />
        <Switch checked={state.hearClip} onChange={(on) => settings.setHearClip(on)}>
          <span className="flex flex-col">
            <span className="text-sm font-medium">Hear the Clip (headphones)</span>
            <span className="text-xs text-muted">Its sound plays while you record. With speakers, leave it off: they would bleed into the microphone.</span>
          </span>
        </Switch>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Test</span>
          {state.error ? (
            <p role="alert" className="text-sm text-danger">
              Couldn't open the microphone: {state.error}
            </p>
          ) : (
            <LevelBar read={() => settings.testLevel()} className="w-full" />
          )}
        </div>
      </div>
    </div>
  );
}
