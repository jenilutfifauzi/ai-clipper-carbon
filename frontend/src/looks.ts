import { api, type Look } from "./api";
import { listStore } from "./listStore";
import { knowLooks } from "./pages/job/editor/grading";

// The Looks, each made known to the fold (editor/grading.ts) before it is listed.
const catalogue = listStore(async () => {
  const looks = await api.listLooks();
  knowLooks(looks);
  return looks;
});

/** The Looks, loaded once for the page; a failure is retried next time. */
export const loadLooks = catalogue.load;

/** The Looks listed again, as after an import or a delete: every `useLooks` gets them. */
export const reloadLooks = catalogue.reload;

/** Import a .cube file as an Imported Look for every Job, then list the Looks again. */
export async function importLook(file: File): Promise<Look> {
  const look = await api.importLook(file);
  await reloadLooks().catch(() => {});
  return look;
}

/** Delete an Imported Look no Candidate's Grade names, then list the Looks again. */
export async function deleteLook(id: string): Promise<void> {
  await api.deleteLook(id);
  await reloadLooks().catch(() => {});
}

/**
 * The Looks, null until they are loaded. A component that draws Grades calls it, so that it is drawn
 * again once their Looks' values are known to the fold.
 */
export const useLooks = (): Look[] | null => catalogue.useList();

/** The Filters tab's shelves: the Looks by category, each shelf in the order of its first Look. */
export function shelvesOf(looks: Look[]): { category: string; looks: Look[] }[] {
  const shelves = new Map<string, Look[]>();
  for (const look of [...looks].sort((a, b) => a.order - b.order)) shelves.set(look.category, [...(shelves.get(look.category) ?? []), look]);
  return [...shelves].map(([category, looks]) => ({ category, looks }));
}
