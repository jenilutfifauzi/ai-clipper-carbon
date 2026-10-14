# 06: Caption text edits

**Parent spec:** `spec.md` in this feature folder (user stories 4–7, 25; "Caption text edits are keyed by time").

**What to build:**
- **Candidate:** gains `word_edits: list[WordEdit(at, text, break_before)]`.
- **Planner:** applies the edits before line breaking. An edit's text replaces the Word's text, empty text removes the Word, and `break_before` starts a line.
- **API:** `PATCH` and the preview draft take `word_edits`.
- **`CaptionTextEditor`:** the caption lines as editable Words, with remove, "new line here", an "edited" mark, and reset.

**Blocked by:** 03, 04.

**Status:** ready-for-agent

- [ ] Seam B:
  - a replaced Word;
  - a removed Word;
  - a forced break;
  - an edit that matches no Word does nothing;
  - an edit is kept across a re-transcription with slightly different timings.
- [ ] An edited Word keeps its timing and highlight. Edited text is still uppercased and stripped of end punctuation, as Words are.
- [ ] Edits are validated: at most 500, text at most 40 characters, `at` finite.
- [ ] Seam A: a render shows the edited text in its plan.

## Comments
