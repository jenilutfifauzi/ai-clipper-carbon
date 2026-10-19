# 03: Cues of up to three lines; Phrase and Sentence

**Parent spec:** `../spec.md` (Domain and model: `max_lines`, Phrase and Sentence, `break_before`; Planning Cues: breaking, balanced lines; Rendering); user stories 19–22, 36, 47.

**What to build:** the owner can show a sentence in two lines.

**Caption Style gains `max_lines`** (1–3, default 1):
- `max_chars` and `max_words` count per line;
- `max_secs` and `pause_secs` apply per Cue.

**Breaking into lines:**
- The planner splits a Cue's Words into balanced lines: of the splits that fit, the one with the shortest longest line wins.
- A Word Edit's `break_before` starts a new line, and a new Cue when the Cue already has all its lines.
- With `max_lines` 1 every stored Candidate and Preset plans as before.

**Drawing:**
- The renderer joins a Cue's lines in one event, highlighting the active Word across them.
- The box highlight is placed from each line's own metrics.
- The preview draws the same lines.
- Shrink-to-fit applies to the widest line.

**The shared Caption Style panel** (clip editor and Advanced Edit) gets:
- a Lines field;
- Phrase (1 line, 16 characters, no word limit, 1.4 s, 0.5 s pause) and Sentence (2 lines, 24 characters, no word limit, 5 s, 0.7 s pause) buttons that fill the line limits;
- a mark on the one the current values match.

No mode is stored. The clip editor's "New line here" is relabelled if needed to say it starts a line.

**Blocked by:** 01.

**Status:** done

- [x] Planner: with `max_lines` 1 the Cues equal today's on the existing caption fixtures.
- [x] Planner: Sentence limits give two balanced lines within 24 characters each, ending Cues at a sentence's end or a pause.
- [x] Planner: `break_before` starts a line inside a two-line Cue, and a Cue when the Cue is full.
- [x] Render (real ffmpeg): a two-line Cue shows ink on two text rows. With box highlight, the box sits behind the active Word on the second line.
- [x] Preview: two-line Cues match the render's placement, line height and timing.
- [x] Phrase and Sentence fill the fields in both editors, and the mark follows hand edits. A Preset saved with `max_lines` 2 keeps it.
- [x] The MCP accepts `max_lines` in `style_overrides.caption` and in `save_preset`.

## Comments

**2026-10-19, agent:** Built.

**Model.** `CaptionStyle.max_lines` (1–3, default 1, `app/styles.py`; `max_lines` in `api.ts`). `max_chars` and `max_words` count per line; `max_secs` and `pause_secs` per Cue.

**Planner** (`app/planner.py`, `_captions`):
- `_lines(words, style)` sets a Cue's Words on the fewest lines (up to `max_lines`) that fit, balanced: of the splits that fit, the one whose longest line is shortest (of equals, the earliest breaks). A Word with `break_before` starts a line. None when even `max_lines` lines don't fit.
- `_fits(words, style)` is now "`_lines` isn't None". So a `break_before` starts a line inside a Cue, and a new Cue when the Cue already has all its lines. `joinable` lifts the break before the later Cue's first Word and asks `_fits`.
- The widest line sizes the Cue (shrink-to-fit) and places it (custom x). `_caption_box` grows the area about its middle when the lines (a font size each) are taller than it. It never changes for one line: areas are 200 px, sizes at most 200.
- With `max_lines` 1, every existing planner test, the built-in Preset plans fixture and the render tests are unchanged.

**libass line spacing, verified.** A burned two-line Cue (Montserrat ExtraBold, Anton, Bangers, at 110 px) shows its rows of capitals exactly 110 px apart, centred on the area's middle. The renderer (`_highlight_box`) and the preview (`cueLineMiddle`) were right; neither changed. `test_render.py::test_a_two_line_cue_is_burned_on_two_rows_one_font_size_apart_with_the_box_on_the_second` covers it, box highlight on the second line included.

**Panel** (`editor/CaptionStylePanel.tsx`, shared by both editors):
- Line limits: Phrase and Sentence buttons fill all five fields in one `setMany`, so they are one undo step in the Advanced Edit. Values equal to the Preset's drop out of the overrides. The matching button is pressed with a check.
- A Lines segmented field.
- The values live in `editor/lineLimits.ts` (`LINE_LIMITS`, `lineLimitsOf`).
- The More options labels now say "Most characters a line", "Most words a line", "Longest caption on screen" and "New caption after a pause of".
- "New line here" was kept: it already says it starts a line.

**MCP:** the instructions describe `max_lines`, Phrase and Sentence. The field is in the schema of `style_overrides.caption` and of `save_preset`.

**Checks:**
- Backend: test_planner (3 new tests besides the earlier agent's Sentence test), test_render (the real-ffmpeg two-line test, run in 3 fonts), test_mcp (`max_lines` as an override, refused above 3, kept by a saved Preset and planned from it). Full suite: see the commit's report.
- Frontend: `lineLimits.test.ts` (marks, fill, hand edit, Lines), a Sentence undo step in `advanced/captionStyle.test.ts`, three lines in `cues.test.ts`. vitest 866 passed; typecheck clean; vite build clean.
- Browser walkthrough on a copied data dir (one Job), at 1440×900 and 390×844:
  - In the clip editor, Sentence was marked and Lines went to 2. The preview drew a two-line Cue and the overrides were saved.
  - Most characters moved to 25 by hand: neither button was marked.
  - In the Advanced Edit, picking the captions and pressing Phrase marked it, cleared the overrides and redrew one line. Undo brought back the hand-edited values.
  - No Clip was rendered in the browser; the HTTP render test covers burning.

**Left for later tickets:**
- A three-line Cue at a large size in the custom position can reach past the safe area: the area grows about the clamped middle and isn't clamped again.
- The clip editor's caption text list groups chips by Cue starts and breaks, not by every planned line.
- The inline retype field over a two-line Cue is one row.
