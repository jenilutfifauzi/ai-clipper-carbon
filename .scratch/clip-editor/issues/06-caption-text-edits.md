# 06: Caption text edits

**Parent spec:** `spec.md` in this feature folder (user stories 4–7, 25; "Caption text edits are keyed by time").

**What to build:**
- **Candidate:** gains `word_edits: list[WordEdit(at, text, break_before)]`.
- **Planner:** applies the edits before line breaking. An edit's text replaces the Word's text, empty text removes the Word, and `break_before` starts a line.
- **API:** `PATCH` and the preview draft take `word_edits`.
- **`CaptionTextEditor`:** the caption lines as editable Words, with remove, "new line here", an "edited" mark, and reset.

**Blocked by:** 03, 04.

**Status:** done

- [x] Seam B:
  - a replaced Word;
  - a removed Word;
  - a forced break;
  - an edit that matches no Word does nothing;
  - an edit is kept across a re-transcription with slightly different timings.
- [x] An edited Word keeps its timing and highlight. Edited text is still uppercased and stripped of end punctuation, as Words are.
- [x] Edits are validated: at most 500, text at most 40 characters, `at` finite.
- [x] Seam A: a render shows the edited text in its plan.

## Comments

**2026-10-14: done.** `make test`: 288 passed (5 new Seam B tests, 1 Seam A test). `test_selection.py`'s exact Candidate gains `word_edits: []`. `npm run typecheck` and `npm run build` pass.

Built:
- **`WordEdit(at, text, break_before)`** (`app/candidates.py`):
  - `text: None` keeps the Word's text, `""` removes the Word;
  - text is stripped and at most 40 characters, and `at` must be finite.
  - **`Candidate.word_edits`.** A PATCH replaces the whole list (at most 500 edits). It is saved in time order with edits that change nothing dropped, and it marks the Candidate edited.
- **Planner:**
  - `match_edits(words, edits)`: the Word whose span holds `at`, else the nearest within `WORD_EDIT_REACH_SECS` (0.25 s); the later edit wins.
  - `_captions` applies the edits before line breaking. Edited text goes through `_caption_text` like a Word (case, end punctuation), and `break_before` starts a line.
  - `candidate_plan` shifts the edits to the Clip's timeline.
- **Preview Plan:** its Words are `PreviewWord(text, start, end, edit)`. Each carries the Candidate's own edit object, so the UI replaces exactly that edit.
- **`editor/CaptionTextEditor.tsx`:**
  - The Words in the plan's caption lines, one bordered group per line.
  - Clicking a Word seeks the preview to it and opens a form: text (Enter saves, Esc closes), "New line here", "Remove" or "Show again", and "Restore".
  - Edited Words are orange and underlined, removed ones struck through, and a ↵ marks a forced line. The Word being spoken is highlighted, and "Restore all N" clears every edit.
  - A `focus` prop opens the Word at a time (for the timeline, ticket 08).

**Browser check** (2f6cdf1b, scratch clone):
- Corrected "airnya" to "Gue", removed "yuk" and forced a line at "ngomong".
- The saved edits were `[{at 1560.59, "Gue"}, {at 1561.12, ""}, {at 1561.65, break}]` and the planned lines `BAGUS GUE` / `SAYA` / `NGOMONG EH YUK`.
- The first layout (one row per line) was too tall, so lines now wrap as groups.
