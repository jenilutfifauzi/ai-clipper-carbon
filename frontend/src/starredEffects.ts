import { api } from "./api";
import { listStore } from "./listStore";

// The starred effects (backend/app/starred_effects.py; ADR 0014): one list of Video and Audio Effect
// ids for every Job, kept on the server, so the desktop and the phone star alike.
const starred = listStore(() => api.listStarredEffects());

/** The starred ids, null until they are loaded; listed again whenever they change. */
export const useStarredEffects = (): string[] | null => starred.useList();

// Toggles one after the other, so a quick second one starts from the first's list.
let changes: Promise<unknown> = Promise.resolve();

/**
 * Star `id`, or unstar it when it is starred: shown at once, then saved. A failed save lists the
 * server's again, which undoes it.
 */
export function toggleStar(id: string): Promise<void> {
  const change = changes.then(async () => {
    const list = await starred.load().catch((): string[] => []);
    const next = list.includes(id) ? list.filter((other) => other !== id) : [...list, id];
    starred.set(next);
    try {
      starred.set(await api.setStarredEffects(next));
    } catch {
      await starred.reload().catch(() => {});
    }
  });
  changes = change;
  return change;
}

/** The kinds `stars` names, in their own order, or all of them unless `only`: an id no kind has is not shown. */
export function starredOnly<T extends { id: string }>(kinds: T[], stars: string[] | null, only: boolean): T[] {
  return only ? kinds.filter((kind) => stars?.includes(kind.id)) : kinds;
}
