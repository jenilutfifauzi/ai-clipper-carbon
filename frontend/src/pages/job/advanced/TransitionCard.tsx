import { useEffect, useRef, type CSSProperties } from "react";
import type { TransitionKind } from "../../../api";
import { cx } from "../../../format";
import { showLook, TRANSITIONS, type LayerLook } from "../editor/transitions";
import { DRAG_TRANSITION } from "./drag";

// The moment a card rests at, where mid-way reads badly: before a dip's or a crop's middle, which is
// all colour, and before a Spin's, where its one turn has both pictures upside down rather than turning.
const CARD_MOMENTS: Partial<Record<TransitionKind, number>> = { fadeblack: 0.3, fadewhite: 0.3, circlecrop: 0.3, rectcrop: 0.3, spin: 0.35 };
const restingAt = (kind: TransitionKind) => CARD_MOMENTS[kind] ?? 0.5;

// A hovered card plays its kind over this long, then holds the incoming picture until the loop's end.
const PLAY_MS = 1200;
const LOOP_MS = 1600;

// The kind's look `progress` of the way through, as the preview draws it: the only call to `look` here.
const cardLook = (kind: TransitionKind) => (progress: number) => TRANSITIONS[kind].look(progress);

// The sample pictures, drawn in CSS: a cool one with a round figure going out, a warm striped one coming in.
const OUTGOING: CSSProperties = {
  background: "radial-gradient(circle at 38% 46%, #eef4ff 0 17%, transparent 18%), linear-gradient(165deg, #4f8df5, #1d3a8a)",
};
const INCOMING: CSSProperties = { background: "repeating-linear-gradient(135deg, #f7b538 0 10%, #e4572e 10% 20%)" };

const styleOf = (look: LayerLook): CSSProperties => ({ ...look });
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * A Transition kind's card in the Transitions tab: the two sample pictures held part-way through the
 * kind by its look, playing it in a loop while a mouse is over it (unless motion is reduced). Applied
 * by a click, or dragged onto a join; disabled where the Clip has no cut.
 */
export function TransitionCard({ kind, current, disabled, onPick }: { kind: TransitionKind; current: boolean; disabled: boolean; onPick: () => void }) {
  const outgoing = useRef<HTMLDivElement>(null);
  const incoming = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const look = cardLook(kind);
  const resting = look(restingAt(kind));

  function show(progress: number) {
    const shown = look(progress);
    if (outgoing.current) showLook(shown.outgoing, outgoing.current);
    if (incoming.current) showLook(shown.incoming, incoming.current);
    if (veil.current) showLook(shown.veil, veil.current);
  }
  function play() {
    if (disabled || reducedMotion()) return;
    cancelAnimationFrame(frame.current);
    // From the resting moment on, so the picture doesn't jump.
    const began = performance.now() - restingAt(kind) * PLAY_MS;
    const step = (now: number) => {
      show(Math.min(1, ((now - began) % LOOP_MS) / PLAY_MS));
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }
  function rest() {
    cancelAnimationFrame(frame.current);
    show(restingAt(kind));
  }
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return (
    <button
      type="button"
      data-kind={kind}
      draggable={!disabled}
      disabled={disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TRANSITION, kind);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onPick}
      // Hover is a mouse's: a touch's pointer leaves as it lifts.
      onPointerEnter={(event) => event.pointerType === "mouse" && play()}
      onPointerLeave={rest}
      aria-pressed={current}
      className={cx(
        "raised flex flex-col gap-1.5 rounded-[10px] p-1.5 text-left text-xs font-medium hover:bg-fill",
        "focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50",
        current && "ring-2 ring-accent",
      )}
    >
      {/* Through black where a kind goes through it (Iris, Box). */}
      <div aria-hidden className="relative isolate aspect-video w-full overflow-hidden rounded-md bg-black">
        <div ref={incoming} data-layer="incoming" className="absolute inset-0" style={styleOf(resting.incoming)}>
          <div className="absolute inset-0" style={INCOMING} />
        </div>
        <div ref={outgoing} data-layer="outgoing" className="absolute inset-0" style={styleOf(resting.outgoing)}>
          <div className="absolute inset-0" style={OUTGOING} />
        </div>
        <div ref={veil} data-layer="veil" className="pointer-events-none absolute inset-0" style={styleOf(resting.veil)} />
      </div>
      <span className="truncate px-0.5">{TRANSITIONS[kind].label}</span>
    </button>
  );
}
