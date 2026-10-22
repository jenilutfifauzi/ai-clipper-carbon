import { api, type TemplateInfo } from "./api";
import { listStore } from "./listStore";

// The owner's Templates (GLOSSARY.md), listed once for the page and again after a change here.
const catalogue = listStore(api.listTemplates);

/** The Templates listed again, as after a save, a rename, a delete or a new default. */
export const reloadTemplates = catalogue.reload;

/** The owner's Templates, the default marked; null until they are listed. */
export const useTemplates = (): TemplateInfo[] | null => catalogue.useList();

/** Runs a change of the Templates, then lists them again for every `useTemplates`. */
export async function changeTemplates<T>(change: () => Promise<T>): Promise<T> {
  const done = await change();
  await reloadTemplates().catch(() => {});
  return done;
}
