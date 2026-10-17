# 13: Tracking and line height on the Hook and Caption Styles

**Parent spec:** `spec.md` (Solution "Hook and Caption Styles"; Implementation Decisions "Renderer": their new fields).

**What to build:** the hook and captions can be spaced like Text Layers.

- **The Hook Style and the Caption Style gain:**
  - `tracking` (px, may be negative), rendered as `\fsp`, and measured by the hook's fit and by caption line breaking;
  - `line_height`, a multiple of the size, which replaces the fixed leading between their lines.
- Defaults reproduce today's look exactly, so stored Style Presets and Style Overrides render as before.
- The clip editor's style fields, and Style Overrides through MCP, take both.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Planner: a hook with positive tracking fits onto more lines (or a smaller size) where it no longer fits on fewer. Caption lines break earlier.
- [x] Planner: line height changes the gap between a two-line hook's anchors ~~and between caption lines~~ (captions have one line each: see Comments).
- [x] A rendered frame shows wider letter spacing with positive tracking.
- [x] Every built-in Style Preset's Render Plan is unchanged at the defaults.
- [x] A Style Override of `tracking` set through MCP shows in the dry run.

## Comments

**2026-10-17: done.**

**What was built:**
- `HookStyle.tracking` (px, −20..60) and `HookStyle.line_height` (sizes, 0.5..2.5, default 0.82, today's leading); `CaptionStyle.tracking` (`backend/app/styles.py`).
- Planner (`backend/app/planner.py`):
  - `FontMetrics.width` takes a tracking, added after every character of a line but its last.
  - The hook's fit balances and measures tracked lines. Set smaller, the tracking stays as wide; the size never goes below `MIN_SIZE`.
  - Block and bare hooks put their baselines `line_height` sizes apart. Strips keep `STRIP_GAP` at the default and move apart or together by as much as a block's lines would, until they touch.
  - Caption lines: `max_chars` counts a line's characters as wide as its tracking makes them (`_caption_length`), so spaced lines break earlier and tight ones hold more. The shrink-to-fit and the custom x count tracking.
- Renderer (`backend/app/renderer.py`): hook lines and caption text get `\fsp`. libass (and Chrome's SVG `letter-spacing`) adds tracking after the last character too and centres that, so a tracked line is placed half its tracking right (`_tracked`; checked by measuring both). The highlight box counts tracking. The Kicker is not tracked.
- Clip editor: Line height and Tracking in the hook's More options (Lines); Tracking with the captions' line breaks. The preview draws tracked lines with `letter-spacing`, at the same shift (`frontend/src/pages/job/editor/tracking.ts`).
- MCP: the fields are plain Style Override fields, so `edit_candidate`, `merge_candidate_items`, the dry run and `save_preset` take them. The tool list grew past its budget: raised to 62,000 bytes.

**Tests:**
- `tests/test_planner.py`: the hook fit counts tracking (more lines, a smaller size, negative fits on fewer, Kicker untouched); line height sets the pitch of block and strip lines; caption breaks and sizes count tracking.
- `tests/test_styles.py` + `tests/fixtures/builtin_preset_plans.json`: every built-in Preset's caption and hook events and a digest of its ASS, written before the change, are unchanged (3 hooks each). The v1 byte-for-byte ASS test still passes.
- `tests/test_render.py`: a real render's hook lines and caption line are as wide as planned with tracking, centred on their anchors, and the hook's second line is `line_height` sizes below the first.
- `tests/test_mcp.py`: a tracking override changes the dry run's hook lines; merged and refused out of range.
- Frontend: `tracking.test.ts` (widths, shift, highlight span) and `styleSpacing.test.tsx` (the fields set the overrides).

**Decisions:**
- **No `line_height` on the Caption Style.** A caption event is always one line (`WrapStyle: 2`, an over-wide line is set smaller), so there is no leading between caption lines to replace. A slider there would change nothing on screen. If captions ever stack lines, add it then. The second criterion's caption half is not met for that reason.
- **Caption breaking with tracking** scales the `max_chars` count by how much wider tracking makes the line. A width-based break would change today's plans, which shrink over-wide lines instead.
- **Strips and line height:** the gap between strips moves by `(line_height − 0.82) × size`, never below touching.
- **The Kicker keeps its own spacing:** it is a label in a pill, not one of the hook's lines.
