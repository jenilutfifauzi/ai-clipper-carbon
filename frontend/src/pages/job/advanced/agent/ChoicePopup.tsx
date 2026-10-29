import { CornerDownLeft, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { AgentUi } from "../../../../api";
import { cx } from "../../../../format";
import { choiceKey } from "./choices";
import { emphasized } from "./ui/ChoicesCard";

/**
 * The Agent's open choices as a pop up docked above the composer, Claude Code's: the options
 * numbered, then "Something else…" to type an answer. A digit sends its option, ↑ ↓ move the
 * highlight, Enter sends it, Escape closes (choiceKey). It takes the focus as it opens, but not on a
 * touch screen, where that would raise the keyboard; whoever closes it gives the focus back.
 */
export function ChoicePopup({
  ui,
  onChoose,
  onClose,
}: {
  ui: Extract<AgentUi, { kind: "choices" }>;
  onChoose: (prompt: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const other = useRef<HTMLInputElement>(null);
  // The options' list holds the focus, naming the highlighted one (aria-activedescendant).
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [text, setText] = useState("");
  const count = ui.options.length;

  useEffect(() => {
    if (!window.matchMedia?.("(pointer: coarse)").matches) list.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    // Typing an answer: its own keys, but for Escape, Enter (send it) and ↑ (back to the options).
    if (event.target === other.current && !["Escape", "Enter", "ArrowUp"].includes(event.key)) return;
    if (event.target === other.current && event.key === "Enter") {
      event.preventDefault();
      if (text.trim()) onChoose(text.trim());
      return;
    }
    const action = choiceKey({ active, count }, event.key);
    if (!action) return;
    event.preventDefault();
    if ("close" in action) onClose();
    else if ("send" in action) onChoose(ui.options[action.send].prompt);
    else if ("other" in action) {
      setActive(count);
      other.current?.focus();
    } else {
      setActive(action.active);
      if (action.active === count) other.current?.focus();
      else list.current?.focus();
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="mx-3 mb-2 flex max-h-[45%] min-h-0 shrink-0 flex-col gap-1 rounded-2xl border border-border bg-fill p-2 shadow-raised outline-none motion-safe:animate-[choice-in_200ms_cubic-bezier(0.32,0.72,0,1)]"
    >
      <div className="flex items-start gap-2 px-2 pt-1">
        <p id={`${id}-title`} className="flex-1 text-sm font-medium text-pretty">
          {ui.title ?? "Choose one"}
        </p>
        <button type="button" aria-label="Close" title="Close (Esc)" onClick={onClose} className="-m-1 rounded-md p-1 text-muted hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus">
          <X aria-hidden size={14} />
        </button>
      </div>
      <div
        ref={list}
        role="listbox"
        tabIndex={-1}
        aria-labelledby={`${id}-title`}
        aria-activedescendant={`${id}-option-${active}`}
        className="flex min-h-0 flex-col overflow-y-auto rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-text/40"
      >
        {ui.options.map((option, index) => (
          <div
            key={index}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={active === index}
            onPointerEnter={() => setActive(index)}
            onClick={() => onChoose(option.prompt)}
            className={cx("flex cursor-pointer gap-2 rounded-lg px-2 py-1.5 text-sm", active === index && "bg-fill")}
          >
            <span className={cx("w-4 shrink-0 text-right tabular-nums", active === index ? "text-text" : "text-muted")}>{index + 1}.</span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-pretty">{emphasized(option.label)}</span>
              {option.detail && <span className="text-xs text-pretty text-muted">{option.detail}</span>}
            </span>
            {active === index && <CornerDownLeft aria-hidden size={13} className="mt-0.5 shrink-0 text-muted" />}
          </div>
        ))}
        <div
          id={`${id}-option-${count}`}
          role="option"
          aria-selected={active === count}
          onPointerEnter={() => setActive(count)}
          onClick={() => other.current?.focus()}
          className={cx("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm", active === count && "bg-fill")}
        >
          <span className={cx("w-4 shrink-0 text-right tabular-nums", active === count ? "text-text" : "text-muted")}>{count + 1}.</span>
          <input
            ref={other}
            aria-label="Something else"
            placeholder="Something else…"
            value={text}
            onFocus={() => setActive(count)}
            onChange={(event) => setText(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-base caret-text outline-none placeholder:text-muted"
          />
        </div>
      </div>
      <p aria-hidden className="px-2 pb-0.5 text-xs text-muted">
        1–{count + 1} pick · ↑↓ · Enter send · Esc close
      </p>
    </div>
  );
}
