import { ChevronDown, ChevronUp, Loader2, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AudioEffect, AudioEffectKind, AudioEffectSetting } from "../../../api";
import { libraryOf, useAudioEffects } from "../../../audioEffects";
import { Button, buttonClass } from "../../../components/Button";
import { useMenu } from "../../../components/Menu";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { Mixed } from "../editor/StyleFields";
import {
  addAudioEffect,
  moveAudioEffect,
  removeAllAudioEffects,
  removeAudioEffect,
  setAudioEffectEnabled,
  setAudioEffectSetting,
  sharedStack,
  stackedItems,
  type Outcome,
  type StackRef,
} from "./actions";
import type { AdvancedEdits } from "./edits";
import type { Pick } from "./pick";

/** What the Audio Effects section shows and does (AudioEffectsFields' props but the catalogue). */
export interface AudioEffectControls {
  // The picked stack, or "mixed" when the picked items' stacks differ.
  stack: AudioEffect[] | "mixed";
  // While any picked item's Effected copy is being made (ticket 03 feeds it).
  preparing: boolean;
  onAdd: (kind: AudioEffectKind) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onEnabled: (index: number, enabled: boolean) => void;
  onRemove: (index: number) => void;
  // A setting's slider, each drag one change of its group.
  onSetting: (index: number, setting: AudioEffectSetting, value: number) => void;
  onRemoveAll: () => void;
}

/**
 * The Audio Effects section's controls for the Pick's items with sound (actions.ts' stackedItems),
 * each change one step of undo (a slider's drag one, by its group); null when none with sound is
 * picked, as with a Freeze frame or an image Overlay. `preparing` says whether any of those items'
 * Effected copies is being made. The Inspector and (in 07) the phone's sheet both draw from it.
 */
export function audioEffectChanges(
  scene: { edits: AdvancedEdits; pick: Pick },
  sounded: (media: string) => boolean,
  onEdits: (edits: AdvancedEdits, group?: string) => void,
  preparing: (items: StackRef[]) => boolean = () => false,
): AudioEffectControls | null {
  const stack = sharedStack(scene, sounded);
  if (stack === null) return null;
  const items = stackedItems(scene, sounded);
  const apply = (outcome: Outcome | null, group?: string) => {
    if (outcome) onEdits(outcome.edits, group);
  };
  const ids = items.map((item) => item.id).join(",");
  return {
    stack,
    preparing: preparing(items),
    onAdd: (kind) => apply(addAudioEffect(scene, sounded, kind)),
    onMove: (index, delta) => apply(moveAudioEffect(scene, sounded, index, delta)),
    onEnabled: (index, enabled) => apply(setAudioEffectEnabled(scene, sounded, index, enabled)),
    onRemove: (index) => apply(removeAudioEffect(scene, sounded, index)),
    onSetting: (index, setting, value) => apply(setAudioEffectSetting(scene, sounded, index, setting, value), `effects:${ids}:${index}:${setting.key}`),
    onRemoveAll: () => apply(removeAllAudioEffects(scene, sounded)),
  };
}

// A setting's value as its slider shows it: to its step's decimals, with its unit.
function formatSetting({ step, unit }: AudioEffectSetting) {
  const decimals = Math.min(3, (String(step).split(".")[1] ?? "").length);
  return (value: number) => `${value.toFixed(decimals)}${unit ? (unit === "%" ? "%" : ` ${unit}`) : ""}`;
}

/**
 * The Audio Effects section (ADR 0017), after an item's volume and fades: its stack, one row per
 * effect in the order they are heard, and Add effect, opening the library. With several items
 * picked whose stacks differ, it says Mixed and offers Remove all effects. `kinds` is the catalogue's
 * by default.
 */
