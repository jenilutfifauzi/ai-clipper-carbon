import { Trash2 } from "lucide-react";
import type { Transition, TransitionKind, TransitionSound } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { cx } from "../../../format";
import { TRANSITION_KINDS, TRANSITIONS } from "../editor/transitions";
import { DRAG_TRANSITION } from "./drag";

// How long a Transition can be (Transition.secs in backend/app/candidates.py), and a new one's length.
const SECS = { min: 0.2, max: 1.5 };
export const TRANSITION_SECS = 0.5;

// How a Transition's sound crosses (TransitionSound in backend/app/candidates.py).
const SOUNDS = [
  { value: "linear", label: "Linear" },
  { value: "equal_power", label: "Equal power" },
  { value: "cut", label: "Cut" },
] as const;

/**
 * The Transitions: a card per kind, put on the selected join by a click (or dragged onto any join on
 * the timeline); and, when the join has one, its length, its sound and a way to remove it.
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
  onChange: (transition: Transition, group?: string) => void;
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
            {TRANSITION_KINDS.map((kind) => (
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
                {TRANSITIONS[kind].label}
              </button>
            ))}
          </div>
        </>
      )}
      {transition && (
        <div className={cx("flex flex-col gap-3", kinds && "border-t border-border pt-4")}>
          {!kinds && <p className="text-sm font-medium">{TRANSITIONS[transition.kind].label}</p>}
          <Slider
            label="Length"
            value={transition.secs}
            min={SECS.min}
            max={SECS.max}
            step={0.05}
            format={(v) => `${v.toFixed(2)} s`}
            onChange={(secs) => onChange({ ...transition, secs }, `transition:${transition.after}`)}
          />
          <Segmented
            legend="Sound"
            options={SOUNDS}
            value={transition.sound ?? "linear"}
            // Each choice its own step of undo.
            onChange={(sound: TransitionSound) => onChange({ ...transition, sound })}
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
