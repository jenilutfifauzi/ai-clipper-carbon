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

  // Read on a server render too (renderToStaticMarkup), as the browser has it.
  return { read, set, use: () => useSyncExternalStore(subscribe, read, read) };
}

/**
 * An arbitrary JSON value remembered per browser under `key`, `initial` until set. The twin of
 * rememberedSwitch for anything that serialises: storage can be unavailable (blocked site data, some
 * private windows) or hold a stale/bad blob, and then it is `initial` and a change lasts for the
 * page's life only. Another tab's change is heard.
 */
export function rememberedValue<T>(key: string, initial: T) {
  const listeners = new Set<() => void>();
  let fallback = initial;
  // Parse once per raw string so read() returns a stable reference while nothing changes: a fresh
  // object every call would make useSyncExternalStore re-render forever.
  let cacheRaw: string | null = null;
  let cacheValue: T;
  let cached = false;

  const read = (): T => {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return fallback;
      if (cached && value === cacheRaw) return cacheValue;
      cacheValue = JSON.parse(value) as T;
      cacheRaw = value;
      cached = true;
      return cacheValue;
    } catch {
      return fallback;
    }
  };

  const set = (value: T) => {
    fallback = value;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Not remembered; still applied.
    }
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    // Another tab set it.
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };

  return { read, set, subscribe, use: () => useSyncExternalStore(subscribe, read) };
}
