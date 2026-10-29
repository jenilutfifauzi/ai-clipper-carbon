import { ChevronDown, ListChecks } from "lucide-react";
import { toolLabel, ToolRow, type ToolPart } from "./ToolRow";

// Runs up to this long stay as cards; longer ones fold all but the latest call into "N steps".
const INLINE_CALLS = 3;

/**
 * A run of consecutive tool calls in a turn. A short run is its cards; a longer one is a dashed row
 * ("N steps", their names, how many failed) that opens to the earlier cards, above the latest card.
 */
export function ToolGroup({ parts }: { parts: ToolPart[] }) {
  if (parts.length <= INLINE_CALLS) {
    return (
      <div className="flex flex-col gap-1.5">
        {parts.map((part) => (
          <ToolRow key={part.call} part={part} />
        ))}
      </div>
    );
  }
  const earlier = parts.slice(0, -1);
  const latest = parts[parts.length - 1];
  const failed = earlier.filter((part) => part.ok === false).length;
  const steps = `${earlier.length} steps`;
  return (
    <div className="flex flex-col gap-1.5">
      <details data-tool-group="" className="group/steps rounded-lg border border-dashed border-border">
        <summary
          aria-label={failed ? `${steps}, ${failed} failed` : steps}
          className="flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-muted select-none hover:bg-fill hover:text-text [&::-webkit-details-marker]:hidden"
        >
          <ListChecks aria-hidden size={14} className="shrink-0 text-accent-text" />
          <span aria-hidden className="shrink-0 font-medium">
            {steps}
          </span>
          <span aria-hidden className="min-w-0 flex-1 truncate">
            {earlier.map((part) => toolLabel(part.tool)).join(" · ")}
          </span>
          {failed > 0 && (
            <span aria-hidden className="shrink-0 rounded-full bg-danger/15 px-1.5 text-danger">
              {failed} failed
            </span>
          )}
          <ChevronDown aria-hidden size={12} className="shrink-0 motion-safe:transition-transform group-open/steps:rotate-180" />
        </summary>
        <div className="flex flex-col gap-1.5 px-1.5 pb-1.5">
          {earlier.map((part) => (
            <ToolRow key={part.call} part={part} />
          ))}
        </div>
      </details>
      <ToolRow key={latest.call} part={latest} />
    </div>
  );
}
