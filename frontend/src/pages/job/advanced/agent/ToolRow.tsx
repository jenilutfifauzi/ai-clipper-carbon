import { Check, ChevronDown, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { AgentTurnPart } from "../../../../api";
import { cx } from "../../../../format";

export type ToolPart = Extract<AgentTurnPart, { type: "tool" }>;

type Detail = "input" | "output";

const MCP_PREFIX = /^mcp__.+?__/;

/** A tool's name as the owner reads it: without any `mcp__<server>__` prefix, underscores as spaces. */
export function toolLabel(tool: string): string {
  return tool.replace(MCP_PREFIX, "").replaceAll("_", " ");
}

/** A call's input or output as shown: JSON pretty-printed, anything else (text, a cut JSON) as it is. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * One tool call of an Agent Turn, as a card: a status dot (a spinner while it runs, then a check, or
 * a warning), its name and summary. It opens to show what the call was given and gave back, Output
 * first when there is one, and its error. A failed call starts open; one with nothing to show can't open.
 */
export function ToolRow({ part }: { part: ToolPart }) {
  // Null until the owner opens or closes it.
  const [chosenOpen, setOpen] = useState<boolean | null>(null);
  const [chosenDetail, setDetail] = useState<Detail | null>(null);
  const details = (["input", "output"] as const).filter((detail) => part[detail]);
  const expandable = details.length > 0 || !!part.error;
  const open = expandable && (chosenOpen ?? part.ok === false);
  const detail = chosenDetail && details.includes(chosenDetail) ? chosenDetail : details.includes("output") ? "output" : details[0];
  const state = part.ok === null ? "Running" : part.ok ? "Done" : "Failed";
  const StatusIcon = part.ok === null ? LoaderCircle : part.ok ? Check : TriangleAlert;
  return (
    <div data-tool-row="" className="rounded-lg border border-border bg-fill">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left enabled:cursor-pointer enabled:hover:bg-fill"
        onClick={() => setOpen(!open)}
      >
        <span
          role="img"
          aria-label={state}
          className={cx(
            "flex size-4 shrink-0 items-center justify-center rounded-full",
            part.ok === null ? "text-muted" : part.ok ? "bg-success/20 text-success" : "bg-danger/15 text-danger",
          )}
        >
          <StatusIcon aria-hidden size={12} className={part.ok === null ? "motion-safe:animate-spin" : undefined} />
        </span>
        <span className="shrink-0 text-xs font-medium">{toolLabel(part.tool)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{part.summary}</span>
        {expandable && (
          <ChevronDown aria-hidden size={12} className={cx("shrink-0 text-muted motion-safe:transition-transform", open && "rotate-180")} />
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
          {part.error && <p className="text-xs text-pretty break-words text-danger">{part.error}</p>}
          {details.length > 1 && <DetailSwitch value={detail} onChange={setDetail} />}
          {detail && (
            <pre aria-label={detail === "input" ? "Input" : "Output"} className="max-h-60 overflow-auto font-mono text-[11px] break-words whitespace-pre-wrap">
              {prettyJson(part[detail] ?? "")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Input or Output: a two-button segmented switch. */
function DetailSwitch({ value, onChange }: { value: Detail | undefined; onChange: (detail: Detail) => void }) {
  return (
    <div role="group" aria-label="Details" className="flex self-start rounded-md bg-fill p-0.5">
      {(["input", "output"] as const).map((detail) => (
        <button
          key={detail}
          type="button"
          aria-pressed={value === detail}
          className="cursor-pointer rounded px-2 py-0.5 text-[11px] font-medium text-muted hover:text-text aria-pressed:raised aria-pressed:text-text"
          onClick={() => onChange(detail)}
        >
          {detail === "input" ? "Input" : "Output"}
        </button>
      ))}
    </div>
  );
}
