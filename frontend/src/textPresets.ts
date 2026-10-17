import { useEffect, useState } from "react";
import { api, type TextPreset, type TextStyle } from "./api";

// The shelf the owner's Text Presets are on, ahead of the built-in ones' (backend/app/text_presets.py).
export const MINE = "Mine";
// The built-in Preset used for new titles until another is chosen.
const BUILTIN_TEXT = "text";

let listed: TextPreset[] | null = null;
let loading: Promise<TextPreset[]> | null = null;
const listeners = new Set<(presets: TextPreset[]) => void>();

/** The Text Presets, built-in and the owner's, loaded once; a failure is retried next time. */
export function loadTextPresets(): Promise<TextPreset[]> {
  loading ??= fetchTextPresets();
  return loading;
}

/** The Text Presets listed again, as after a change here or elsewhere: every `useTextPresets` gets them. */
export function reloadTextPresets(): Promise<TextPreset[]> {
  loading = fetchTextPresets();
  return loading;
}

/** The Text Presets, null until they are loaded; listed again whenever they change. */
export function useTextPresets(): TextPreset[] | null {
  const [presets, setPresets] = useState(listed);
  useEffect(() => {
    listeners.add(setPresets);
    loadTextPresets().then(setPresets, () => setPresets((old) => old ?? []));
    return () => {
      listeners.delete(setPresets);
    };
  }, []);
  return presets;
}

/** Save `style` as a new Text Preset of the owner's named `name`, then list them again. */
export async function saveTextPreset(name: string, style: TextStyle): Promise<TextPreset> {
  return changed(api.createTextPreset(name, style));
}

export const renameTextPreset = (id: string, name: string) => changed(api.changeTextPreset(id, { name }));
export const deleteTextPreset = (id: string) => changed(api.deleteTextPreset(id));
/** Use the Preset `id` for new titles: by Add text, and for a Text Layer the agent adds without a style. */
export const chooseForNewTitles = (id: string) => changed(api.useTextPresetForNewTitles(id));

async function changed<T>(change: Promise<T>): Promise<T> {
  const result = await change;
  await reloadTextPresets().catch(() => {});
  return result;
}

async function fetchTextPresets(): Promise<TextPreset[]> {
  try {
    const presets = await api.listTextPresets();
    listed = presets;
    for (const listener of listeners) listener(presets);
    return presets;
  } catch (error) {
    loading = null;
    throw error;
  }
}

/** The Text tab's shelves: the owner's Presets ("Mine") first, then the built-in ones by category, each shelf in the order of its first Preset. */
export function shelvesOf(presets: TextPreset[]): { category: string; presets: TextPreset[] }[] {
  const mine = presets.filter((preset) => !preset.builtin);
  const shelves = new Map<string, TextPreset[]>();
  for (const preset of presets.filter((p) => p.builtin).sort((a, b) => a.order - b.order)) {
    shelves.set(preset.category, [...(shelves.get(preset.category) ?? []), preset]);
  }
  return [...(mine.length ? [{ category: MINE, presets: mine }] : []), ...[...shelves].map(([category, shelf]) => ({ category, presets: shelf }))];
}

/** The Preset used for new titles: the one marked, or built-in Text. */
export function forNewTitles(presets: TextPreset[]): TextPreset | undefined {
  return presets.find((preset) => preset.default) ?? presets.find((preset) => preset.id === BUILTIN_TEXT);
}
