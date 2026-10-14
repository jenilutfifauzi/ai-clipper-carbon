import { useCallback, useEffect, useRef } from "react";

// A ref for an element at the end of a list: `onVisible` runs when it comes within a screen's
// reach of the viewport (also inside a scrolling panel, which clips it), while `enabled`. A change
// of `enabled` or `key` (say, the count shown) observes it anew, and a new observer reports at
// once: so it runs again if the element is still in reach after the list has grown.
export function useOnVisible(onVisible: () => void, enabled: boolean, key?: unknown) {
  const latest = useRef(onVisible);
  useEffect(() => {
    latest.current = onVisible;
  });
  const observer = useRef<IntersectionObserver | null>(null);

  return useCallback(
    (element: Element | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!element || !enabled) return;
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) latest.current();
        },
        { rootMargin: "400px 0px" },
      );
      observer.current.observe(element);
    },
    [enabled, key],
  );
}
