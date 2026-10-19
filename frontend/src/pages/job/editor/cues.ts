import type { Cue, CueKey, Word } from "../../../api";

/** A Cue's Words, line after line. */
export function cueWords(cue: Cue): Word[] {
  return cue.lines.flat();
}

/** What a Cue reads, its lines on one row (as a Timeline shows it). */
export function cueText(cue: Cue): string {
  return cueWords(cue)
    .map((word) => word.text)
    .join(" ");
}

/** The line holding a Cue's Word `index` (counted across its lines), and the Word's place in it. */
export function cueWordAt(cue: Cue, index: number): [number, number] {
  let row = 0;
  while (row < cue.lines.length - 1 && index >= cue.lines[row].length) index -= cue.lines[row++].length;
  return [row, index];
}

/**
 * Where the middle of a Cue's line `row` is, down the frame: its lines, each as tall as its font
 * size, are centred on its area's middle, as libass sets them (renderer.py's _highlight_box).
 */
export function cueLineMiddle(cue: Cue, row: number): number {
  return cue.area.y + cue.area.height / 2 + (row - (cue.lines.length - 1) / 2) * cue.size;
}

/** A Cue on the preview's stage, by its key: "cue:<media>@<at>" (no media: the Source's). */
export const cueStageId = (key: CueKey): `cue:${string}` => `cue:${key.media ?? ""}@${key.at.toFixed(3)}`;

/** The key of the Cue a stage id names (cueStageId). */
export function cueKeyOf(id: `cue:${string}`): CueKey {
  const [media, at] = id.slice("cue:".length).split("@");
  return { at: Number(at), media: media || null };
}
