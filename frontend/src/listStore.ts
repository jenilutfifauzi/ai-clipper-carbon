import { useEffect, useState } from "react";

/**
 * A list the backend keeps for every Job (the Faces, the Text Presets), loaded once for the page and
 * shared by every component: `load` lists it the first time, `reload` lists it again (after a change
 * here or elsewhere), and `useList` gives a component the list, null until it is loaded, and again
 * whenever it is listed. A failed listing is retried next time.
 */
export function listStore<T>(list: () => Promise<T[]>) {
  let listed: T[] | null = null;
  let loading: Promise<T[]> | null = null;
  const listeners = new Set<(items: T[]) => void>();

  async function fetched(): Promise<T[]> {
    try {
      const items = await list();
      listed = items;
      for (const listener of listeners) listener(items);
      return items;
    } catch (error) {
      loading = null;
      throw error;
    }
  }

  const load = (): Promise<T[]> => (loading ??= fetched());
  const reload = (): Promise<T[]> => (loading = fetched());

  function useList(): T[] | null {
    const [items, setItems] = useState(listed);
    useEffect(() => {
      listeners.add(setItems);
      load().then(setItems, () => setItems((old) => old ?? []));
      return () => {
        listeners.delete(setItems);
      };
    }, []);
    return items;
  }

  return { load, reload, useList };
}
