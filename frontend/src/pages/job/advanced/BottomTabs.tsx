import { cx } from "../../../format";
import { rememberedSwitch } from "../../../remembered";

/**
 * The bottom of the desktop's Advanced Edit: the Timeline, or the Keyframes pane (ADR 0008). Which is
 * open is remembered per browser; without storage it is the Timeline, and a change lasts for the
 * page's life only. A bare tab bar, for `workspace-layout` to take into its tabbed bottom area.
 */
const keyframesOpen = rememberedSwitch("ai-clipper-keyframes-pane", false);

export type BottomTab = "timeline" | "keyframes";

const TABS: { value: BottomTab; label: string }[] = [
  { value: "timeline", label: "Timeline" },
  { value: "keyframes", label: "Keyframes" },
];

/** The open bottom tab, and what opens another. */
export function useBottomTab(): [BottomTab, (tab: BottomTab) => void] {
  const open = keyframesOpen.use();
  return [open ? "keyframes" : "timeline", (tab) => keyframesOpen.set(tab === "keyframes")];
}

/** The id of tab `tab`'s panel, which it controls. */
export const bottomPanelId = (tab: BottomTab) => `bottom-${tab}`;

export function BottomTabs({ value, onChange }: { value: BottomTab; onChange: (tab: BottomTab) => void }) {
  return (
    <div role="tablist" aria-label="Bottom" className="flex shrink-0 gap-1 px-2 pt-1.5">
      {TABS.map((tab) => (
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
