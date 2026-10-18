import type { ReactNode } from "react";
import type { MediaItem } from "../../../api";
import { cx } from "../../../format";
import { KeyingContext, type Keying } from "./KeyCluster";
import { KeyframesPane } from "./KeyframesPane";
import { layout, type BottomTab } from "./workspaceLayout";

/**
 * The bottom of the desktop's Advanced Edit: a small registry of tabs — the Timeline and the
 * Keyframes pane (ADR 0008) now, Meters once `audio-mixing` (#14) registers it — so a later view
 * joins by adding one entry, with no change to the shell (ADR 0024). The open tab is remembered per
 * browser in the layout store (`workspaceLayout.ts`); which panel renders, and the ARIA tab markup,
 * are both driven by BOTTOM_TABS.
 */

/** What a bottom panel is handed to render, from the Advanced Edit's in-scope values. */
export type BottomTabContext = {
  timeline: ReactNode;
  keying: Keying;
  fps: number;
  mediaById: Map<string, MediaItem>;
};

/**
 * One registered tab: its stored `value`, its label, whether it stays mounted while hidden (the
 * Timeline does, to keep its zoom and scroll), and how it renders from the context.
 */
export type BottomTabDef = {
  value: BottomTab;
  label: string;
  keepMounted?: boolean;
  render: (ctx: BottomTabContext) => ReactNode;
};

/** The registered bottom tabs, the single source of truth for which tabs exist. Meters is left out
 *  until `audio-mixing` (#14), which registers it here with no other shell change. */
export const BOTTOM_TABS: BottomTabDef[] = [
  { value: "timeline", label: "Timeline", keepMounted: true, render: (c) => c.timeline },
  {
    value: "keyframes",
    label: "Keyframes",
    render: (c) => (
      <KeyingContext.Provider value={c.keying}>
        <KeyframesPane keying={c.keying} fps={c.fps} mediaById={c.mediaById} />
      </KeyingContext.Provider>
    ),
  },
];

/**
 * The active tab for display: the stored one if it is registered, else the first registered tab (so a
 * stored "meters" before it ships falls back to the Timeline without crashing or rewriting storage).
 */
export function activeBottomTab(stored: BottomTab): BottomTab {
  return BOTTOM_TABS.some((tab) => tab.value === stored) ? stored : BOTTOM_TABS[0].value;
}

/** The open bottom tab (clamped to a registered one), and what opens another. */
export function useBottomTab(): [BottomTab, (tab: BottomTab) => void] {
  const ws = layout.use();
  return [activeBottomTab(ws.bottomTab), layout.setBottomTab];
}

/** The id of tab `tab`'s panel, which it controls. */
export const bottomPanelId = (tab: BottomTab) => `bottom-${tab}`;

export function BottomTabs({ value, onChange }: { value: BottomTab; onChange: (tab: BottomTab) => void }) {
  return (
    <div role="tablist" aria-label="Bottom" className="flex shrink-0 gap-1 px-2 pt-1.5">
      {BOTTOM_TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={bottomPanelId(tab.value)}
          onClick={() => onChange(tab.value)}
          className={cx(
            "min-h-8 rounded-[10px] px-3 text-sm font-medium",
            "focus-visible:outline-2 focus-visible:outline-focus",
            value === tab.value ? "raised text-text" : "text-muted hover:bg-fill hover:text-text",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
