import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, type HookFit } from "../../api";
import { Slider } from "../../components/Slider";
import { cx } from "../../format";

// The backend's limit (HOOK_MAX_CHARS in app/api.py).
const HOOK_MAX = 200;
// Typing is saved once it pauses this long, and at once when the field is left.
const SAVE_AFTER_MS = 700;
// Whether the text fits the hook's 2 lines is asked once typing pauses this long.
const FIT_AFTER_MS = 250;

export interface HookTiming {
  hook_start: number;
  hook_secs: number;
}

/**
 * The Candidate's hook text, saved as it is typed, and when it shows. The drafts are the editor's
 * own: saves coming back never overwrite what is being changed. Key it by the Candidate's id.
 */
export function HookEditor({
  value,
  onSave,
  onDraft,
  timing,
  duration,
  onTiming,
}: {
  value: string;
  onSave: (text: string) => void;
  // Each change as it is typed, before it is saved: for the preview.
  onDraft?: (text: string) => void;
  // As shown (saved or a draft); the editor that owns it saves changes.
  timing: HookTiming;
  // The Clip's length: the hook is kept in it.
  duration: number;
  onTiming: (timing: HookTiming) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const saved = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function save(text: string) {
    clearTimeout(timer.current);
    // The backend collapses whitespace; compare the same way so a trailing space isn't a change.
    if (text.split(/\s+/).join(" ").trim() === saved.current) return;
    saved.current = text.split(/\s+/).join(" ").trim();
    onSave(text);
  }

  // Leaving the Candidate (unmount) saves what was typed.
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => () => save(latest.current), []);

  // The backend lays the hook out as the render will, with the font's own widths.
  const [fit, setFit] = useState<HookFit | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const wait = setTimeout(() => {
      api.hookFit(draft, controller.signal).then(setFit, () => setFit(null));
    }, FIT_AFTER_MS);
    return () => {
      clearTimeout(wait);
      controller.abort();
    };
  }, [draft]);

  const when = timing;
  const changeWhen = (change: Partial<HookTiming>) => onTiming({ ...when, ...change });
  const shownFor = Math.max(0, Math.min(when.hook_secs, duration - when.hook_start));

  const blank = draft.trim() === "";
  const long = !blank && fit?.fits === false;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-hook`} className="text-sm font-medium">
        Hook text
      </label>
      <span id={`${id}-hint`} className="text-sm text-muted">
        In at most 2 lines. Where it sits and how it moves are in Style.
      </span>
      <textarea
        id={`${id}-hook`}
        rows={2}
        value={draft}
        maxLength={HOOK_MAX}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          onDraft?.(text);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save(text), SAVE_AFTER_MS);
        }}
        onBlur={() => save(draft)}
        aria-describedby={`${id}-hint ${id}-count`}
        className={cx(
          "w-full resize-y rounded-control border bg-fill px-3.5 py-2.5 text-base text-text",
          long ? "border-accent" : "border-border",
        )}
      />
      <p
        id={`${id}-count`}
        aria-live="polite"
        className={cx("flex items-center gap-1.5 text-sm", long ? "text-accent-text" : "text-muted")}
      >
        {long && <AlertTriangle aria-hidden size={15} />}
        {blank ? (
          <span>No hook: the clip opens without one.</span>
        ) : long ? (
          <span>Too long for 2 lines: it will be set smaller on the video.</span>
        ) : fit ? (
          <span>Fits on {fit.lines.length === 1 ? "1 line" : "2 lines"}.</span>
        ) : null}
      </p>
      <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Slider
          label="Comes on at"
          value={Math.min(when.hook_start, Math.max(0, duration - 0.5))}
          min={0}
          max={Math.max(0.5, duration - 0.5)}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={(hook_start) => changeWhen({ hook_start })}
        />
        <Slider
          label="Stays for"
          value={when.hook_secs}
          min={0.5}
          max={Math.min(30, Math.max(0.5, duration))}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s${v > shownFor + 0.05 ? ` (${shownFor.toFixed(1)} s in the clip)` : ""}`}
          onChange={(hook_secs) => changeWhen({ hook_secs })}
        />
      </div>
      {when.hook_start > 0 && !blank && (
        <p className="flex items-center gap-1.5 text-sm text-accent-text">
          <AlertTriangle aria-hidden size={15} />
          Not on the first frame, which the platforms show before the clip plays.
        </p>
      )}
    </div>
  );
}
