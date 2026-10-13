import { AlertTriangle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "../../format";

// The hook is burned at the top of the clip in at most 2 lines: about 40 characters.
const HOOK_CHARS = 40;
// The backend's limit (HOOK_MAX_CHARS in app/api.py).
const HOOK_MAX = 200;
// Typing is saved once it pauses this long, and at once when the field is left.
const SAVE_AFTER_MS = 700;

/**
 * The Candidate's hook text, saved as it is typed. The draft is the field's own: saves coming back
 * never overwrite what is being typed. Key it by the Candidate's id.
 */
export function HookEditor({ value, onSave }: { value: string; onSave: (text: string) => void }) {
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

  const length = draft.trim().length;
  const long = length > HOOK_CHARS;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-hook`} className="text-sm font-medium">
        Hook text
      </label>
      <span id={`${id}-hint`} className="text-sm text-muted">
        Shown at the top for the first 3 seconds, in at most 2 lines.
      </span>
      <textarea
        id={`${id}-hook`}
        rows={2}
        value={draft}
        maxLength={HOOK_MAX}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save(text), SAVE_AFTER_MS);
        }}
        onBlur={() => save(draft)}
        aria-describedby={`${id}-hint ${id}-count`}
        className={cx(
          "w-full resize-y rounded-control border bg-surface-raised px-3.5 py-2.5 text-base text-text",
          long ? "border-accent" : "border-border",
        )}
      />
      <p id={`${id}-count`} className={cx("flex items-center gap-1.5 text-sm", long ? "text-accent-text" : "text-muted")}>
        {long && <AlertTriangle aria-hidden size={15} />}
        <span className="tabular-nums">
          {length}/{HOOK_CHARS}
        </span>
        {long && <span>characters: it may not fit in 2 lines on the video.</span>}
      </p>
    </div>
  );
}
