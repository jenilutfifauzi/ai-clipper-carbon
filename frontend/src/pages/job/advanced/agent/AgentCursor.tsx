import { useContext, useLayoutEffect, useRef, useState } from "react";
import { PresenceContext, usePresence, type PresenceState } from "./presence";

// What the cursor reads of the presence store, each on its own so that a flash doesn't draw it again.
const statusOf = (state: PresenceState) => state.status;
const labelOf = (state: PresenceState) => state.label;
const targetOf = (state: PresenceState) => state.target;

// Below the ruler, where the cursor waits before the Agent has touched anything.
const FIRST_ROW_PX = 32;

/**
 * The Agent's cursor on the Timeline (ADR 0029): an arrow and a pill naming the Agent Provider
 * ("thinking…" between tool calls), gliding to the item the Agent last changed. Laid over the tracks
 * (inside their scrolled content, so it scrolls with them), at its target's time `pps` pixels a
 * second from the labels' column, and at the top of the item's row as drawn. Nothing while idle.
 */
export function AgentCursor({ pps }: { pps: number }) {
  const store = useContext(PresenceContext);
  const status = usePresence(statusOf, "idle");
  const label = usePresence(labelOf, "");
  const target = usePresence(targetOf, null);
  const element = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(FIRST_ROW_PX);

  // The row is where the item is drawn: found by its id, else the Video Track for the Main Track's.
  useLayoutEffect(() => {
    const content = element.current?.parentElement;
    if (!content || !target) return;
    const item =
      content.querySelector<HTMLElement>(`[data-agent-id="${CSS.escape(target.id)}"]`) ??
      (target.kind === "segments" || target.kind === "transitions" ? content.querySelector<HTMLElement>("[data-track=video]") : null);
    if (item) setTop(item.getBoundingClientRect().top - content.getBoundingClientRect().top);
  }, [target, pps, status]);

  if (!store || status === "idle") return null;
  const x = (target?.time ?? 0) * pps;
  return (
    <div
      ref={element}
      aria-hidden
      className="pointer-events-none absolute top-0 z-20 transition-transform duration-180 ease-out will-change-transform motion-reduce:transition-none"
      style={{ left: "var(--track-label)", transform: `translate3d(${x}px, ${top}px, 0)` }}
    >
      <svg width="12" height="14" viewBox="0 0 12 14" className="-translate-x-px -translate-y-1 fill-accent stroke-bg drop-shadow-sm">
        <path d="M1 1 L11 7 L6 8 L4 13 Z" strokeWidth="1" strokeLinejoin="round" />
      </svg>
      <span className="ml-2.5 -mt-1 block w-max rounded-full bg-accent px-1.5 py-0.5 text-[11px] leading-none font-medium text-on-accent shadow-accent">
        {status === "thinking" ? `${label} · thinking…` : label}
      </span>
    </div>
  );
}
