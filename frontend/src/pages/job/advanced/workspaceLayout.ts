// .scratch/workspace-layout/issues/01, ADR 0024: the Advanced Edit's workspace is hand-built and
// browser-remembered — the sidebars' widths and the bottom area's height, which sidebars are
// collapsed, and the open bottom tab, all under one key. Sizes are clamped to their bounds and the
// visible sidebars always leave the player a floor of width (the floor beats a sidebar's max). Widths
// are in rem, the bottom's height in dvh.
import { useSyncExternalStore } from "react";
import { rememberedValue } from "../../../remembered";

export const ASSET = { def: 17, min: 14, max: 28 };
export const INSPECTOR = { def: 20, min: 16, max: 34 };
export const PLAYER_FLOOR = 24; // rem of player content width the sidebars must leave
export const BOTTOM = { def: 40, min: 22, max: 70 }; // dvh

export type Bounds = { def: number; min: number; max: number };

export type BottomTab = "timeline" | "keyframes" | "meters";

export type WorkspaceLayout = {
  assetW: number;
  inspectorW: number;
  bottomH: number;
  assetHidden: boolean;
  inspectorHidden: boolean;
  bottomTab: BottomTab;
};

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  assetW: ASSET.def,
  inspectorW: INSPECTOR.def,
  bottomH: BOTTOM.def,
  assetHidden: false,
  inspectorHidden: false,
  bottomTab: "timeline",
};

const KEY = "ai-clipper-advanced-layout";
const OLD_KEYFRAMES_KEY = "ai-clipper-keyframes-pane";
const BOTTOM_TABS: BottomTab[] = ["timeline", "keyframes", "meters"];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Clamp a sidebar width to its [min, max]. */
export const clampWidth = (value: number, bounds: Bounds) => clamp(value, bounds.min, bounds.max);

/** Clamp the bottom area's height to BOTTOM's [min, max] (dvh). */
export const clampBottomH = (value: number) => clamp(value, BOTTOM.min, BOTTOM.max);

const asBottomTab = (value: unknown): BottomTab =>
  BOTTOM_TABS.includes(value as BottomTab) ? (value as BottomTab) : "timeline";

/**
 * Shorten the visible sidebars, if need be, so that a container `availableRem` wide still leaves the
 * player at least PLAYER_FLOOR. A hidden sidebar contributes 0 and is returned unchanged. The visible
 * ones shrink only down to their mins; if even the mins overflow a tiny container they are returned
 * as-is and the UI overflows gracefully. The divider drag and the shell both use this with the
 * measured container width.
 */
export function fitSidebars(
  assetW: number,
  inspectorW: number,
  availableRem: number,
  { assetHidden, inspectorHidden }: { assetHidden: boolean; inspectorHidden: boolean },
): { assetW: number; inspectorW: number } {
  const budget = availableRem - PLAYER_FLOOR;
  const visibleAsset = assetHidden ? 0 : assetW;
  const visibleInspector = inspectorHidden ? 0 : inspectorW;
  const overflow = visibleAsset + visibleInspector - budget;
  if (overflow <= 0) return { assetW, inspectorW };

  // Take the overflow from the visible sidebars, each only down to its min, the inspector first.
  let fitInspector = inspectorW;
  let fitAsset = assetW;
  let left = overflow;
  if (!inspectorHidden) {
    const give = Math.min(left, inspectorW - INSPECTOR.min);
    fitInspector = inspectorW - give;
    left -= give;
  }
  if (!assetHidden && left > 0) {
    const give = Math.min(left, assetW - ASSET.min);
    fitAsset = assetW - give;
  }
  return { assetW: fitAsset, inspectorW: fitInspector };
}

/**
 * The desktop grid's `grid-template-columns`, listing only the columns that render, in source order
 * asset | player | inspector. The player's is always `minmax(0,1fr)`; a hidden sidebar drops its
 * track. At the defaults this is `"17rem minmax(0,1fr) 20rem"`, so the shell is unchanged.
 */
export function gridTemplateColumns(
  l: Pick<WorkspaceLayout, "assetW" | "inspectorW" | "assetHidden" | "inspectorHidden">,
): string {
  const cols: string[] = [];
  if (!l.assetHidden) cols.push(`${l.assetW}rem`);
  cols.push("minmax(0,1fr)");
  if (!l.inspectorHidden) cols.push(`${l.inspectorW}rem`);
  return cols.join(" ");
}

