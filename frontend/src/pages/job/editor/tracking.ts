// Tracking, the Hook and Caption Styles' `tracking`: pixels after every character of a line but its
// last, as the planner measures a line (backend/app/planner.py's FontMetrics.width). libass and the
// browser add it after the last character too, and centre that.

/** How wide `text` is with `tracking`, given how wide `width` says it is without. */
export function trackedWidth(text: string, width: (text: string) => number, tracking: number): number {
  const characters = [...text].length;
  return characters ? width(text) + tracking * (characters - 1) : 0;
}

/** Where a centred line with `tracking` is drawn for its letters to be centred on `x`. */
export function trackedX(x: number, tracking: number): number {
  return x + tracking / 2;
}

/**
 * Word `active` of a line of `words` (joined by spaces) with `tracking`, as the renderer's
 * _highlight_box measures it: how far its letters start from the line's left edge, and how wide they
 * and the whole line are.
 */
export function wordSpan(
  words: string[],
  active: number,
  width: (text: string) => number,
  tracking: number,
): { before: number; word: number; line: number } {
  const before = active ? `${words.slice(0, active).join(" ")} ` : "";
  return {
    before: width(before) + tracking * [...before].length,
    word: trackedWidth(words[active], width, tracking),
    line: trackedWidth(words.join(" "), width, tracking),
  };
}
