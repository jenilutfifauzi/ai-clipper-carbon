import { Brain, ChevronDown, LoaderCircle } from "lucide-react";

/**
 * The Agent's thoughts, folded: "Thinking…" with a spinner while they stream (the last part of a
 * running turn), "Thought" after. Open while streaming and closed once done; the owner can open or
 * close it either way.
 */
export function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <details open={streaming} className="group/reasoning rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted select-none hover:bg-fill hover:text-text [&::-webkit-details-marker]:hidden">
        <Brain aria-hidden size={14} className="shrink-0 text-accent-text" />
        <span className="flex-1">{streaming ? "Thinking…" : "Thought"}</span>
        {streaming ? (
          <LoaderCircle aria-hidden size={12} className="shrink-0 motion-safe:animate-spin" />
        ) : (
          <ChevronDown aria-hidden size={12} className="shrink-0 motion-safe:transition-transform group-open/reasoning:rotate-180" />
        )}
      </summary>
      <p className="border-t border-border px-2 py-1.5 text-xs text-pretty break-words whitespace-pre-wrap text-muted">{text}</p>
    </details>
  );
}
