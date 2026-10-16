import { useSyncExternalStore } from "react";

/**
 * The Skim's two switches (GLOSSARY.md): whether the Advanced Edit's Timeline skims, and whether a
 * skim is heard. Per browser, both off unless turned on. Storage can be unavailable (blocked site
 * data, some private windows): then a change lasts for the page's life only, as the Magnetic
 * timeline's does.
 */
function remembered(key: string) {
  const listeners = new Set<() => void>();
  let fallback = false;

  const read = (): boolean => {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value === "on";
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

const skim = remembered("ai-clipper-skim");
const sound = remembered("ai-clipper-skim-sound");

/** Whether the Skim is on. */
export const useSkim = skim.use;
export const setSkim = skim.set;
/** The Skim turned on, or off. */
export const toggleSkim = () => skim.set(!skim.read());

/** Whether a skim is heard, in snippets. */
export const useSkimSound = sound.use;
export const setSkimSound = sound.set;
