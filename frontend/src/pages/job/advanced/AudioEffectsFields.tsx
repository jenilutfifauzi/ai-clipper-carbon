import { ChevronDown, ChevronUp, Loader2, Plus, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AudioEffect, AudioEffectKind, AudioEffectSetting } from "../../../api";
import { CLEAN_SWITCHES, isCleanSwitch, libraryOf, useAudioEffects, type CleanSwitchId } from "../../../audioEffects";
import { Button, buttonClass } from "../../../components/Button";
import { useMenu } from "../../../components/Menu";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { cx } from "../../../format";
import { Mixed } from "../editor/StyleFields";
import {
  addAudioEffect,
  cleanSwitches,
  moveAudioEffect,
  removeAllAudioEffects,
  removeAudioEffect,
  setAudioEffectEnabled,
  setAudioEffectSetting,
  setCleanSetting,
  setCleanSwitch,
  sharedStack,
  stackedItems,
  type CleanSwitch,
  type Outcome,
  type StackRef,
} from "./actions";
import type { AdvancedEdits } from "./edits";
import type { Pick } from "./pick";

/** What the Audio Effects section shows and does (AudioEffectsFields' props but the catalogue). */
export interface AudioEffectControls {
  // The picked stack, or "mixed" when the picked items' stacks differ.
  stack: AudioEffect[] | "mixed";
  // The Clean switches (Reduce noise, Enhance voice, Normalize loudness), on, off or Mixed.
  clean: Record<CleanSwitchId, CleanSwitch>;
  // While any picked item's Effected copy is being made (ticket 03 feeds it).
  preparing: boolean;
  onAdd: (kind: AudioEffectKind) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onEnabled: (index: number, enabled: boolean) => void;
  onRemove: (index: number) => void;
  // A setting's slider, each drag one change of its group.
  onSetting: (index: number, setting: AudioEffectSetting, value: number) => void;
  onRemoveAll: () => void;
  // A Clean switch turned on or off on every picked item with sound.
  onClean: (kind: AudioEffectKind, on: boolean) => void;
  // A Clean switch's slider, on every picked item that has it; each drag one change of its group.
  onCleanSetting: (id: CleanSwitchId, setting: AudioEffectSetting, value: number) => void;
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
  const clean = cleanSwitches(scene, sounded);
  if (stack === null || clean === null) return null;
  const items = stackedItems(scene, sounded);
  const apply = (outcome: Outcome | null, group?: string) => {
    if (outcome) onEdits(outcome.edits, group);
  };
  const ids = items.map((item) => item.id).join(",");
  return {
    stack,
    clean,
    preparing: preparing(items),
    onAdd: (kind) => apply(addAudioEffect(scene, sounded, kind)),
    onMove: (index, delta) => apply(moveAudioEffect(scene, sounded, index, delta)),
    onEnabled: (index, enabled) => apply(setAudioEffectEnabled(scene, sounded, index, enabled)),
    onRemove: (index) => apply(removeAudioEffect(scene, sounded, index)),
    onSetting: (index, setting, value) => apply(setAudioEffectSetting(scene, sounded, index, setting, value), `effects:${ids}:${index}:${setting.key}`),
    onRemoveAll: () => apply(removeAllAudioEffects(scene, sounded)),
    onClean: (kind, on) => apply(setCleanSwitch(scene, sounded, kind, on)),
    onCleanSetting: (id, setting, value) => apply(setCleanSetting(scene, sounded, id, setting, value), `clean:${ids}:${id}:${setting.key}`),
  };
}

// A setting's value as its slider shows it: to its step's decimals, with its unit.
export function formatSetting({ step, unit }: AudioEffectSetting) {
  const decimals = Math.min(3, (String(step).split(".")[1] ?? "").length);
  return (value: number) => `${value.toFixed(decimals)}${unit ? (unit === "%" ? "%" : ` ${unit}`) : ""}`;
}

/**
 * The Audio Effects section (ADR 0017), after an item's volume and fades: the Clean switches, each
 * with its slider when on; its stack, one row per effect in the order they are heard (the switches'
 * entries aren't rows); and Add effect, opening the library. With several items picked whose stacks
 * differ, it says Mixed and offers Remove all effects. `kinds` is the catalogue's by default.
 */
export function AudioEffectsFields({ kinds: given, ...controls }: AudioEffectControls & { kinds?: AudioEffectKind[] | null }) {
  const listed = useAudioEffects();
  const kinds = given ?? listed;
  const { stack, preparing, onAdd, onRemoveAll } = controls;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 border-t border-border pt-4 in-data-sheet:border-t-0 in-data-sheet:pt-0">
      <div className="flex items-center justify-between gap-2">
        {/* In the phone's sheet, its title names the section. */}
        <h3 id={headingId} className="font-semibold in-data-sheet:sr-only">
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
      <CleanSwitches kinds={kinds} {...controls} />
      {stack === "mixed" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm text-muted">
            <Mixed />
            The selected items have different effects.
          </p>
          <Button size="sm" variant="ghost" className="in-data-sheet:min-h-11" onClick={onRemoveAll}>
            <X aria-hidden size={15} />
            Remove all effects
          </Button>
        </div>
      ) : (
        <EffectRows stack={stack} kinds={kinds} controls={controls} />
      )}
    </section>
  );
}

