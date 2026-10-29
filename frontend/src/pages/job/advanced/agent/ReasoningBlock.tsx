import { Brain, ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { thoughtLabel } from "./status";

/**
 * The Agent's thoughts, folded: "Thinking…" with a spinner while they stream (the last part of a
 * running turn), then how long that took, "Thought for 4s" (open-pencil's), timed here; "Thought"
 * for one seen only finished, from the history. Open while streaming and closed once done; the
 * owner can open or close it either way.
 */
export function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const started = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (streaming) started.current ??= performance.now();
    else if (started.current !== null) setSeconds((performance.now() - started.current) / 1000);
  }, [streaming]);
  return (
    <details open={streaming} className="group/reasoning rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted select-none hover:bg-fill hover:text-text [&::-webkit-details-marker]:hidden">
        <Brain aria-hidden size={14} className="shrink-0 text-muted" />
        <span className="flex-1">{streaming ? "Thinking…" : thoughtLabel(seconds)}</span>
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
