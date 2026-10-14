/**
 * `text` with the Emphasis of the words `selection` touches toggled: unmarked when they are inside
 * one, else marked *like this*, taking in whole any Emphasis they cut into. Returns the new text and
 * the range of the words, or null when nothing but spaces is selected.
 */
export function toggledEmphasis(text: string, selection: [number, number]): { text: string; selection: [number, number] } | null {
  const [from, to] = wholeWords(text, selection);
  if (from === to) return null;
  const run = runAround(text, [from, to]);
  if (run) {
    const [open, close] = run;
    return { text: text.slice(0, open) + text.slice(open + 1, close) + text.slice(close + 1), selection: [open, close - 1] };
  }
  let [start, end] = [from, to];
  for (const [open, close] of runs(text)) {
    if (open < end && close >= start) [start, end] = [Math.min(start, open), Math.max(end, close + 1)];
  }
  const marked = `*${text.slice(start, end).replaceAll("*", "")}*`;
  return { text: text.slice(0, start) + marked + text.slice(end), selection: [start, start + marked.length] };
}

/** Whether the words `selection` touches are inside an Emphasis. */
export const inEmphasis = (text: string, selection: [number, number]) => runAround(text, wholeWords(text, selection)) !== null;

// The Emphasis runs of `text`, as the positions of their asterisks: paired from the left, as the
// planner pairs them (an odd last one is shown as it is).
function runs(text: string): [number, number][] {
  const stars = [...text.matchAll(/\*/g)].map((match) => match.index);
  return Array.from({ length: Math.floor(stars.length / 2) }, (_, i) => [stars[2 * i], stars[2 * i + 1]]);
}

// The Emphasis run holding the letters of the range [start, end) (punctuation and asterisks at its
// ends aside), or null.
function runAround(text: string, [start, end]: [number, number]): [number, number] | null {
  const letter = /[\p{L}\p{N}]/u;
  while (start < end && !letter.test(text[start])) start++;
  while (end > start && !letter.test(text[end - 1])) end--;
  if (start === end) return null;
  return runs(text).find(([open, close]) => open < start && end <= close) ?? null;
}

// The range [start, end) widened to the whole words it touches (asterisks belong to their word).
export function wholeWords(text: string, [start, end]: [number, number]): [number, number] {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  while (end < text.length && !/\s/.test(text[end])) end++;
  // A selection of nothing but spaces is no words.
  return text.slice(start, end).trim() ? [start, end] : [start, start];
}
