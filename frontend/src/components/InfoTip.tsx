import { Info } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

// Hover waits this long before showing, and leaving waits this long before hiding (so the pointer can
// move onto the tip, which stays while it is over it).
const SHOW_MS = 150;
const HIDE_MS = 150;
// The tip's distance from its button, and from the window's edges.
const GAP_PX = 6;
const EDGE_PX = 8;

/**
 * An (i) button with more about a short hint beside it, shown on hover, focus or a tap. The tip is a
 * popover in the top layer (so a scrolling panel doesn't clip it), placed under the button and kept
 * in the window; light dismiss and Escape close it (WCAG 1.4.13: dismissible, hoverable, persistent).
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function place() {
    const anchor = button.current?.getBoundingClientRect();
    const element = tip.current;
    if (!anchor || !element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, EDGE_PX), window.innerWidth - width - EDGE_PX);
    // Under the button, or over it where there is no room below.
    const below = anchor.bottom + GAP_PX;
    const top = below + height > window.innerHeight - EDGE_PX ? anchor.top - GAP_PX - height : below;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(EDGE_PX, top)}px`;
  }

  function show(delay = 0) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const element = tip.current;
      if (!element || element.matches(":popover-open")) return;
      element.showPopover();
      place();
    }, delay);
  }

  function hide(delay = 0) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const element = tip.current;
      if (element?.matches(":popover-open")) element.hidePopover();
    }, delay);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-describedby={id}
        onMouseEnter={() => show(SHOW_MS)}
        onMouseLeave={() => hide(HIDE_MS)}
        onFocus={() => show()}
        onBlur={() => hide()}
        onClick={() => (tip.current?.matches(":popover-open") ? hide() : show())}
        className="-my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Info aria-hidden size={15} />
      </button>
      <div
        ref={tip}
        id={id}
        role="tooltip"
        // Light dismiss (a click elsewhere) and Escape close it.
        {...{ popover: "auto" }}
        onMouseEnter={() => clearTimeout(timer.current)}
        onMouseLeave={() => hide(HIDE_MS)}
        className="fixed inset-auto m-0 max-w-[min(18rem,calc(100vw-1rem))] rounded-[10px] border border-border bg-surface-raised p-3 text-sm text-pretty text-text shadow-raised"
      >
        {children}
      </div>
    </>
  );
}

/** A hint of one sentence, with more in an InfoTip when there is more to say. */
export function Hint({ children, more, label = "More about this" }: { children: ReactNode; more?: ReactNode; label?: string }) {
  return (
    <div className="flex items-start gap-1 text-sm text-pretty text-muted">
      <p className="min-w-0">{children}</p>
      {more && <InfoTip label={label}>{more}</InfoTip>}
    </div>
  );
}
