import { useEffect, useLayoutEffect, useRef, type KeyboardEvent } from "react";

// The menu's distance from the window's edges.
const EDGE_PX = 8;

export interface MenuEntry {
  label: string;
  onSelect: () => void;
  // Why it can't be chosen now, which it then says as its description.
  disabled?: string | null;
}

/**
 * A Timeline item's context menu, opened at `at` (where it was right-clicked, or the item's corner
 * for the keyboard's menu key): a popover in the top layer, kept in the window, its first entry
 * focused. ↑ and ↓ move between the entries; Escape, a click elsewhere or choosing one closes it.
 */
export function ItemMenu({ label, at, entries, onClose }: { label: string; at: { x: number; y: number }; entries: MenuEntry[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    if (!element.matches(":popover-open")) element.showPopover();
    // At the pointer, or above and before it where the window ends.
    const left = at.x + element.offsetWidth > window.innerWidth - EDGE_PX ? at.x - element.offsetWidth : at.x;
    const top = at.y + element.offsetHeight > window.innerHeight - EDGE_PX ? at.y - element.offsetHeight : at.y;
    element.style.left = `${Math.max(EDGE_PX, left)}px`;
    element.style.top = `${Math.max(EDGE_PX, top)}px`;
    element.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [at]);

  // Light dismiss and Escape close the popover; the menu goes with it.
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const toggled = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") onClose();
    };
    element.addEventListener("toggle", toggled);
    return () => element.removeEventListener("toggle", toggled);
  }, [onClose]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Its keys are its own, not the editor's shortcuts (Space playing, the arrows moving the playhead).
    event.stopPropagation();
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const now = items.indexOf(document.activeElement as HTMLElement);
    items[(now + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      {...{ popover: "auto" }}
      onKeyDown={onKeyDown}
      className="glass fixed inset-auto m-0 min-w-48 flex-col rounded-[10px] bg-bg/90! p-1 text-text [&:popover-open]:flex"
    >
      {entries.map((entry) => (
        <button
          key={entry.label}
          type="button"
          role="menuitem"
          aria-disabled={!!entry.disabled}
          title={entry.disabled ?? undefined}
          onClick={() => {
            if (entry.disabled) return;
            menu.current?.hidePopover();
            entry.onSelect();
          }}
          className="flex min-h-9 flex-col justify-center rounded-md px-2 text-left text-sm hover:bg-fill focus-visible:bg-fill focus-visible:outline-none aria-disabled:opacity-60 aria-disabled:hover:bg-transparent"
        >
          {entry.label}
          {entry.disabled && <span className="text-xs text-muted">{entry.disabled}</span>}
        </button>
      ))}
    </div>
  );
}
