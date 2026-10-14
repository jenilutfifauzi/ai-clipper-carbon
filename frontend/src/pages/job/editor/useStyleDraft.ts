import { useEffect, useState } from "react";
import {
  api,
  type Candidate,
  type CandidateChange,
  type CaptionStyle,
  type HookStyle,
  type StyleOverrides,
  type StylePreset,
  type StyleValue,
} from "../../../api";
import { useDraftSave } from "./useDraftSave";

export interface StyleDraft {
  preset_id: string;
  style_overrides: StyleOverrides;
}

export type StylePart = "caption" | "hook";

const EMPTY: StyleOverrides = { caption: {}, hook: {} };

/** The Candidate's look as edited: its Preset, the resolved styles, and the ways to change them. */
export interface StyleControls {
  presets: StylePreset[];
  preset: StylePreset;
  caption: CaptionStyle;
  hook: HookStyle;
  overrides: StyleOverrides;
  // Sets a field; a value equal to the Preset's removes its override.
  set: (part: StylePart, field: string, value: StyleValue) => void;
  reset: (part: StylePart, field: string) => void;
  pick: (presetId: string) => void;
  resetAll: () => void;
  // A Preset was saved (made, or the look baked into it): the Candidate moves to it.
  saved: (preset: StylePreset, all: StylePreset[]) => void;
  // Its Preset was deleted: the Candidate moves to Default.
  deleted: (all: StylePreset[]) => void;
}

/**
 * The Candidate's Style Preset and the fields of it the Candidate overrides, shared by every tab that
 * edits them. Changes preview at once (`draft`) and are saved once they pause, and at once when the
 * Candidate changes. `controls` is null while the Presets load.
 */
export function useStyleDraft(
  candidate: Candidate,
  onSave: (change: CandidateChange) => void,
): { draft: StyleDraft; controls: StyleControls | null; error: string | null } {
  const [presets, setPresets] = useState<StylePreset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, change] = useDraftSave<StyleDraft>(
    { preset_id: candidate.preset_id, style_overrides: candidate.style_overrides },
    (value) => onSave(value),
    candidate.id,
  );

  useEffect(() => {
    api.listPresets().then(setPresets, (reason: Error) => setError(reason.message));
  }, []);

  if (!presets) return { draft, controls: null, error };
  const preset = presets.find((p) => p.id === draft.preset_id) ?? presets[0];
  const base = (part: StylePart) => preset[part] as unknown as Record<string, StyleValue>;

  function set(part: StylePart, field: string, value: StyleValue) {
    const fields = { ...draft.style_overrides[part] } as Record<string, StyleValue>;
    if (base(part)[field] === value) delete fields[field];
    else fields[field] = value;
    change({ ...draft, style_overrides: { ...draft.style_overrides, [part]: fields } });
  }

  return {
    draft,
    error,
    controls: {
      presets,
      preset,
      caption: { ...preset.caption, ...draft.style_overrides.caption } as CaptionStyle,
      hook: { ...preset.hook, ...draft.style_overrides.hook } as HookStyle,
      overrides: draft.style_overrides,
      set,
      reset: (part, field) => set(part, field, base(part)[field]),
      pick: (id) => change({ preset_id: id, style_overrides: EMPTY }),
      resetAll: () => change({ ...draft, style_overrides: EMPTY }),
      saved: (made, all) => {
        setPresets(all);
        change({ preset_id: made.id, style_overrides: EMPTY });
      },
      deleted: (all) => {
        setPresets(all);
        change({ preset_id: "default", style_overrides: EMPTY });
      },
    },
  };
}
