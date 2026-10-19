import { Trash2 } from "lucide-react";
import type { Transition, TransitionKind, TransitionSound } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Hint } from "../../../components/InfoTip";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { cx } from "../../../format";
import { TRANSITION_GROUPS, TRANSITION_KINDS, TRANSITIONS } from "../editor/transitions";
import { DRAG_TRANSITION } from "./drag";

// How long a Transition can be (TRANSITION_SECS in backend/app/candidates.py), and a new one's length.
export const TRANSITION_BOUNDS = { min: 0.1, max: 3 };
export const TRANSITION_SECS = 0.5;

// The Transitions tab's sections: each group with its kinds, any with none yet left out.
const SECTIONS = TRANSITION_GROUPS.map((group) => ({ group, kinds: TRANSITION_KINDS.filter((kind) => TRANSITIONS[kind].group === group) })).filter(
  ({ kinds }) => kinds.length,
);

// How a Transition's sound crosses (TransitionSound in backend/app/candidates.py).
const SOUNDS = [
  { value: "linear", label: "Linear" },
  { value: "equal_power", label: "Equal power" },
  { value: "cut", label: "Cut" },
] as const;

/**
 * The Transitions: a card per kind, by group under a sticky heading, put on the selected join by a
 * click (or dragged onto any join on the timeline); and, when the join has one, its length, its
 * strength and colour where its kind reads them, its sound and a way to remove it.
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
  // The picked join's kind: the knobs it reads, each with its own value.
  const own = transition ? TRANSITIONS[transition.kind] : null;
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
          {SECTIONS.map(({ group, kinds }) => (
            <section key={group} aria-labelledby={`transitions-${group}`} className="flex flex-col gap-2">
              {/* Over the kinds while they scroll by, in the Asset Panel or the phone's sheet. */}
              <h3 id={`transitions-${group}`} className="sticky top-0 z-10 bg-surface/90 py-1 text-xs font-semibold tracking-wide text-muted uppercase backdrop-blur">
                {group}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {kinds.map((kind) => (
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
            </section>
          ))}
        </>
      )}
      {transition && (
        <div className={cx("flex flex-col gap-3", kinds && "border-t border-border pt-4")}>
          {!kinds && <p className="text-sm font-medium">{TRANSITIONS[transition.kind].label}</p>}
          <Slider
            label="Length"
            value={transition.secs}
            min={TRANSITION_BOUNDS.min}
            max={TRANSITION_BOUNDS.max}
            step={0.05}
            format={(v) => `${v.toFixed(2)} s`}
            onChange={(secs) => onChange({ ...transition, secs }, `transition:${transition.after}`)}
          />
          {own?.strength !== undefined && (
            <Slider
              label="Strength"
              value={transition.strength ?? own.strength}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(strength) => onChange({ ...transition, strength }, `transition:${transition.after}:strength`)}
            />
          )}
          {own?.colour !== undefined && (
            <ColorField
              label="Colour"
              value={transition.colour ?? own.colour}
              onChange={(colour) => onChange({ ...transition, colour }, `transition:${transition.after}:colour`)}
            />
          )}
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
