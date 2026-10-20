import { forwardRef, useCallback, useRef, useState, type ReactNode } from "react";

// The menu's distance from its button, and from the window's edges.
const GAP_PX = 4;
const EDGE_PX = 8;

/**
 * A menu opened from a button: a popover in the top layer, so that a scrolling panel doesn't clip
 * it, placed under the button (its right edge at the button's) or above it when there is no room,
 * kept in the window. Light dismiss and Escape close it. Give `buttonRef` and the `aria-expanded`
 * (`open`) to the button that `toggle`s it, and `menuRef` to its <Menu>.
 */
export function useMenu() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  // A callback ref, so that a menu shown again after being taken out (while its Preset is renamed,
  // say) is listened to again.
  const toggled = useCallback((event: Event) => setOpen((event as ToggleEvent).newState === "open"), []);
  const menuRef = useCallback(
    (element: HTMLDivElement | null) => {
      menu.current?.removeEventListener("toggle", toggled);
      menu.current = element;
      element?.addEventListener("toggle", toggled);
    },
    [toggled],
  );

  const show = useCallback(() => {
    const anchor = buttonRef.current?.getBoundingClientRect();
    const element = menu.current;
    if (!anchor || !element) return;
    element.showPopover();
    const left = Math.min(Math.max(anchor.right - element.offsetWidth, EDGE_PX), window.innerWidth - element.offsetWidth - EDGE_PX);
    const below = anchor.bottom + GAP_PX;
    const top = below + element.offsetHeight > window.innerHeight - EDGE_PX ? anchor.top - GAP_PX - element.offsetHeight : below;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(EDGE_PX, top)}px`;
  }, []);
  const hide = useCallback(() => {
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
  }, []);
  const toggle = useCallback(() => (menu.current?.matches(":popover-open") ? hide() : show()), [hide, show]);

  return { buttonRef, menuRef, open, show, hide, toggle };
}

/** The menu `useMenu` opens: its items, and anything said under them (such as why one failed). */
export const Menu = forwardRef<HTMLDivElement, { label: string; children: ReactNode }>(function Menu({ label, children }, ref) {
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      {...{ popover: "auto" }}
      className="glass fixed inset-auto m-0 min-w-44 flex-col rounded-[10px] bg-bg/90! p-1 text-text [&:popover-open]:flex"
    >
      {children}
    </div>
  );
});

export function MenuItem({ children, danger, disabled, onClick }: { children: ReactNode; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-fill disabled:opacity-60 disabled:hover:bg-transparent ${danger ? "text-danger" : ""}`}
    >
      {children}
    </button>
  );
}
