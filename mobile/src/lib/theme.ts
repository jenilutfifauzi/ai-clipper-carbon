export const colors = {
  background: "#0e0d16",
  surface: "#191725",
  surfaceRaised: "#211f2e",
  field: "#242132",
  border: "#3b384b",
  track: "#302d41",
  accent: "#6d5dfc",
  accentSoft: "#9c92ff",
  accentText: "#d1ccff",
  text: "#ffffff",
  textSecondary: "#d4d0df",
  textMuted: "#aaa7b8",
  // 4.5:1 or better on `field`, which the old #777386 placeholder was not.
  placeholder: "#a29eb5",
  danger: "#ff9f9f",
  dangerSoft: "#ffc0c0",
  warning: "#ffc28e",
  ripple: "rgba(255, 255, 255, 0.16)",
} as const;

/** Android's minimum comfortable touch target, in dp. */
export const TOUCH_TARGET = 48;
