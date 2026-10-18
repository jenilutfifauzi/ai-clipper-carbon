// A JSON value remembered per browser, the twin of rememberedSwitch: round-trips through storage,
// falls back to its initial when storage is bad or blocked, and hears another tab's change.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { rememberedValue } from "./remembered";

// A fake localStorage over a plain map; a getter can be made to throw to mimic blocked site data.
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

// The window's `storage` listeners, so a test can fire a cross-tab change by hand.
let storageListeners: ((event: StorageEvent) => void)[];

beforeEach(() => {
  storageListeners = [];
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
      if (type === "storage") storageListeners.push(listener);
    },
    removeEventListener: (type: string, listener: (event: StorageEvent) => void) => {
      if (type === "storage") storageListeners = storageListeners.filter((other) => other !== listener);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fireStorage = (key: string | null) => {
  for (const listener of storageListeners) listener({ key } as StorageEvent);
};

describe("rememberedValue", () => {
  test("round-trips a JSON value through storage", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const store = rememberedValue<Record<string, unknown>>("k", { a: 1 });
    expect(store.read()).toEqual({ a: 1 });
    store.set({ a: 2, b: [3] });
    expect(store.read()).toEqual({ a: 2, b: [3] });
    expect(localStorage.getItem("k")).toBe('{"a":2,"b":[3]}');
  });

  test("falls back to its initial when the stored value is bad JSON", () => {
    vi.stubGlobal("localStorage", fakeStorage({ k: "{not json" }));
    const store = rememberedValue("k", { a: 1 });
    expect(store.read()).toEqual({ a: 1 });
  });

  test("falls back to its initial when reading throws (storage blocked)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    const store = rememberedValue("k", { a: 7 });
    expect(store.read()).toEqual({ a: 7 });
    // A set is still applied in memory even when storage refuses it.
    store.set({ a: 8 });
    expect(store.read()).toEqual({ a: 8 });
  });

  test("reacts to another tab's storage event", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const store = rememberedValue("k", 0);
    const heard: number[] = [];
    const unsubscribe = store.subscribe(() => heard.push(store.read() as number));

    storage.setItem("k", "5");
    fireStorage("k");
    expect(heard).toEqual([5]);

    // A clear-all (key null) is heard too.
    storage.setItem("k", "6");
    fireStorage(null);
    expect(heard).toEqual([5, 6]);

    // An unrelated key is ignored, and after unsubscribe nothing is heard.
    fireStorage("other");
    unsubscribe();
    storage.setItem("k", "9");
    fireStorage("k");
    expect(heard).toEqual([5, 6]);
  });

  test("read returns a stable reference until the stored raw changes", () => {
    // useSyncExternalStore needs a cached snapshot: re-reading an unchanged value must give the same
    // object, or a consumer would re-render forever.
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const store = rememberedValue<Record<string, unknown>>("k", { a: 1 });
    store.set({ a: 2 });
    const first = store.read();
    expect(store.read()).toBe(first); // same reference, no reparse
    store.set({ a: 3 });
    expect(store.read()).not.toBe(first); // a real change gives a new reference
  });
});