export function AudioEffectsFields({ kinds: given, ...controls }: AudioEffectControls & { kinds?: AudioEffectKind[] | null }) {
  const listed = useAudioEffects();
  const kinds = given ?? listed;
  const { stack, preparing, onAdd, onRemoveAll } = controls;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="font-semibold">
          Audio effects
        </h3>
        <AddEffect kinds={kinds} onAdd={onAdd} />
      </div>
      {preparing && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <Loader2 aria-hidden size={15} className="motion-safe:animate-spin" />
          Preparing effects…
        </p>
      )}
      {/* The Clean switches (Reduce noise, Enhance voice, Normalize loudness) go here, above the stack (ticket 06). */}
      {stack === "mixed" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm text-muted">
            <Mixed />
            The selected items have different effects.
          </p>
          <Button size="sm" variant="ghost" onClick={onRemoveAll}>
            <X aria-hidden size={15} />
            Remove all effects
          </Button>
        </div>
      ) : stack.length === 0 ? (
        <p className="text-sm text-pretty text-muted">No effects. Add one to change how this sound is heard.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {stack.map((entry, index) => (
            <EffectRow
              key={`${index}:${entry.id}`}
              entry={entry}
              kind={kinds?.find((kind) => kind.id === entry.id)}
              index={index}
              count={stack.length}
              {...controls}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

// One entry of the stack: its name, on/off, up, down, remove; its intensity slider; and its other
// settings in a "More" popover.
function EffectRow({
  entry,
  kind,
  index,
  count,
  onMove,
  onEnabled,
  onRemove,
  onSetting,
}: AudioEffectControls & { entry: AudioEffect; kind: AudioEffectKind | undefined; index: number; count: number }) {
  const name = kind?.name ?? entry.id;
  const nameId = useId();
  const intensity = kind?.settings.find((setting) => setting.intensity);
  const others = kind?.settings.filter((setting) => setting !== intensity) ?? [];
  const slider = (setting: AudioEffectSetting) => (
    <Slider
      key={setting.key}
      label={setting.label}
      value={entry.params[setting.key] ?? setting.default}
      min={setting.min}
      max={setting.max}
      step={setting.step}
      format={formatSetting(setting)}
      disabled={!entry.enabled}
      onChange={(value) => onSetting(index, setting, value)}
    />
  );
  return (
    <li className="flex flex-col gap-1 rounded-[10px] bg-fill/60 p-2">
      <div className="flex items-center gap-1">
        <Switch checked={entry.enabled} onChange={(on) => onEnabled(index, on)} labelledBy={nameId} className="min-h-9 gap-2">
          <span id={nameId} className={`min-w-0 truncate text-sm font-medium ${entry.enabled ? "" : "text-muted"}`} title={kind?.description}>
            {name}
          </span>
        </Switch>
        <div className="ml-auto flex shrink-0">
          {others.length > 0 && <MoreSettings name={name} settings={others} slider={slider} />}
          <Button variant="ghost" size="xs" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label={`Move ${name} up`}>
            <ChevronUp aria-hidden size={16} />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => onMove(index, 1)} disabled={index === count - 1} aria-label={`Move ${name} down`}>
            <ChevronDown aria-hidden size={16} />
          </Button>
          <Button variant="ghost" size="xs" onClick={() => onRemove(index)} aria-label={`Remove ${name}`}>
            <Trash2 aria-hidden size={16} />
          </Button>
        </div>
      </div>
      {intensity && slider(intensity)}
    </li>
  );
}

// Escape in a popover closes it (the browser's light dismiss), and goes no further: not to the
// editor's "Pick nothing", which would take the Inspector away with it.
const keepEscape = (event: KeyboardEvent) => {
  if (event.key === "Escape") event.stopPropagation();
};

// An effect's settings other than its intensity, in a popover from its "More" button.
function MoreSettings({ name, settings, slider }: { name: string; settings: AudioEffectSetting[]; slider: (setting: AudioEffectSetting) => ReactNode }) {
  const { buttonRef, menuRef, open, toggle } = useMenu();
  const id = useId();
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClass("ghost", "xs")}
        onClick={toggle}
        aria-label={`More settings of ${name}`}
        aria-expanded={open}
        aria-controls={id}
      >
        <SlidersHorizontal aria-hidden size={16} />
      </button>
      <div
        ref={menuRef}
        id={id}
        role="dialog"
        aria-label={`${name} settings`}
        {...{ popover: "auto" }}
        onKeyDown={keepEscape}
        className="glass fixed inset-auto m-0 w-72 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-[10px] bg-bg/90! p-3 text-text [&:popover-open]:flex"
      >
        <p className="text-sm font-semibold">{name}</p>
        {settings.map(slider)}
      </div>
    </>
  );
}

// Add effect: a popover of the library (libraryOf), searched as it is typed; a click on an effect
// adds it at the bottom of the stack and closes the popover.
function AddEffect({ kinds, onAdd }: { kinds: AudioEffectKind[] | null; onAdd: (kind: AudioEffectKind) => void }) {
  const { buttonRef, menuRef, open, hide, toggle } = useMenu();
  const [query, setQuery] = useState("");
  const id = useId();
  const groups = kinds ? libraryOf(kinds, query) : [];
  return (
    <>
      <button ref={buttonRef} type="button" className={buttonClass("ghost", "sm")} onClick={toggle} aria-expanded={open} aria-controls={id} aria-haspopup="dialog">
        <Plus aria-hidden size={15} />
        Add effect
      </button>
      <div
        ref={menuRef}
        id={id}
        role="dialog"
        aria-label="Add an audio effect"
        {...{ popover: "auto" }}
        onKeyDown={keepEscape}
        className="glass fixed inset-auto m-0 max-h-[min(28rem,calc(100vh-1rem))] w-72 max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-y-auto rounded-[10px] bg-bg/90! p-2 text-text [&:popover-open]:flex"
      >
        <label className="flex min-h-10 items-center gap-2 rounded-[10px] border border-border bg-fill px-2">
          <Search aria-hidden size={15} className="shrink-0 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search effects"
            aria-label="Search effects"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-base outline-none"
          />
        </label>
        {kinds === null ? (
          <p className="px-2 py-1 text-sm text-muted">Loading the effects…</p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted">No effect matches “{query.trim()}”.</p>
        ) : (
          groups.map(({ group, effects }) => (
            <div key={group} role="group" aria-label={group} className="flex flex-col">
              <p className="px-2 pt-1 pb-0.5 text-xs font-semibold text-muted">{group}</p>
              {effects.map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  onClick={() => {
                    onAdd(kind);
                    hide();
                  }}
                  className="flex min-h-9 flex-col items-start rounded-md px-2 py-1 text-left hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span className="text-sm">{kind.name}</span>
                  {kind.description && <span className="text-xs text-pretty text-muted">{kind.description}</span>}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}
