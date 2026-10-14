import type { CaptionEvent, PreviewWord, WordEdit } from "../../../api";

// The longest a Word Edit's text can be (candidates.py's WORD_EDIT_MAX_CHARS).
export const WORD_EDIT_MAX_CHARS = 40;

// The time a Word's edit is keyed by: its edit's own, or its middle on the Source's timeline.
// Edits are keyed by the Word's time on the Source's timeline, which a cut Clip may show twice.
export const editKey = (word: PreviewWord) => word.edit?.at ?? word.at;

/** `edits` with `word`'s changed by `change`: an edit back to the Word as it is goes. */
export function withWordEdit(edits: WordEdit[], word: PreviewWord, change: Partial<Pick<WordEdit, "text" | "break_before">>): WordEdit[] {
  const at = editKey(word);
  const next: WordEdit = { at, text: word.edit?.text ?? null, break_before: word.edit?.break_before ?? false, ...change };
  if (next.text === word.text) next.text = null;
  const others = edits.filter((edit) => edit.at !== at);
  return next.text === null && !next.break_before ? others : [...others, next].sort((a, b) => a.at - b.at);
}

/**
 * The Preview Plan's Words a caption line shows, in order: the run of Words (as edited, removed ones
 * left out) that reads as the line, nearest the time it is shown. The Words' times can be apart from
 * the line's, in a Clip cut into Segments, so they only choose between runs that read the same.
 */
export function lineWords(line: CaptionEvent, words: PreviewWord[]): PreviewWord[] {
  const plain = (text: string) => text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const shown = words.filter((word) => word.edit?.text !== "");
  const wanted = line.words.map((word) => plain(word.text));
  let best: { at: number; off: number } | null = null;
  for (let at = 0; at + wanted.length <= shown.length; at++) {
    if (!wanted.every((text, i) => plain(shown[at + i].edit?.text ?? shown[at + i].text) === text)) continue;
    const off = Math.abs(shown[at].start - line.start);
    if (!best || off < best.off) best = { at, off };
  }
  return best ? shown.slice(best.at, best.at + wanted.length) : [];
}

/**
 * `edits` with a caption line retyped as `typed`: its Words (`words`, shown as `shown`) take the typed
 * words in order, each as many as it shows (one, or more for an edit of several words); typed words
 * past the last Word join it, and Words past the typed ones go. A Word typed as it is shown is left
 * as it is.
 */
export function retypedLine(edits: WordEdit[], words: PreviewWord[], shown: string[], typed: string): WordEdit[] {
  const tokens = typed.split(/\s+/).filter(Boolean);
  let from = 0;
  return words.reduce((next, word, i) => {
    const count = i === words.length - 1 ? tokens.length - from : shown[i].split(/\s+/).length;
    const text = tokens.slice(from, from + count).join(" ").slice(0, WORD_EDIT_MAX_CHARS);
    from += count;
    return text === shown[i] ? next : withWordEdit(next, word, { text });
  }, edits);
}
