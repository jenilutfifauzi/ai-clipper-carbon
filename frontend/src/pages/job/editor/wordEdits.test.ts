// Correcting caption Words (ADR 0020): what retyping, removing a Word and "New line here" leave in
// the Candidate's Word Edits, for the Source's Words and a video's Media Words.
import { describe, expect, test } from "vitest";
import type { PreviewWord, WordEdit } from "../../../api";
import { retypedLine, withWordEdit } from "./wordEdits";

// A video's Words, heard from 0.5 s of the Clip, with their middles on its timeline.
const halo: PreviewWord = { text: "halo", start: 0.5, end: 0.9, at: 0.7, edit: null, media: "intro" };
const semua: PreviewWord = { text: "semua.", start: 0.9, end: 1.3, at: 1.1, edit: null, media: "intro" };
// The Source's Word with the same middle on its own timeline, and its edit.
const sourceEdit: WordEdit = { at: 0.7, text: "teman", break_before: false };

describe("a video's Words", () => {
  test("retyping a Cue's Word writes a Word Edit with its video and its middle on the video's timeline", () => {
    expect(retypedLine([sourceEdit], [halo, semua], ["HALO", "SEMUA"], "DUNIA SEMUA", true)).toEqual([
      sourceEdit,
      { at: 0.7, text: "dunia", break_before: false, media: "intro" },
    ]);
  });

  test("removing a Word and starting a line at one write edits of the video's Words, and leave the Source's", () => {
    const removed = withWordEdit([sourceEdit], halo, { text: "" });
    expect(removed).toEqual([sourceEdit, { at: 0.7, text: "", break_before: false, media: "intro" }]);

    const broken = withWordEdit(removed, semua, { break_before: true });
    expect(broken.at(-1)).toEqual({ at: 1.1, text: null, break_before: true, media: "intro" });
  });

  test("an edit back to the Word as it is goes, and only its own", () => {
    const edited = { ...halo, edit: { at: 0.7, text: "dunia", break_before: false, media: "intro" } };
    expect(withWordEdit([sourceEdit, edited.edit], edited, { text: "halo" })).toEqual([sourceEdit]);
  });
});

test("the Source's Words keep their edits as they were written: without a video", () => {
  const word: PreviewWord = { text: "kawan", start: 2, end: 2.4, at: 10.2, edit: null };
  expect(withWordEdit([], word, { text: "teman" })).toEqual([{ at: 10.2, text: "teman", break_before: false }]);
});
