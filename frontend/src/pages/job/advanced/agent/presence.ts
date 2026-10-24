import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { AgentStreamEvent } from "./useAgentStream";
import type { PresenceTarget, Touched } from "./touched";

/**
 * Agent Presence (ADR 0029): where the Agent is at work, kept outside React state so that an
 * animation never re-renders the editor page. One store per editor, driven by the Agent's events
 * (`heard`) and by the diff of each Revision it saved (`revised`); only what draws presence reads it,
 * each with `useSyncExternalStore`. Its timers are its own. Never saved, never undone.
 */

// How long a Revision's items flash, and how long the cursor stays once a turn has finished.
export const FLASH_MS = 700;
export const IDLE_AFTER_MS = 1500;

export type PresenceStatus = "idle" | "thinking" | "editing";
// A flash and a reflash look the same: they take turns from one Revision to the next, so an item
// still flashing when the next Revision touches it gets a new mark and its ring starts over.
export type PresenceMark = "pulse" | "flash" | "reflash";

export interface PresenceState {
  status: PresenceStatus;
  // The Agent Provider's name.
  label: string;
  // The first item the last Revision touched, which the cursor goes to (and Follow agent).
  target: PresenceTarget | null;
  // The items the last Revision touched, which pulse while a tool call runs.
  pulsing: ReadonlySet<string>;
  // The items a Revision just added or changed, until `flashUntil` (Date.now()).
  flashing: ReadonlySet<string>;
  flashUntil: number | null;
  // How many Revisions have flashed: odd ones flash, even ones reflash.
  flashes: number;
  // Follow agent held off for the rest of this turn: the Timeline was scrolled or zoomed by hand.
  followHeld: boolean;
}

const NONE: ReadonlySet<string> = new Set();
// No ids: a stable fallback, for a selector read outside the Advanced Edit.
export const NO_IDS = NONE;
export const IDLE: PresenceState = { status: "idle", label: "", target: null, pulsing: NONE, flashing: NONE, flashUntil: null, flashes: 0, followHeld: false };

export function presenceStore(initial: PresenceState = IDLE) {
  let state = initial;
  // The items the last Revision touched (what a running tool call pulses), and the providers' names.
  let lastTouched: ReadonlySet<string> = NONE;
  let names: Record<string, string> = {};
  let provider = "";
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  function set(change: Partial<PresenceState>) {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  }

  function heard(event: AgentStreamEvent) {
    switch (event.type) {
      case "turn_started":
        clearTimeout(idleTimer);
        provider = event.provider;
        set({ status: "thinking", label: names[provider] ?? provider, pulsing: NONE, followHeld: false });
        return;
      case "tool_started":
        clearTimeout(idleTimer);
        set({ status: "editing", pulsing: lastTouched });
        return;
      case "tool_finished":
        if (state.status !== "idle") set({ status: "thinking", pulsing: NONE });
        return;
      case "turn_finished":
        set({ pulsing: NONE });
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => set({ status: "idle" }), IDLE_AFTER_MS);
        return;
      case "ready":
        // Reconnected with no turn running: a finish missed meanwhile.
        if (!Object.keys(event.running).length && state.status !== "idle") set({ status: "idle", pulsing: NONE });
        return;
    }
  }

  /** A Revision the Agent saved changed `touched`; the first of them, with a place, is at `target`. */
  function revised(touched: Touched, target: PresenceTarget | null) {
    const ids = new Set(touched.items.filter((item) => item.how !== "removed").map((item) => item.id));
    if (touched.flags.includes("hook")) ids.add("hook");
    lastTouched = ids;
    clearTimeout(flashTimer);
    if (!ids.size && !target) return;
    set({ flashing: ids, flashUntil: Date.now() + FLASH_MS, flashes: state.flashes + 1, ...(target && { target }) });
    flashTimer = setTimeout(() => set({ flashing: NONE, flashUntil: null }), FLASH_MS);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    heard,
    revised,
    /** How item `id` is marked now: a flash wins over a pulse. */
    markOf(id: string): PresenceMark | null {
      if (state.flashing.has(id)) return state.flashes % 2 ? "flash" : "reflash";
      return state.pulsing.has(id) ? "pulse" : null;
    },
    /** The Agent Providers' names, by id, for the cursor's pill. */
    named(byId: Record<string, string>) {
      names = byId;
      if (provider && names[provider] && state.label !== names[provider]) set({ label: names[provider] });
    },
    /** The Timeline was scrolled or zoomed by hand: Follow agent rests until the next turn. */
    holdFollow() {
      if (!state.followHeld) set({ followHeld: true });
    },
    /** Its timers stopped: the editor is closed. */
    dispose() {
      clearTimeout(flashTimer);
      clearTimeout(idleTimer);
    },
  };
}

export type PresenceStore = ReturnType<typeof presenceStore>;

// The editor's presence store, for what draws presence below it; none outside the Advanced Edit.
export const PresenceContext = createContext<PresenceStore | null>(null);

const never = () => () => {};

/** Presence as `select` gives it: the component renders again only when that changes. */
export function usePresence<T>(select: (state: PresenceState, store: PresenceStore) => T, fallback: T): T {
  const store = useContext(PresenceContext);
  const read = useCallback(() => (store ? select(store.getSnapshot(), store) : fallback), [store, select, fallback]);
  return useSyncExternalStore(store?.subscribe ?? never, read, read);
}

/**
 * How item `id` is marked (pulsing, flashing, or not): a derived value per item, so that one flash
 * renders only the items it marks again.
 */
export function useAgentMark(id: string | undefined): PresenceMark | null {
  const store = useContext(PresenceContext);
  const read = useCallback(() => (store && id ? store.markOf(id) : null), [store, id]);
  return useSyncExternalStore(store?.subscribe ?? never, read, read);
}
