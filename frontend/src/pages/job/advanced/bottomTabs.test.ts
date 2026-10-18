// .scratch/workspace-layout/issues/06: the bottom area is a registry — Timeline and Keyframes now,
// Meters left out until #14 — and `useBottomTab` reads/writes `bottomTab` in the layout store. These
// test the registry and the store path, not the DOM (no jsdom here).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { activeBottomTab, BOTTOM_TABS, bottomPanelId } from "./BottomTabs";
import { DEFAULT_LAYOUT, layout } from "./workspaceLayout";

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BOTTOM_TABS registry", () => {
  test("registers exactly timeline then keyframes (Meters absent until #14)", () => {
    expect(BOTTOM_TABS.map((tab) => tab.value)).toEqual(["timeline", "keyframes"]);
    expect(BOTTOM_TABS.some((tab) => tab.value === "meters")).toBe(false);
  });

  test("every tab has a label and a render, and the Timeline stays mounted", () => {
    for (const tab of BOTTOM_TABS) {
      expect(tab.label).toBeTruthy();
      expect(typeof tab.render).toBe("function");
    }
    const timeline = BOTTOM_TABS.find((tab) => tab.value === "timeline")!;
    expect(timeline.keepMounted).toBe(true);
    const keyframes = BOTTOM_TABS.find((tab) => tab.value === "keyframes")!;
    expect(keyframes.keepMounted).toBeFalsy();
  });
});

describe("bottomPanelId", () => {
  test("is `bottom-<value>` for each registered tab", () => {
    expect(bottomPanelId("timeline")).toBe("bottom-timeline");
    expect(bottomPanelId("keyframes")).toBe("bottom-keyframes");
  });
});

describe("activeBottomTab", () => {
  test("keeps a registered tab", () => {
    expect(activeBottomTab("timeline")).toBe("timeline");
    expect(activeBottomTab("keyframes")).toBe("keyframes");
  });

  test("falls back to the first registered tab for an unregistered stored value", () => {
    // "meters" is a valid stored BottomTab but not registered yet (#14).
    expect(activeBottomTab("meters")).toBe("timeline");
    expect(activeBottomTab("meters")).toBe(BOTTOM_TABS[0].value);
  });
});

describe("useBottomTab's write path (layout.setBottomTab)", () => {
  test("setBottomTab writes bottomTab to the store", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    layout.setBottomTab("keyframes");
    expect(layout.read().bottomTab).toBe("keyframes");
    layout.setBottomTab("timeline");
    expect(layout.read().bottomTab).toBe("timeline");
  });

  test("the stored bottomTab, clamped to a registered tab, is what useBottomTab would show", () => {
    // A stored "meters" (before it ships) must not crash: the active tab is the first registered one.
    vi.stubGlobal(
      "localStorage",
      fakeStorage({ "ai-clipper-advanced-layout": JSON.stringify({ ...DEFAULT_LAYOUT, bottomTab: "meters" }) }),
    );
    expect(layout.read().bottomTab).toBe("meters");
    expect(activeBottomTab(layout.read().bottomTab)).toBe("timeline");
  });
});
