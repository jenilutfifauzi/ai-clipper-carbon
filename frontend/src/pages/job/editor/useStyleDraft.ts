import { useEffect, useState } from "react";
import {
  api,
  type Candidate,
  type CandidateChange,
  type CaptionStyle,
  type HookStyle,
  type JoinTransition,
  type NewPreset,
  type StyleOverrides,
  type StylePreset,
  type StyleValue,
  type WatermarkStyle,
} from "../../../api";
import { useDraftSave } from "./useDraftSave";

export interface StyleDraft {
  preset_id: string;
  style_overrides: StyleOverrides;
}

export type StylePart = "caption" | "hook" | "watermark";

const EMPTY: StyleOverrides = { caption: {}, hook: {}, watermark: {} };

/** The Candidate's look as edited: its Preset, the resolved styles, and the ways to change them. */
export interface StyleControls {
  presets: StylePreset[];
  preset: StylePreset;
  caption: CaptionStyle;
  hook: HookStyle;
  watermark: WatermarkStyle;
  overrides: StyleOverrides;
  // The Preset's Join Transition, as changed here until saved into a Preset (it has no Style
  // Override: it is copied onto new joins, never linked), and whether it was changed.
  join: JoinTransition | null;
  joinChanged: boolean;
  setJoin: (join: JoinTransition | null) => void;
  // Sets a field; a value equal to the Preset's removes its override.
  set: (part: StylePart, field: string, value: StyleValue) => void;
  // Sets several fields of `part` at once, as one change.
  setMany: (part: StylePart, values: Record<string, StyleValue>) => void;
  reset: (part: StylePart, field: string) => void;
  pick: (presetId: string) => void;
  resetAll: () => void;
  // A Preset was saved (made, or the look baked into it): the Candidate moves to it.
  saved: (preset: StylePreset, all: StylePreset[]) => void;
  // Its Preset was deleted: the Candidate moves to Default.
  deleted: (all: StylePreset[]) => void;
}

/** The Style Presets, loaded once, and a way to replace them once one is saved or deleted. */
export function usePresets(): { presets: StylePreset[] | null; error: string | null; setPresets: (all: StylePreset[]) => void } {
  const [presets, setPresets] = useState<StylePreset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listPresets().then(setPresets, (reason: Error) => setError(reason.message));
  }, []);
  return { presets, error, setPresets };
}

/**
 * The Candidate's Style Preset and the fields of it the Candidate overrides, shared by every tab that
 * edits them. Changes preview at once (`draft`) and are saved once they pause, and at once when the
 * Candidate changes. `controls` is null while the Presets load.
 */
export function useStyleDraft(
  candidate: Candidate,
  onSave: (change: CandidateChange) => void,
  // Another key starts the draft again from the Candidate (another Candidate, or one saved elsewhere).
  key: string = candidate.id,
): { draft: StyleDraft; controls: StyleControls | null; error: string | null } {
  const { presets, error, setPresets } = usePresets();
  // The Join Transition as changed for its Preset, not saved yet.
  const joinDraft = useState<JoinDraft>(null);
  const [draft, change] = useDraftSave<StyleDraft>(
    // Overrides saved before Watermarks have none.
    { preset_id: candidate.preset_id, style_overrides: { ...EMPTY, ...candidate.style_overrides } },
    (value) => onSave(value),
    key,
  );
  return { draft, error, controls: presets && styleControls(presets, draft, change, setPresets, joinDraft) };
}

/** A Join Transition as changed for the Preset `preset`, not saved yet (none: the Preset's own). */
export type JoinDraft = { preset: string; join: JoinTransition | null } | null;

/**
 * The controls of the look `draft` gives, over `presets`: each change is a new draft passed to
 * `change`, with the group it belongs to (a field's changes, while they keep coming, are one: a
 * slider's drag); a Preset picked, saved or reset to has none. The clip editor saves the drafts as
 * they pause, the Advanced Edit makes each a step of its undo.
 */
