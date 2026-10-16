// The Advanced Edit's preview full screen: the stage's container put full screen by the Fullscreen
// API (Safari's prefixed one too) where a page may do that, and elsewhere (an iPhone, where only a
// <video> can go full screen) laid over the whole window instead.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// The Fullscreen API's document, with the names Safari gave it before 16.4.
interface FullscreenDocument {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
}

interface FullscreenElement {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => void;
}

// By the Fullscreen API, or laid over the whole window.
export type FullscreenWay = "element" | "window";

/** How the page puts its preview full screen in the browser of `doc`. */
export function fullscreenWay(doc: FullscreenDocument): FullscreenWay {
  return doc.fullscreenEnabled || doc.webkitFullscreenEnabled ? "element" : "window";
}

const page = () => document as FullscreenDocument;
const fullscreenElement = () => page().fullscreenElement ?? page().webkitFullscreenElement ?? null;

/**
 * Whether `container` is full screen, and how (null: it isn't). Leaving full screen the browser's
 * way (its Esc, or its own button) is followed here too.
 */
export function useFullscreen(container: RefObject<HTMLElement | null>) {
  const [way, setWay] = useState<FullscreenWay | null>(null);

  useEffect(() => {
    const changed = () =>
      setWay((now) => (container.current && fullscreenElement() === container.current ? "element" : now === "element" ? null : now));
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("webkitfullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("webkitfullscreenchange", changed);
    };
  }, [container]);

  const enter = useCallback(() => {
    const element = container.current as (HTMLElement & FullscreenElement) | null;
    if (!element) return;
    if (fullscreenWay(page()) === "window") return setWay("window");
    // Full screen from the asking on: the window grows before the browser says it is, and the page
    // mustn't change its layout under the preview meanwhile.
    setWay("element");
    // Refused (outside a click or a key, say): over the window instead.
    if (element.requestFullscreen) element.requestFullscreen().catch(() => setWay("window"));
    else element.webkitRequestFullscreen?.();
  }, [container]);

  const exit = useCallback(() => {
    if (!fullscreenElement()) setWay(null);
    else if (page().exitFullscreen) void page().exitFullscreen!();
    else page().webkitExitFullscreen?.();
  }, []);

  return { way, enter, exit };
}

// How long the controls stay full screen after the pointer last moved or tapped.
const CONTROLS_MS = 2000;

/** Whether the controls show while `on` (full screen): after the pointer moves (`wake`), for about 2 s. */
export function useControls(on: boolean) {
  const [shown, setShown] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const wake = useCallback(() => {
    setShown(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(false), CONTROLS_MS);
  }, []);
  useEffect(() => {
    if (on) wake();
    return () => window.clearTimeout(timer.current);
  }, [on, wake]);
  return { shown: !on || shown, wake };
}
