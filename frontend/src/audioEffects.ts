import { api, type AudioEffectKind } from "./api";
import { listStore } from "./listStore";

// The Audio Effects catalogue (backend/app/audio_effects.py; ADR 0017), read from the server.
const catalogue = listStore(api.listAudioEffects);

/** The Audio Effects catalogue, null until it is loaded; loaded once for the page, a failure retried next time. */
export const useAudioEffects = (): AudioEffectKind[] | null => catalogue.useList();

/** The groups the Add effect library lists, in order. The Clean effects are the Inspector's switches, not listed. */
export const LIBRARY_GROUPS = ["Voice", "Tone", "Space"] as const;

/**
 * The Add effect library: the catalogue's Voice, Tone and Space effects, each group by order, kept to
 * those whose name or description has `query` (ignoring case and the spaces around it). A group left
 * with none is dropped.
 */
export function libraryOf(kinds: AudioEffectKind[], query: string): { group: (typeof LIBRARY_GROUPS)[number]; effects: AudioEffectKind[] }[] {
  const needle = query.trim().toLowerCase();
  const found = (kind: AudioEffectKind) => !needle || kind.name.toLowerCase().includes(needle) || kind.description.toLowerCase().includes(needle);
  return LIBRARY_GROUPS.map((group) => ({
    group,
    effects: kinds.filter((kind) => kind.group === group && found(kind)).sort((a, b) => a.order - b.order),
  })).filter(({ effects }) => effects.length > 0);
}
