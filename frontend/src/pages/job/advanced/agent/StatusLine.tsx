import { useEffect, useRef, useState } from "react";

// Claude Code's spinner, a glyph that grows and turns; one frame each FRAME_MS.
const FRAMES = ["·", "✢", "✳", "✶", "✻", "✽"];
const FRAME_MS = 120;

/**
 * What the Agent is doing while its turn runs, Claude Code style: a turning glyph, the label
 * (agentStatus) with a shimmer sweeping it, and how long the turn has run, from its second second.
 * The label is announced as it changes; the glyph and the time are not, so they aren't read out
 * every tick. Without motion (prefers-reduced-motion) the glyph stands still and the label is plain.
 */
export function StatusLine({ label }: { label: string }) {
  const started = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [frame, setFrame] = useState(4);

  useEffect(() => {
    started.current ??= performance.now();
    const tick = setInterval(() => setSeconds(Math.floor((performance.now() - started.current!) / 1000)), 1000);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const turn = still ? undefined : setInterval(() => setFrame((at) => (at + 1) % FRAMES.length), FRAME_MS);
    return () => {
      clearInterval(tick);
      clearInterval(turn);
    };
  }, []);

  return (
    <div role="status" aria-live="polite" data-agent-status="" className="flex items-center gap-2 px-1 text-sm">
      <span aria-hidden className="w-3 shrink-0 text-center text-muted">
        {FRAMES[frame]}
      </span>
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
