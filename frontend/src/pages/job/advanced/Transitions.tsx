import { Trash2 } from "lucide-react";
import type { Transition, TransitionKind } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Slider } from "../../../components/Slider";
import { cx } from "../../../format";
import { DRAG_TRANSITION } from "./drag";

export const TRANSITIONS: { kind: TransitionKind; label: string }[] = [
  { kind: "fade", label: "Fade" },
  { kind: "fadeblack", label: "Dip to black" },
  { kind: "fadewhite", label: "Dip to white" },
  { kind: "slideleft", label: "Slide left" },
  { kind: "slideright", label: "Slide right" },
  { kind: "slideup", label: "Slide up" },
  { kind: "slidedown", label: "Slide down" },
  { kind: "wipeleft", label: "Wipe" },
  { kind: "zoomin", label: "Zoom in" },
  { kind: "circleopen", label: "Circle open" },
];

// How long a Transition can be (Transition.secs in backend/app/candidates.py), and a new one's length.
const SECS = { min: 0.2, max: 1.5 };
export const TRANSITION_SECS = 0.5;

/**
 * The Transitions: a card per kind, put on the selected join by a click (or dragged onto any join on
 * the timeline); and, when the join has one, its length and a way to remove it.
 */
export function TransitionPanel({
  transition,
  joined,
  kinds = true,
  onPick,
  onChange,
  onRemove,
}: {
  // The selected join's, if it has one.
  transition: Transition | null;
  // Whether a join is selected.
  joined: boolean;
  // Whether to show the kinds to pick from (the desktop's inspector leaves them to the Transitions tab).
  kinds?: boolean;
  onPick: (kind: TransitionKind) => void;
  onChange: (transition: Transition, group: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {!kinds && !transition && <Hint>Pick a transition in the Transitions tab.</Hint>}
      {kinds && (
        <>
          {joined ? (
            <Hint more="The two Segments overlap for its length, so the clip gets that much shorter.">Pick how one Segment gives way to the next.</Hint>
          ) : (
            <Hint more="Or drag a transition onto a join.">Select a join (the diamond) on the Video track.</Hint>
          )}
          <div className="grid grid-cols-2 gap-2">
            {TRANSITIONS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData(DRAG_TRANSITION, kind);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => joined && onPick(kind)}
                aria-pressed={transition?.kind === kind}
                // Without a join selected it can still be dragged onto one.
                aria-disabled={!joined}
                className={cx(
                  "raised flex min-h-12 items-center justify-center rounded-[10px] px-2 text-sm font-medium hover:bg-fill",
                  "focus-visible:outline-2 focus-visible:outline-focus",
                  !joined && "cursor-grab opacity-70",
                  transition?.kind === kind && "ring-2 ring-accent",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {transition && (
        <div className={cx("flex flex-col gap-3", kinds && "border-t border-border pt-4")}>
          {!kinds && <p className="text-sm font-medium">{TRANSITIONS.find((t) => t.kind === transition.kind)?.label}</p>}
          <Slider
            label="Length"
            value={transition.secs}
            min={SECS.min}
            max={SECS.max}
            step={0.05}
            format={(v) => `${v.toFixed(2)} s`}
            onChange={(secs) => onChange({ ...transition, secs }, `transition:${transition.after}`)}
          />
          <Button variant="ghost" onClick={onRemove} className="self-start">
            <Trash2 aria-hidden size={16} />
            Remove transition
          </Button>
        </div>
      )}
    </div>
  );
}
