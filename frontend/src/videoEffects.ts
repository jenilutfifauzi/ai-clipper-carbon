import { api, type VideoEffectKind } from "./api";
import { listStore } from "./listStore";

// The Video Effects catalogue (backend/app/video_effects.py, the effects registry's video kind; ADR 0014), read from the server.
const catalogue = listStore(api.listVideoEffects);

/** The Video Effects catalogue, null until it is loaded; loaded once for the page, a failure retried next time. */
export const useVideoEffects = (): VideoEffectKind[] | null => catalogue.useList();

/** The categories the Add effect library lists, in order. */
export const CATEGORIES = ["Blur", "Distort", "Light", "Stylize", "Cutout"] as const;

/**
 * The Add effect library: the catalogue by category, each by order, kept to those whose name or
 * description has `query` (ignoring case and the spaces around it). A category left with none is
 * dropped, and so is Cutout without `keys` (no Overlay picked: a key is an Overlay's only).
 */
export function videoLibraryOf(kinds: VideoEffectKind[], query: string, keys = true): { category: (typeof CATEGORIES)[number]; effects: VideoEffectKind[] }[] {
  const needle = query.trim().toLowerCase();
  const found = (kind: VideoEffectKind) => !needle || kind.name.toLowerCase().includes(needle) || kind.description.toLowerCase().includes(needle);
  return CATEGORIES.filter((category) => keys || category !== "Cutout").map((category) => ({
    category,
    effects: kinds.filter((kind) => kind.category === category && found(kind)).sort((a, b) => a.order - b.order),
  })).filter(({ effects }) => effects.length > 0);
}