// The Clean switches, in CLEAN_SWITCHES' order, each with its intensity slider while it is on for
// every picked item (Mixed while only some have it: switched on, it is on for all).
function CleanSwitches({ kinds, clean, onClean, onCleanSetting }: AudioEffectControls & { kinds: AudioEffectKind[] | null }) {
  const shown = CLEAN_SWITCHES.flatMap((id) => kinds?.find((kind) => kind.id === id) ?? []);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-1">
      {shown.map((kind) => (
        <CleanSwitchRow key={kind.id} kind={kind} state={clean[kind.id as CleanSwitchId]} onClean={onClean} onCleanSetting={onCleanSetting} />
      ))}
    </div>
  );
}

function CleanSwitchRow({
  kind,
  state,
  onClean,
  onCleanSetting,
}: {
  kind: AudioEffectKind;
  state: CleanSwitch;
  onClean: AudioEffectControls["onClean"];
  onCleanSetting: AudioEffectControls["onCleanSetting"];
}) {
  const nameId = useId();
  const intensity = kind.settings.find((setting) => setting.intensity);
  return (
    <div className="flex flex-col">
      <Switch checked={state.on === true} onChange={(on) => onClean(kind, on)} labelledBy={nameId} className="min-h-10 gap-2 in-data-sheet:min-h-11">
        <span id={nameId} className="flex min-w-0 items-center gap-2 text-sm font-medium" title={kind.description}>
          {kind.name}
          {state.on === "mixed" && <Mixed />}
        </span>
      </Switch>
      {state.on === true && intensity && state.params && (
        <Slider
          label={intensity.label}
          value={state.params[intensity.key] ?? intensity.default}
          min={intensity.min}
          max={intensity.max}
          step={intensity.step}
          format={formatSetting(intensity)}
          onChange={(value) => onCleanSetting(kind.id as CleanSwitchId, intensity, value)}
        />
      )}
    </div>
  );
}

// The stack's rows: its entries but the Clean switches', each at its place in the stack.
function EffectRows({ stack, kinds, controls }: { stack: AudioEffect[]; kinds: AudioEffectKind[] | null; controls: AudioEffectControls }) {
  const rows = stack.flatMap((entry, index) => (isCleanSwitch(entry.id) ? [] : [{ entry, index }]));
  if (!rows.length) return <p className="text-sm text-pretty text-muted">No effects. Add one to change how this sound is heard.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {rows.map(({ entry, index }, row) => (
        <EffectRow
          key={`${index}:${entry.id}`}
          entry={entry}
          kind={kinds?.find((kind) => kind.id === entry.id)}
          index={index}
          first={row === 0}
          last={row === rows.length - 1}
          {...controls}
        />
      ))}
    </ol>
  );
}

// What an effect stack's row does (an Audio Effect's, or a Video Effect's: VideoEffectsFields).
export type RowControls = { [K in "onMove" | "onEnabled" | "onRemove" | "onSetting"]: AudioEffectControls[K] };

// One entry of the stack: its name, on/off, up, down, remove; its intensity slider; and its other
// settings in a "More" popover. Also a Video Effect's row (VideoEffectsFields).
export function EffectRow({
  entry,
  kind,
  index,
  first,
  last,
  onMove,
  onEnabled,
  onRemove,
  onSetting,
}: RowControls & {
  entry: AudioEffect;
  kind: { name: string; description: string; settings: AudioEffectSetting[] } | undefined;
  index: number;
  first: boolean;
  last: boolean;
}) {
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
        <Switch checked={entry.enabled} onChange={(on) => onEnabled(index, on)} labelledBy={nameId} className="min-h-9 gap-2 in-data-sheet:min-h-11">
          <span id={nameId} className={`min-w-0 truncate text-sm font-medium ${entry.enabled ? "" : "text-muted"}`} title={kind?.description}>
            {name}
          </span>
        </Switch>
        <div className="ml-auto flex shrink-0">
          {others.length > 0 && <MoreSettings name={name} settings={others} slider={slider} />}
          <Button variant="ghost" size="xs" className={ROW_BUTTON} onClick={() => onMove(index, -1)} disabled={first} aria-label={`Move ${name} up`}>
            <ChevronUp aria-hidden size={16} />
          </Button>
          <Button variant="ghost" size="xs" className={ROW_BUTTON} onClick={() => onMove(index, 1)} disabled={last} aria-label={`Move ${name} down`}>
            <ChevronDown aria-hidden size={16} />
          </Button>
          <Button variant="ghost" size="xs" className={ROW_BUTTON} onClick={() => onRemove(index)} aria-label={`Remove ${name}`}>
            <Trash2 aria-hidden size={16} />
          </Button>
        </div>
      </div>
      {intensity && slider(intensity)}
    </li>
  );
}

// A row's icon buttons (More, up, down, remove), a finger's size in the phone's sheet.
export const ROW_BUTTON = "in-data-sheet:min-h-11 in-data-sheet:min-w-11";

// Escape in a popover closes it (the browser's light dismiss), and goes no further: not to the
// editor's "Pick nothing", which would take the Inspector away with it.
export const keepEscape = (event: KeyboardEvent) => {
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
        className={cx(buttonClass("ghost", "xs"), ROW_BUTTON)}
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
      <button ref={buttonRef} type="button" className={cx(buttonClass("ghost", "sm"), "in-data-sheet:min-h-11")} onClick={toggle} aria-expanded={open} aria-controls={id} aria-haspopup="dialog">
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
        <label className="flex min-h-10 items-center gap-2 rounded-[10px] border border-border bg-fill px-2 in-data-sheet:min-h-11">
          <Search aria-hidden size={15} className="shrink-0 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search effects"
            aria-label="Search effects"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-base outline-none in-data-sheet:min-h-11"
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
                  className="flex min-h-9 flex-col items-start rounded-md px-2 py-1 text-left in-data-sheet:min-h-11 in-data-sheet:justify-center hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
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
