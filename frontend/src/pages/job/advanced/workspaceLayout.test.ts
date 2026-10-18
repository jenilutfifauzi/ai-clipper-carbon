// .scratch/workspace-layout/issues/01: the Advanced Edit's hand-built, browser-remembered layout —
// the pure clamp/fit helpers, the store merged over defaults, reset, and the one-time migration
// from the old keyframes-pane switch.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ASSET,
  BOTTOM,
  clampBottomH,
  clampSidebarAgainstPlayer,
  clampWidth,
  DEFAULT_LAYOUT,
  fitSidebars,
  INSPECTOR,
  layout,
  migrateOnce,
  PLAYER_FLOOR,
} from "./workspaceLayout";

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

describe("clampWidth / clampBottomH", () => {
  test("clampWidth clamps to its bounds", () => {
    expect(clampWidth(ASSET.min - 5, ASSET)).toBe(ASSET.min);
    expect(clampWidth(ASSET.max + 5, ASSET)).toBe(ASSET.max);
    expect(clampWidth(ASSET.def, ASSET)).toBe(ASSET.def);
    expect(clampWidth(INSPECTOR.max + 100, INSPECTOR)).toBe(INSPECTOR.max);
  });

  test("clampBottomH clamps to BOTTOM's bounds", () => {
    expect(clampBottomH(BOTTOM.min - 10)).toBe(BOTTOM.min);
    expect(clampBottomH(BOTTOM.max + 10)).toBe(BOTTOM.max);
    expect(clampBottomH(BOTTOM.def)).toBe(BOTTOM.def);
  });
});

describe("fitSidebars", () => {
  test("shrinks both sidebars at max so the player keeps its floor (floor beats max)", () => {
    // 28 + 34 = 62 visible; with floor 24 the budget for sidebars on a 64rem container is 40.
    const fitted = fitSidebars(ASSET.max, INSPECTOR.max, 64, { assetHidden: false, inspectorHidden: false });
    expect(fitted.assetW + fitted.inspectorW).toBeLessThanOrEqual(64 - PLAYER_FLOOR + 1e-9);
    // Not below either min.
    expect(fitted.assetW).toBeGreaterThanOrEqual(ASSET.min);
    expect(fitted.inspectorW).toBeGreaterThanOrEqual(INSPECTOR.min);
  });

  test("a hidden sidebar contributes 0 to the budget and is left untouched", () => {
    // Container 60rem: budget 36. If the hidden inspector counted, asset+inspector = 62 would overflow
    // and the asset would be shrunk. Because it counts 0, only the asset's 28 is weighed against 36, so
    // it fits whole and nothing moves.
    const fitted = fitSidebars(ASSET.max, INSPECTOR.max, 60, { assetHidden: false, inspectorHidden: true });
    expect(fitted.assetW).toBe(ASSET.max);
    expect(fitted.inspectorW).toBe(INSPECTOR.max);
  });

  test("leaves sidebars untouched when they already fit", () => {
    const fitted = fitSidebars(ASSET.def, INSPECTOR.def, 100, { assetHidden: false, inspectorHidden: false });
    expect(fitted).toEqual({ assetW: ASSET.def, inspectorW: INSPECTOR.def });
  });

  test("returns the mins when even the mins overflow a tiny container", () => {
    const fitted = fitSidebars(ASSET.max, INSPECTOR.max, 10, { assetHidden: false, inspectorHidden: false });
    expect(fitted).toEqual({ assetW: ASSET.min, inspectorW: INSPECTOR.min });
  });
});

describe("clampSidebarAgainstPlayer", () => {
  test("caps a drag against the other visible sidebar plus the player floor", () => {
    // availableRem 64, other sidebar visible at 20, floor 24 → this one may be at most 20rem.
    const capped = clampSidebarAgainstPlayer(ASSET.max, 20, 64, ASSET);
    expect(capped).toBe(64 - PLAYER_FLOOR - 20);
  });

  test("still respects the sidebar's own min and max", () => {
    expect(clampSidebarAgainstPlayer(ASSET.min - 5, 0, 1000, ASSET)).toBe(ASSET.min);
    expect(clampSidebarAgainstPlayer(ASSET.max + 5, 0, 1000, ASSET)).toBe(ASSET.max);
  });

  test("never returns below min even when the player floor would demand it", () => {
    // Other sidebar eats almost everything: cap would fall below min, so min wins.
    const capped = clampSidebarAgainstPlayer(ASSET.max, 40, 64, ASSET);
    expect(capped).toBe(ASSET.min);
  });
});

