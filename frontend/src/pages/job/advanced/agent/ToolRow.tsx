import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import type { AgentTurnPart } from "../../../../api";

type ToolPart = Extract<AgentTurnPart, { type: "tool" }>;

const MCP_PREFIX = /^mcp__.+?__/;

/** A tool's name as the owner reads it: without any `mcp__<server>__` prefix, underscores as spaces. */
export function toolLabel(tool: string): string {
  return tool.replace(MCP_PREFIX, "").replaceAll("_", " ");
}

/** One tool call of an Agent Turn: a spinner while it runs, then a check, or a warning with its message. */
export function ToolRow({ part }: { part: ToolPart }) {
  const Icon = part.ok === null ? LoaderCircle : part.ok ? CircleCheck : TriangleAlert;
  return (
    <div data-tool-row="" className="flex items-start gap-2 rounded-[10px] bg-fill px-2.5 py-1.5 text-sm">
      <Icon
        aria-label={part.ok === null ? "Running" : part.ok ? "Done" : "Failed"}
        size={15}
        className={part.ok === null ? "mt-0.5 shrink-0 text-muted motion-safe:animate-spin" : part.ok ? "mt-0.5 shrink-0 text-success" : "mt-0.5 shrink-0 text-danger"}
      />
      <div className="flex min-w-0 flex-col">
        <span className="font-medium">{toolLabel(part.tool)}</span>
        {part.summary && <span className="text-xs text-pretty break-words text-muted">{part.summary}</span>}
        {part.error && <span className="text-xs text-pretty break-words text-danger">{part.error}</span>}
      </div>
    </div>
  );
}
