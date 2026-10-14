import { AlertTriangle, Highlighter } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Slider } from "../../components/Slider";
import { cx } from "../../format";
import { inEmphasis, toggledEmphasis, wholeWords } from "./editor/emphasis";

// The backend's limits (HOOK_MAX_CHARS and KICKER_MAX_CHARS in app/candidates.py).
export const HOOK_MAX = 200;
export const KICKER_MAX = 24;
// Typing is saved once it pauses this long, and at once when the field is left.
const SAVE_AFTER_MS = 700;
const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘B" : "Ctrl+B";

// How the Preview Plan sets the hook: how many lines, how many its style allows, and whether they
// fit at its size (the render sets them smaller when they don't).
export interface HookFit {
  lines: number;
  max_lines: number;
  fits: boolean;
}

export interface HookTiming {
  hook_start: number;
  hook_secs: number;
}

/**
 * The Candidate's hook text and Kicker, saved as they are typed. The drafts are the editor's own:
 * saves coming back never overwrite what is being changed. Key it by the Candidate's id.
 */
export function HookEditor({
  value,
  onSave,
  onDraft,
  kicker,
  onKickerSave,
  onKickerDraft,
  fit,
}: {
  value: string;
  onSave: (text: string) => void;
  // Each change as it is typed, before it is saved: for the preview.
  onDraft?: (text: string) => void;
  kicker: string;
  onKickerSave: (text: string) => void;
  onKickerDraft?: (text: string) => void;
  // Of the text being previewed; null until it is planned.
  fit: HookFit | null;
}) {
  const id = useId();
  const [draft, edit, save] = useTypedText(value, onSave, onDraft);
  const [kickerDraft, editKicker, saveKicker] = useTypedText(kicker, onKickerSave, onKickerDraft);

  const field = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  // The selection, widened to whole words, and whether it is inside an Emphasis.
  const [from, to] = wholeWords(draft, selection);
  const emphasised = inEmphasis(draft, selection);

  // Unmarks the Emphasis the selected words are in, or marks them *like this*.
  function toggleEmphasis() {
    const toggled = toggledEmphasis(draft, selection);
    if (!toggled) return;
    edit(toggled.text);
    setSelection(toggled.selection);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(...toggled.selection);
    });
  }

  const blank = draft.trim() === "";
  const long = !blank && fit?.fits === false;
  const lines = (count: number) => (count === 1 ? "1 line" : `${count} lines`);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="mb-3 flex flex-col gap-1.5">
        <label htmlFor={`${id}-kicker`} className="text-sm font-medium">
          Kicker
        </label>
        <span id={`${id}-kicker-hint`} className="text-sm text-muted">
          A word or two in a pill above the hook, such as FAKTA. Empty for none.
        </span>
        <div className="relative">
          <input
            id={`${id}-kicker`}
            type="text"
            value={kickerDraft}
            maxLength={KICKER_MAX}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => editKicker(event.target.value)}
            onBlur={() => saveKicker(kickerDraft)}
            aria-describedby={`${id}-kicker-hint`}
            className="min-h-11 w-full rounded-control border border-border bg-fill py-2 pr-16 pl-3.5 text-base text-text"
          />
          <span aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm text-muted tabular-nums">
            {kickerDraft.length}/{KICKER_MAX}
          </span>
        </div>
      </div>
      <label htmlFor={`${id}-hook`} className="text-sm font-medium">
        Hook text
      </label>
      <span id={`${id}-hint`} className="text-sm text-muted">
        Words marked *like this* are in the Emphasis colour.
      </span>
      <div className="flex">
        <Button
          size="sm"
          className="aria-pressed:text-accent-text"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleEmphasis}
          disabled={from === to}
          aria-pressed={emphasised}
          title={`Emphasise the selected words (${SHORTCUT})`}
        >
          <Highlighter aria-hidden size={15} />
          Emphasis
        </Button>
      </div>
      <textarea
        ref={field}
        id={`${id}-hook`}
        rows={2}
        value={draft}
        maxLength={HOOK_MAX}
        spellCheck={false}
        onChange={(event) => edit(event.target.value)}
        onSelect={(event) => setSelection([event.currentTarget.selectionStart, event.currentTarget.selectionEnd])}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
            event.preventDefault();
            toggleEmphasis();
          }
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
          <span>Too long for {lines(fit.max_lines)}: it will be set smaller on the video. Allow more lines in More options.</span>
        ) : fit ? (
          <span>Fits on {lines(fit.lines)}.</span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * When the hook shows: from when, and for how long, kept in the Clip. `blank` is whether the hook
 * text is empty (then nothing shows, so nothing is warned of).
 */
export function HookTimingFields({
  timing,
  duration,
  onTiming,
  blank,
}: {
  // As shown (saved or a draft); the editor that owns it saves changes.
  timing: HookTiming;
  // The Clip's length: the hook is kept in it.
  duration: number;
  onTiming: (timing: HookTiming) => void;
  blank: boolean;
}) {
  const when = timing;
  const changeWhen = (change: Partial<HookTiming>) => onTiming({ ...when, ...change });
  const shownFor = Math.max(0, Math.min(when.hook_secs, duration - when.hook_start));
  return (
    <>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
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
    </>
  );
}

/**
 * Text saved as it is typed: once typing pauses, when the field is left (call `save`), and when the
 * editor unmounts. Returns the draft, the change handler and `save`.
 */
function useTypedText(
  value: string,
  onSave: (text: string) => void,
  onDraft?: (text: string) => void,
): [string, (text: string) => void, (text: string) => void] {
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

  function edit(text: string) {
    setDraft(text);
    onDraft?.(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), SAVE_AFTER_MS);
  }

  return [draft, edit, save];
}
