import { useSyncExternalStore } from "react";

/**
 * The Magnetic timeline's switch (GLOSSARY.md): whether the layers follow the Main Track in the
 * Advanced Edit and the clip editor's trim. Per browser, on unless turned off. Storage can be
 * unavailable (blocked site data, some private windows): then it is on, and a change lasts for the
 * page's life only.
 */

const KEY = "ai-clipper-magnetic";
const listeners = new Set<() => void>();
let fallback = true;

function read(): boolean {
  try {
    const value = localStorage.getItem(KEY);
    return value === null ? fallback : value !== "off";
  } catch {
    return fallback;
  }
}

export function setMagnetic(on: boolean) {
  fallback = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Not remembered; still applied.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab turned it on or off.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether the Magnetic timeline is on. */
export function useMagnetic(): boolean {
  return useSyncExternalStore(subscribe, read);
}