export function styleControls(
  presets: StylePreset[],
  { preset_id, style_overrides }: StyleDraft,
  change: (draft: StyleDraft, group?: string) => void,
  setPresets: (all: StylePreset[]) => void,
  // The Join Transition as changed for a Preset, not saved yet, and a way to change it: none kept
  // without it.
  [joinDraft, setJoinDraft]: [JoinDraft, (draft: JoinDraft) => void] = [null, () => {}],
): StyleControls {
  // Overrides saved before Watermarks have none.
  const draft = { preset_id, style_overrides: { ...EMPTY, ...style_overrides } };
  const preset = presets.find((p) => p.id === draft.preset_id) ?? presets[0];
  const base = (part: StylePart) => preset[part] as unknown as Record<string, StyleValue>;
  const presetJoin = preset.join_transition ?? null;
  const join = joinDraft?.preset === preset.id ? joinDraft.join : presetJoin;

  function setFields(part: StylePart, values: Record<string, StyleValue>, group?: string) {
    const fields = { ...draft.style_overrides[part] } as Record<string, StyleValue>;
    for (const [field, value] of Object.entries(values)) {
      if (sameValue(base(part)[field], value)) delete fields[field];
      else fields[field] = value;
    }
    change({ ...draft, style_overrides: { ...draft.style_overrides, [part]: fields } }, group);
  }
  const setMany = (part: StylePart, values: Record<string, StyleValue>) => setFields(part, values, `style:${part}.${Object.keys(values).join(",")}`);
  const set = (part: StylePart, field: string, value: StyleValue) => setMany(part, { [field]: value });

  return {
    presets,
    preset,
    caption: overridden(preset.caption, draft.style_overrides.caption),
    hook: overridden(preset.hook, draft.style_overrides.hook),
    watermark: overridden(preset.watermark, draft.style_overrides.watermark),
    overrides: draft.style_overrides,
    join,
    joinChanged: JSON.stringify(join) !== JSON.stringify(presetJoin),
    setJoin: (next) => setJoinDraft({ preset: preset.id, join: next }),
    set,
    setMany,
    reset: (part, field) => setFields(part, { [field]: base(part)[field] }),
    pick: (id) => change({ preset_id: id, style_overrides: EMPTY }),
    resetAll: () => change({ ...draft, style_overrides: EMPTY }),
    saved: (made, all) => {
      setPresets(all);
      setJoinDraft(null);
      change({ preset_id: made.id, style_overrides: EMPTY });
    },
    deleted: (all) => {
      setPresets(all);
      change({ preset_id: "default", style_overrides: EMPTY });
    },
  };
}

/** What a Preset is saved with: the styles as edited, and the Join Transition. */
export const savedLook = ({ caption, hook, watermark, join }: StyleControls): Omit<NewPreset, "name"> => ({
  caption,
  hook,
  watermark,
  join_transition: join,
});

type Fields = Record<string, StyleValue>;

/** A Preset's style with a Candidate's overrides: a field that is a value of several (a shadow) takes those it names. */
export function overridden<S extends object>(style: S, overrides: Partial<Record<keyof S, StyleValue>>): S {
  const fields: Fields = { ...(style as unknown as Fields) };
  for (const [field, value] of Object.entries(overrides) as [string, StyleValue][]) {
    const base = fields[field];
    fields[field] = isFields(value) && isFields(base) ? { ...base, ...value } : value;
  }
  return fields as unknown as S;
}

/** Whether two style values are the same: a shadow's by its fields. */
export function sameValue(a: StyleValue, b: StyleValue): boolean {
  if (!isFields(a) || !isFields(b)) return a === b;
  const keys = Object.keys(a) as (keyof typeof a)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

const isFields = (value: StyleValue): value is Exclude<StyleValue, string | number | boolean | null> => typeof value === "object" && value !== null;