describe("store.read", () => {
  test("merges a partial stored blob over the defaults", () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({ "ai-clipper-advanced-layout": JSON.stringify({ assetW: 15, bottomTab: "meters" }) }),
    );
    expect(layout.read()).toEqual({
      ...DEFAULT_LAYOUT,
      assetW: 15,
      bottomTab: "meters",
    });
  });

  test("clamps out-of-range stored values on the way out", () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({
        "ai-clipper-advanced-layout": JSON.stringify({
          assetW: 999,
          inspectorW: 1,
          bottomH: 999,
          bottomTab: "nonsense",
        }),
      }),
    );
    const read = layout.read();
    expect(read.assetW).toBe(ASSET.max);
    expect(read.inspectorW).toBe(INSPECTOR.min);
    expect(read.bottomH).toBe(BOTTOM.max);
    expect(read.bottomTab).toBe("timeline");
  });

  test("falls back to the defaults when nothing is stored", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(layout.read()).toEqual(DEFAULT_LAYOUT);
  });
});

describe("store setters", () => {
  test("each setter clamps/validates and writes the whole blob", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);

    layout.setAssetW(999);
    layout.setInspectorW(1);
    layout.setBottomH(999);
    layout.setAssetHidden(true);
    layout.setBottomTab("keyframes");

    const stored = JSON.parse(storage.map.get("ai-clipper-advanced-layout")!);
    expect(stored.assetW).toBe(ASSET.max);
    expect(stored.inspectorW).toBe(INSPECTOR.min);
    expect(stored.bottomH).toBe(BOTTOM.max);
    expect(stored.assetHidden).toBe(true);
    expect(stored.bottomTab).toBe("keyframes");

    layout.setBottomTab("nonsense" as never);
    expect(layout.read().bottomTab).toBe("timeline");
  });
});

describe("resetLayout", () => {
  test("restores sizes and collapse but preserves the open bottom tab", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    layout.setAssetW(ASSET.max);
    layout.setInspectorHidden(true);
    layout.setBottomTab("meters");

    layout.resetLayout();

    expect(layout.read()).toEqual({ ...DEFAULT_LAYOUT, bottomTab: "meters" });
  });
});

describe("migrateOnce", () => {
  test("seeds bottomTab from the old keyframes-pane key when the new blob is absent", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "ai-clipper-keyframes-pane": "on" }));
    migrateOnce();
    expect(layout.read().bottomTab).toBe("keyframes");
  });

  test("seeds timeline when the old key is off", () => {
    vi.stubGlobal("localStorage", fakeStorage({ "ai-clipper-keyframes-pane": "off" }));
    migrateOnce();
    expect(layout.read().bottomTab).toBe("timeline");
  });

  test("does nothing when the new blob already exists, even if the old key says keyframes", () => {
    const storage = fakeStorage({
      "ai-clipper-advanced-layout": JSON.stringify({ ...DEFAULT_LAYOUT, bottomTab: "timeline" }),
      "ai-clipper-keyframes-pane": "on",
    });
    vi.stubGlobal("localStorage", storage);
    migrateOnce();
    // The new blob was untouched: still timeline, not seeded to keyframes.
    expect(layout.read().bottomTab).toBe("timeline");
  });

  test("does not consult the old key after the new blob exists", () => {
    const storage = fakeStorage({ "ai-clipper-keyframes-pane": "on" });
    let oldKeyReads = 0;
    const spied = {
      ...storage,
      getItem: (key: string) => {
        if (key === "ai-clipper-keyframes-pane") oldKeyReads += 1;
        return storage.getItem(key);
      },
    };
    vi.stubGlobal("localStorage", spied);

    migrateOnce();
    expect(layout.read().bottomTab).toBe("keyframes");
    const readsAfterFirst = oldKeyReads;

    // A second migration now that the new blob exists must not read the old key again.
    migrateOnce();
    expect(oldKeyReads).toBe(readsAfterFirst);
  });
});