/** The bottom area's CSS height, one height for every tab (dvh). */
export function bottomHeightCss(l: Pick<WorkspaceLayout, "bottomH">): string {
  return `${l.bottomH}dvh`;
}

/**
 * Clamp a live drag of ONE sidebar: to its own [min, max], and to at most what leaves the player its
 * floor beside the other visible sidebar. The own min wins if the floor would demand less. Used by
 * the divider drag.
 */
export function clampSidebarAgainstPlayer(
  value: number,
  otherVisibleW: number,
  availableRem: number,
  bounds: Bounds,
): number {
  const roomForPlayer = availableRem - PLAYER_FLOOR - otherVisibleW;
  const max = Math.max(bounds.min, Math.min(bounds.max, roomForPlayer));
  return clamp(value, bounds.min, max);
}

// A partial/old/bad blob fills its missing fields from the defaults, and every field is clamped or
// validated on the way out.
const normalise = (raw: Partial<WorkspaceLayout> | null | undefined): WorkspaceLayout => {
  const merged = { ...DEFAULT_LAYOUT, ...(raw ?? {}) };
  return {
    assetW: clampWidth(merged.assetW, ASSET),
    inspectorW: clampWidth(merged.inspectorW, INSPECTOR),
    bottomH: clampBottomH(merged.bottomH),
    assetHidden: Boolean(merged.assetHidden),
    inspectorHidden: Boolean(merged.inspectorHidden),
    bottomTab: asBottomTab(merged.bottomTab),
  };
};

const stored = rememberedValue<Partial<WorkspaceLayout>>(KEY, DEFAULT_LAYOUT);

const write = (next: WorkspaceLayout) => stored.set(next);

// Normalise once per stored snapshot (whose identity rememberedValue keeps stable per raw string), so
// `read` and `use` hand out a stable reference — useSyncExternalStore needs a cached snapshot.
let snapFrom: Partial<WorkspaceLayout> | null = null;
let snapValue: WorkspaceLayout = DEFAULT_LAYOUT;
let snapped = false;
const current = (): WorkspaceLayout => {
  const raw = stored.read();
  if (snapped && raw === snapFrom) return snapValue;
  snapFrom = raw;
  snapValue = normalise(raw);
  snapped = true;
  return snapValue;
};

export const layout = {
  /** The current layout, merged over the defaults and clamped/validated. */
  read: current,
  setAssetW: (value: number) => write({ ...current(), assetW: clampWidth(value, ASSET) }),
  setInspectorW: (value: number) => write({ ...current(), inspectorW: clampWidth(value, INSPECTOR) }),
  setBottomH: (value: number) => write({ ...current(), bottomH: clampBottomH(value) }),
  setAssetHidden: (hidden: boolean) => write({ ...current(), assetHidden: hidden }),
  setInspectorHidden: (hidden: boolean) => write({ ...current(), inspectorHidden: hidden }),
  setBottomTab: (tab: BottomTab) => write({ ...current(), bottomTab: asBottomTab(tab) }),
  /** Back to the defaults, but keep the open bottom tab. */
  resetLayout: () => write({ ...DEFAULT_LAYOUT, bottomTab: current().bottomTab }),
  /** The current layout as a React hook. */
  use: (): WorkspaceLayout => useSyncExternalStore(stored.subscribe, current),
};

/**
 * Seed the new blob once from the old keyframes-pane switch: if the new key is absent and the old key
 * exists, write a layout whose bottomTab is "keyframes" when it was on, else "timeline". Once the new
 * blob exists the old key is never read again — the presence check below returns first.
 */
export function migrateOnce(): void {
  let existing: string | null;
  try {
    existing = localStorage.getItem(KEY);
  } catch {
    return; // Storage blocked: nothing to migrate into.
  }
  if (existing !== null) return;

  let old: string | null;
  try {
    old = localStorage.getItem(OLD_KEYFRAMES_KEY);
  } catch {
    return;
  }
  if (old === null) return;

  write({ ...DEFAULT_LAYOUT, bottomTab: old === "on" ? "keyframes" : "timeline" });
}

migrateOnce();
