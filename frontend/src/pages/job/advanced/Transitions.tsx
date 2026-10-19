import { Copy, Dices, Shuffle, Trash2 } from "lucide-react";
import type { JoinTransition, Transition, TransitionKind, TransitionSound } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Hint } from "../../../components/InfoTip";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { cx } from "../../../format";
import { KINDS_BY_GROUP, TRANSITIONS } from "../editor/transitions";
import { TransitionFilters } from "../editor/TransitionFilters";
import { TransitionCard } from "./TransitionCard";

// How long a Transition can be, and a new one's length (TRANSITION_SECS and TRANSITION_DEFAULT_SECS in
// backend/app/transition_kinds.py).
export const TRANSITION_BOUNDS = { min: 0.1, max: 3 };
export const TRANSITION_DEFAULT_SECS = 0.5;

// How a Transition's sound crosses (TransitionSound in backend/app/transition_kinds.py).
export const SOUNDS = [
  { value: "linear", label: "Linear" },
  { value: "equal_power", label: "Equal power" },
  { value: "cut", label: "Cut" },
] as const;

/**
 * The Transitions: a card per kind, by group under a sticky heading, put by a click on the selected
 * join or else the one nearest the playhead (or dragged onto any join on the timeline); and, when
 * the join has one, its length, its strength and colour where its kind reads them, its sound and a
 * way to remove it. A Random card puts a kind picked at random the same way; and while any join has
 * one, actions on every join (from the picked join's: Apply to all, Randomise all; and Remove from
 * all), which a locked Video Track disables with the Random card.
 */
export function TransitionPanel({
  transition,
  joined,
  cuts = true,
  kinds = true,
  any = false,
  locked = false,
  onPick,
  onChange,
  onRemove,
  onRandom,
  onApplyAll,
  onRandomiseAll,
  onRemoveAll,
}: {
  // The selected join's, if it has one.
  transition: Transition | null;
  // Whether a join is selected.
  joined: boolean;
  // Whether the Clip has a join at all (more than one Segment); without one the cards are disabled.
  cuts?: boolean;
  // Whether to show the kinds to pick from (the desktop's inspector leaves them to the Transitions tab).
  kinds?: boolean;
  // A card clicked: its kind for the selected join, else the one nearest the playhead.
  onPick: (kind: TransitionKind) => void;
  onChange: (transition: Transition, group?: string) => void;
  onRemove: () => void;
  // Whether any join of the Clip has a Transition.
  any?: boolean;
  // Whether the Video Track is locked, which disables the Random card and the actions on every join.
  locked?: boolean;
  // The Random card clicked: a random kind for the join a card's click goes to.
  onRandom?: () => void;
  onApplyAll?: () => void;
  onRandomiseAll?: () => void;
  onRemoveAll?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {!kinds && !transition && <Hint>Pick a transition in the Transitions tab.</Hint>}
      {kinds && (
        <>
          {!cuts ? (
            <Hint more="Split the clip into Segments, and each join between two can have one.">A transition needs a cut.</Hint>
          ) : joined ? (
            <Hint more="The two Segments overlap for its length, so the clip gets that much shorter.">Pick how one Segment gives way to the next.</Hint>
          ) : (
            <Hint more="Or drag one onto a join (a diamond on the Video track).">A transition goes on the join nearest the playhead.</Hint>
          )}
          {/* Pixelize's filters, for its card. */}
          <TransitionFilters />
          {onRandom && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-random
                disabled={!cuts || locked}
                onClick={onRandom}
                className={cx(
                  "raised flex flex-col gap-1.5 rounded-[10px] p-1.5 text-left text-xs font-medium hover:bg-fill",
                  "focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <div aria-hidden className="grid aspect-video w-full place-items-center rounded-md bg-fill text-muted">
                  <Dices size={24} />
                </div>
                <span className="truncate px-0.5">Random</span>
              </button>
            </div>
          )}
          {KINDS_BY_GROUP.map(({ group, kinds }) => (
            <section key={group} aria-labelledby={`transitions-${group}`} className="flex flex-col gap-2">
              {/* Over the kinds while they scroll by, in the Asset Panel or the phone's sheet. */}
              <h3 id={`transitions-${group}`} className="sticky top-0 z-10 [background:linear-gradient(var(--surface),var(--surface)),var(--bg)] py-1 text-xs font-semibold tracking-wide text-muted uppercase">
                {group}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {kinds.map((kind) => (
                  <TransitionCard key={kind} kind={kind} current={transition?.kind === kind} disabled={!cuts} onPick={() => onPick(kind)} />
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
          <TransitionKnobFields
            transition={transition}
            // A drag of a slider one step of undo; each choice of sound its own.
            onChange={(next, knob) => (knob ? onChange(next, `transition:${transition.after}:${knob}`) : onChange(next))}
          />
          <Button variant="ghost" onClick={onRemove} className="self-start">
            <Trash2 aria-hidden size={16} />
            Remove transition
          </Button>
        </div>
      )}
      {any && onRemoveAll && (
        <div className="flex flex-col items-start gap-2 border-t border-border pt-4">
          {transition && onApplyAll && (
            <Button variant="ghost" disabled={locked} onClick={onApplyAll}>
              <Copy aria-hidden size={16} />
              Apply to all joins
            </Button>
          )}
          {transition && onRandomiseAll && (
            <Button variant="ghost" disabled={locked} onClick={onRandomiseAll}>
              <Shuffle aria-hidden size={16} />
              Randomise all joins
            </Button>
          )}
          <Button variant="ghost" disabled={locked} onClick={onRemoveAll}>
            <Trash2 aria-hidden size={16} />
            Remove from all
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A Transition's strength and colour, where its kind reads them (each shown at its kind's own while
 * unset), and its sound: the Transitions panel's and the Style Preset's Join Transition's. `onChange`
 * says which knob moved, `strength` or `colour`, so a drag can be one step of undo; a sound, none.
 */
export function TransitionKnobFields<T extends JoinTransition>({
  transition,
  onChange,
}: {
  transition: T;
  onChange: (transition: T, knob?: "strength" | "colour") => void;
}) {
  // Its kind's knobs, each with its own value.
  const own = TRANSITIONS[transition.kind];
  return (
    <>
      {own.strength !== undefined && (
        <Slider
          label="Strength"
          value={transition.strength ?? own.strength}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(strength) => onChange({ ...transition, strength }, "strength")}
        />
      )}
      {own.colour !== undefined && (
        <ColorField label="Colour" value={transition.colour ?? own.colour} onChange={(colour) => onChange({ ...transition, colour }, "colour")} />
      )}
      <Segmented
        legend="Sound"
        options={SOUNDS}
        value={transition.sound ?? "linear"}
        onChange={(sound: TransitionSound) => onChange({ ...transition, sound })}
      />
    </>
  );
}
