import type { CaptionStyle } from "../../../api";

/** The Caption Style's fields that part its Words into Cues and lines. */
export type LineLimits = Pick<CaptionStyle, "max_lines" | "max_chars" | "max_words" | "max_secs" | "pause_secs">;

/**
 * Phrase (one short line, today's defaults) and Sentence (up to two lines, to a sentence's end): line
 * limits the Caption Style panel fills in one click. Not stored: a style is one when its values are.
 * The backend's (styles.py's LINE_LIMITS, which the MCP's instructions name): lineLimits.test.ts
 * checks them against backend/tests/fixtures/line_limits.json, as the backend's tests do.
 */
export const LINE_LIMITS = {
  phrase: { max_lines: 1, max_chars: 16, max_words: null, max_secs: 1.4, pause_secs: 0.5 },
  sentence: { max_lines: 2, max_chars: 24, max_words: null, max_secs: 5, pause_secs: 0.7 },
} as const satisfies Record<string, LineLimits>;

export type LineLimitsName = keyof typeof LINE_LIMITS;

/** Which of Phrase and Sentence `caption`'s line limits are, if either. */
export function lineLimitsOf(caption: LineLimits): LineLimitsName | null {
  const names = Object.keys(LINE_LIMITS) as LineLimitsName[];
  return names.find((name) => (Object.entries(LINE_LIMITS[name]) as [keyof LineLimits, unknown][]).every(([field, value]) => caption[field] === value)) ?? null;
}
