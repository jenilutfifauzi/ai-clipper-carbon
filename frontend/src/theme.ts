/**
 * The light/dark choice, per viewer. With nothing stored the page follows the system; a choice is
 * stored only when it differs from the system's at that moment, so toggling back to match the
 * system returns to following it. The stored value is applied before first paint by the inline
 * script in index.html; this module keeps it in step afterwards.
 */

export type Theme = "light" | "dark";

const KEY = "ai-clipper-theme";
const systemLight = () => window.matchMedia("(prefers-color-scheme: light)").matches;

// Storage can be unavailable (blocked site data, some private windows): then the choice lasts
// for the page's life only.
export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function store(theme: Theme | null) {
  try {
    if (theme) localStorage.setItem(KEY, theme);
    else localStorage.removeItem(KEY);
  } catch {
    // Not remembered; still applied.
  }
}

export function renderedTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return systemLight() ? "light" : "dark";
}

export function applyTheme(theme: Theme | null) {
  const root = document.documentElement;
  // No colour transitions while every token changes at once.
  const still = document.createElement("style");
  still.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.append(still);
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  const color = getComputedStyle(root).getPropertyValue("--theme-color").trim();
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (theme) meta.content = color;
    else meta.content = meta.media.includes("light") ? "#f5f5f7" : "#000000";
  }
  requestAnimationFrame(() => requestAnimationFrame(() => still.remove()));
}

// Switch to the theme opposite the one on screen.
export function toggleTheme(): Theme {
  const target: Theme = renderedTheme() === "dark" ? "light" : "dark";
  const choice = target === (systemLight() ? "light" : "dark") ? null : target;
  store(choice);
  applyTheme(choice);
  return target;
}

// Calls `onChange` when the theme on screen may have changed by itself: the system appearance
// changed, or another tab toggled it.
export function watchTheme(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    applyTheme(storedTheme());
    onChange();
  };
  media.addEventListener("change", onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onStorage);
  };
}
