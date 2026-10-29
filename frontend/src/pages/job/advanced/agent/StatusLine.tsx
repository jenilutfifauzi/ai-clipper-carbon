import { useEffect, useRef, useState } from "react";
import { ThinkingOrb } from "./ThinkingOrb";

/**
 * What the Agent is doing while its turn runs, Claude Code style: the thinking orb turning, the
 * label (agentStatus) with a shimmer sweeping it, and how long the turn has run, from its second
 * second. The label is announced as it changes; the orb and the time are not, so they aren't read
 * out every tick. Without motion (prefers-reduced-motion) the orb stands still and the label is plain.
 */
export function StatusLine({ label }: { label: string }) {
  const started = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    started.current ??= performance.now();
    const tick = setInterval(() => setSeconds(Math.floor((performance.now() - started.current!) / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div role="status" aria-live="polite" data-agent-status="" className="flex items-center gap-2 px-1 text-sm">
      <ThinkingOrb size={18} className="shrink-0" />
      <span className="text-muted motion-safe:shimmer">{label}</span>
      {seconds >= 1 && (
        <span aria-hidden className="text-xs text-muted tabular-nums">
          ({elapsed(seconds)})
        </span>
      )}
    </div>
  );
}

// "12s", or from a minute on "1m 05s".
function elapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
