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
 * the line's, in a Clip cut into Segments, so they only choose between runs that read the same; with
 * none, each Word said at the middle of one of the line's. Empty when the line's Words can't be found.
 */
export function lineWords(line: CaptionEvent, words: PreviewWord[]): PreviewWord[] {
  const shown = words.filter((word) => word.edit?.text !== "");
  const wanted = line.words.map((word) => plain(word.text));
  let best: { at: number; off: number } | null = null;
  for (let at = 0; at + wanted.length <= shown.length; at++) {
    if (!wanted.every((text, i) => plain(shown[at + i].edit?.text ?? shown[at + i].text) === text)) continue;
    const off = Math.abs(shown[at].start - line.start);
    if (!best || off < best.off) best = { at, off };
  }
  if (best) return shown.slice(best.at, best.at + wanted.length);
  const said = line.words.map((word) => {
    const middle = (word.start + word.end) / 2;
    return shown.find((w) => w.start <= middle && middle < w.end);
  });
  return said.every(Boolean) ? (said as PreviewWord[]) : [];
}

/**
 * `edits` with a caption line retyped as `typed`: its Words (`words`, shown as `shown`) take the typed
 * words in order, each as many as it shows (one, or more for an edit of several words); typed words
 * past the last Word join it, and Words past the typed ones go. A Word typed as it is shown is left
 * as it is. A changed Word keeps the punctuation around it, which captions don't show but which ends
 * their lines at a sentence's end; and, typed in the capitals `uppercase` captions show, its case.
 */
export function retypedLine(edits: WordEdit[], words: PreviewWord[], shown: string[], typed: string, uppercase: boolean): WordEdit[] {
  const tokens = typed.split(/\s+/).filter(Boolean);
  let from = 0;
  return words.reduce((next, word, i) => {
    const count = i === words.length - 1 ? tokens.length - from : shown[i].split(/\s+/).length;
    const text = tokens.slice(from, from + count).join(" ");
    from += count;
    return text === shown[i] ? next : withWordEdit(next, word, { text: text && asWritten(text, word.edit?.text ?? word.text, uppercase) });
  }, edits);
}

// Letters and digits at either end: a Word as captions show it, in lower case (see _caption_text).
const plain = (text: string) => text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

// `text` typed in place of the Word written `was`: with its punctuation at either end, and in its
// case when typed in capitals (as `uppercase` captions show every Word).
function asWritten(text: string, was: string, uppercase: boolean): string {
  let written = text;
  if (uppercase && written === written.toUpperCase()) {
    written = written.toLowerCase();
    // A capital it was written with (a name's, a sentence's) stays.
    const first = was.replace(/^[^\p{L}\p{N}]+/u, "")[0];
    if (first && first !== first.toLowerCase()) written = written[0].toUpperCase() + written.slice(1);
  }
  const lead = was.match(/^[^\p{L}\p{N}]+/u)?.[0] ?? "";
  const trail = was.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? "";
  if (lead && /^[\p{L}\p{N}]/u.test(written)) written = lead + written;
  if (trail && /[\p{L}\p{N}]$/u.test(written)) written += trail;
  return written.slice(0, WORD_EDIT_MAX_CHARS);
}
