import { useSyncExternalStore } from "react";

/**
 * An on/off switch remembered per browser under `key`, `initial` until turned. Storage can be
 * unavailable (blocked site data, some private windows): then it is `initial`, and a change lasts
 * for the page's life only. Another tab's change is heard.
 */
export function rememberedSwitch(key: string, initial: boolean) {
  const listeners = new Set<() => void>();
  let fallback = initial;

  const read = (): boolean => {
    try {
      const value = localStorage.getItem(key);
      return value === "on" ? true : value === "off" ? false : fallback;
    } catch {
      return fallback;
    }
  };

  const set = (on: boolean) => {
    fallback = on;
    try {
      localStorage.setItem(key, on ? "on" : "off");
    } catch {
      // Not remembered; still applied.
    }
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    // Another tab turned it on or off.
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };

  return { read, set, use: () => useSyncExternalStore(subscribe, read) };
}
