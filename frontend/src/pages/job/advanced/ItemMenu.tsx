import { useLayoutEffect, useRef, type KeyboardEvent, type SyntheticEvent } from "react";

/** One thing an item's context menu does. */
export interface MenuEntry {
  label: string;
  onSelect: () => void;
}

// How far the menu stays from the window's edges, in CSS pixels.
const EDGE_PX = 8;

/**
 * An item's context menu (a right-click, or the keyboard's menu key, on it on the Timeline), opened
 * `at` a point of the window: a popover in the top layer, so that the scrolling Timeline doesn't clip
 * it, kept in the window. Light dismiss and Escape close it; the arrow keys, Home and End go through
 * its entries, the first of which has the focus. Choosing one closes it. `onClose` once it is closed.
 * What happens in it stays in it: the item under it doesn't take its presses as a drag or a pick.
 */
export function ItemMenu({ at, label, entries, onClose }: { at: { x: number; y: number }; label: string; entries: MenuEntry[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const closed = useRef(onClose);
  closed.current = onClose;

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const toggled = (event: Event) => {
      if ((event as ToggleEvent).newState === "closed") closed.current();
    };
    element.addEventListener("toggle", toggled);
    element.showPopover();
    // Down and right of the point, or up and left of it where the window ends.
    const left = at.x + element.offsetWidth > window.innerWidth - EDGE_PX ? at.x - element.offsetWidth : at.x;
    const top = at.y + element.offsetHeight > window.innerHeight - EDGE_PX ? at.y - element.offsetHeight : at.y;
    element.style.left = `${Math.max(EDGE_PX, left)}px`;
    element.style.top = `${Math.max(EDGE_PX, top)}px`;
    element.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      element.removeEventListener("toggle", toggled);
      if (element.matches(":popover-open")) element.hidePopover();
    };
  }, [at]);

  const hide = () => {
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
  };
  const contained = (event: SyntheticEvent) => event.stopPropagation();
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const now = items.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: now + 1, ArrowUp: now - 1, Home: 0, End: items.length - 1 }[event.key];
    if (to === undefined || !items.length) return;
    event.preventDefault();
    items[(to + items.length) % items.length].focus();
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      {...{ popover: "auto" }}
      className="glass fixed inset-auto m-0 min-w-44 flex-col rounded-[10px] bg-bg/90! p-1 text-text [&:popover-open]:flex"
      onPointerDown={contained}
      onPointerUp={contained}
      onPointerMove={contained}
      onClick={contained}
      onDoubleClick={contained}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry) => (
        <button
          key={entry.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            hide();
            entry.onSelect();
          }}
          className="min-h-9 rounded-md px-2 text-left text-sm hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
