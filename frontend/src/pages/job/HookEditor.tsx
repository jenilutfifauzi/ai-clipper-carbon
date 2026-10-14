import { AlertTriangle, Highlighter } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Slider } from "../../components/Slider";
import { cx } from "../../format";

// The backend's limit (HOOK_MAX_CHARS in app/api.py).
const HOOK_MAX = 200;
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
  fit,
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
  // Of the text being previewed; null until it is planned.
  fit: HookFit | null;
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

  function edit(text: string) {
    setDraft(text);
    onDraft?.(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), SAVE_AFTER_MS);
  }

  // The selection, widened to whole words, and whether it is one Emphasis already.
  const field = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [from, to] = words(draft, selection);
  const marked = to - from > 1 && draft[from] === "*" && draft[to - 1] === "*";

  // Marks the selected words *like this*, or unmarks them.
  function toggleEmphasis() {
    const [start, end] = words(draft, selection);
    if (start === end) return;
    const inner = draft.slice(start, end).replaceAll("*", "");
    const replaced = marked ? inner : `*${inner}*`;
    edit(draft.slice(0, start) + replaced + draft.slice(end));
    const next: [number, number] = [start, start + replaced.length];
    setSelection(next);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(...next);
    });
  }

  const when = timing;
  const changeWhen = (change: Partial<HookTiming>) => onTiming({ ...when, ...change });
  const shownFor = Math.max(0, Math.min(when.hook_secs, duration - when.hook_start));

  const blank = draft.trim() === "";
  const long = !blank && fit?.fits === false;
  const lines = (count: number) => (count === 1 ? "1 line" : `${count} lines`);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-hook`} className="text-sm font-medium">
        Hook text
      </label>
      <span id={`${id}-hint`} className="text-sm text-muted">
        Words marked *like this* are in the Emphasis colour. Its look, lines, place and motion are in Style.
      </span>
      <div className="flex">
        <Button
          size="sm"
          className="aria-pressed:text-accent-text"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleEmphasis}
          disabled={from === to}
          aria-pressed={marked}
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
          <span>Too long for {lines(fit.max_lines)}: it will be set smaller on the video.</span>
        ) : fit ? (
          <span>Fits on {lines(fit.lines)}.</span>
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

// The range [start, end) widened to the whole words it touches (asterisks belong to their word).
function words(text: string, [start, end]: [number, number]): [number, number] {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  while (end < text.length && !/\s/.test(text[end])) end++;
  // A selection of nothing but spaces is no words.
  return text.slice(start, end).trim() ? [start, end] : [start, start];
}
