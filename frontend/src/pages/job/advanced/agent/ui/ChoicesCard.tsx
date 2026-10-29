import { Check } from "lucide-react";
import type { ReactNode } from "react";
import type { AgentUi } from "../../../../../api";
import { cx } from "../../../../../format";
import { runs } from "../../../editor/emphasis";
import type { AgentUiHost } from "./GenerativeUi";

/**
 * Alternatives the Agent offers, one button each: a click sends its prompt as the owner's next
 * message. They are locked while a turn is on its way and once the Thread has gone on; the one whose
 * prompt the next turn sent is marked chosen. Locked too without a chat to send them (`host`).
 */
export function ChoicesCard({
  ui,
  nextPrompt,
  host,
}: {
  ui: Extract<AgentUi, { kind: "choices" }>;
  nextPrompt: string | null;
  host: AgentUiHost | null;
}) {
  const locked = !host || host.busy || nextPrompt !== null;
  return (
    <div data-agent-ui="choices" className="flex flex-col gap-1.5">
      {ui.title && <p className="px-1 text-sm font-medium text-pretty">{ui.title}</p>}
      {ui.options.map((option, index) => {
        const chosen = option.prompt === nextPrompt;
        return (
          <button
            key={index}
            type="button"
            disabled={locked}
            onClick={() => host?.choose(option.prompt)}
            className={cx(
              "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-focus",
              chosen ? "border-text/40 bg-fill" : "border-border",
              locked ? "cursor-default" : "hover:bg-fill",
              locked && !chosen && "text-muted",
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-pretty">{emphasized(option.label)}</span>
              {option.detail && <span className="text-xs text-pretty text-muted">{option.detail}</span>}
            </span>
            {chosen && (
              <>
                <Check aria-hidden size={14} className="mt-0.5 shrink-0 text-text" />
                <span className="sr-only">, chosen</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** `label` with its Emphasis (a hook's *words*) shown as Emphasis rather than as asterisks. */
export function emphasized(label: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const [open, close] of runs(label)) {
    parts.push(label.slice(from, open), <strong key={open} className="font-semibold text-text">{label.slice(open + 1, close)}</strong>);
    from = close + 1;
  }
  parts.push(label.slice(from));
  return parts.filter((part) => part !== "");
}
