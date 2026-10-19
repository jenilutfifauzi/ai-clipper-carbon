import { ChevronDown } from "lucide-react";
import { useId } from "react";
import type { TransitionKind, TransitionSound } from "../../../api";
import { ColorField } from "../../../components/ColorField";
import { Hint } from "../../../components/InfoTip";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { SOUNDS, TRANSITION_BOUNDS, TRANSITION_SECS } from "../advanced/Transitions";
import { TRANSITION_GROUPS, TRANSITION_KINDS, TRANSITIONS } from "./transitions";
import type { StyleControls } from "./useStyleDraft";

/**
 * The Style Preset's Join Transition (GLOSSARY): none, or a kind, its length, its strength and colour
 * where its kind reads them, and its sound. Every new join of a clip using the Preset gets a copy.
 * Read-only on a built-in Preset, which has none; saved into the owner's by the Preset bar's Update.
 */
export function JoinTransitionPanel({ style }: { style: StyleControls }) {
  const { join, setJoin } = style;
  const builtin = style.preset.builtin;
  // Its kind's knobs, each with its own value.
  const own = join ? TRANSITIONS[join.kind] : null;
  return (
    <div className="flex flex-col gap-4">
      {builtin ? (
        <Hint more="Save the look as a new preset to give its new joins a transition.">A built-in preset gives new joins none.</Hint>
      ) : (
        <Hint more="Split, insert, paste, freeze, delete or reorder: a join that wasn't there before gets a copy. Joins already there, and a transition you remove, stay as they are.">
          Every new join of a clip using this preset gets this transition.
        </Hint>
      )}
      <JoinKind
        value={join?.kind ?? "none"}
        disabled={builtin}
        onChange={(kind) => setJoin(kind === "none" ? null : { ...(join ?? { secs: TRANSITION_SECS, sound: "linear" }), kind })}
      />
      {join && !builtin && (
        <>
          <Slider
            label="Length"
            value={join.secs}
            min={TRANSITION_BOUNDS.min}
            max={TRANSITION_BOUNDS.max}
            step={0.05}
            format={(v) => `${v.toFixed(2)} s`}
            onChange={(secs) => setJoin({ ...join, secs })}
          />
          {own?.strength !== undefined && (
            <Slider
              label="Strength"
              value={join.strength ?? own.strength}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(strength) => setJoin({ ...join, strength })}
            />
          )}
          {own?.colour !== undefined && <ColorField label="Colour" value={join.colour ?? own.colour} onChange={(colour) => setJoin({ ...join, colour })} />}
          <Segmented legend="Sound" options={SOUNDS} value={join.sound ?? "linear"} onChange={(sound: TransitionSound) => setJoin({ ...join, sound })} />
        </>
      )}
    </div>
  );
}

/** The Join Transition's kind, by group, or None. */
export function JoinKind({
  value,
  disabled = false,
  onChange,
}: {
  value: TransitionKind | "none";
  disabled?: boolean;
  onChange: (kind: TransitionKind | "none") => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Transition of new joins
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as TransitionKind | "none")}
          className="min-h-11 w-full cursor-pointer appearance-none truncate rounded-control border border-border bg-fill py-2 pr-9 pl-3 text-base disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="none">None</option>
          {TRANSITION_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {TRANSITION_KINDS.filter((kind) => TRANSITIONS[kind].group === group).map((kind) => (
                <option key={kind} value={kind}>
                  {TRANSITIONS[kind].label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown aria-hidden size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
      </div>
    </div>
  );
}
