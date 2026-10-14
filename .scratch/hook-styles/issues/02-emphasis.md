# 02: Emphasis in the hook, and emoji stripped

**Parent spec:** `spec.md` in this feature folder (user stories 6, 7, 16; "Hook text and Emphasis", "Hook fit check").

**What to build:**
- **Markup.** The planner parses `*run*` in the hook text into runs `(text, emphasised)`:
  - runs may span words, and an unpaired `*` is shown as written;
  - emoji (`Extended_Pictographic`, variation selectors, ZWJ) are removed before fitting;
  - `uppercase` is applied after parsing.
- **Width.** Fitting measures the text without its markup.
- **HookStyle** gains `emphasis_colour` (`#FFE600`).
- **Renderer:** `\c` switches per run.
- **Preview:** `<tspan>` fills per run.
- **HookEditor:**
  - An "Emphasis" button and Cmd/Ctrl+B wrap the selection in `*`, or unwrap an already wrapped selection. Selections snap to word boundaries.
  - The fit warning comes from the Preview Plan (`hook.size < hook_style.size`). `GET /api/hook` is removed if nothing else uses it.
- **Style panel:** the Emphasis colour goes in the Text group.

**Blocked by:** 01.

**Status:** done

- [x] Seam B tests: spanning runs, an unpaired `*`, `**` (empty), emoji stripped, uppercase with markup.
- [x] Renderer test: colour switches around an emphasised run. Text without markup gives v1's ASS.
- [x] Cmd/Ctrl+B toggles Emphasis and keeps the selection; the button has an accessible name and pressed state.
- [x] Browser check: preview and render agree on Emphasis colours.

## Comments

**2026-10-14: done.** `uv run pytest tests/test_planner.py tests/test_styles.py tests/test_review.py`: 114 passed (3 new Seam B tests, 1 renderer test; the `/api/hook` test removed with its endpoint). `npm run typecheck` and `npm run build` pass.

Built:
- **Planner:** `_hook_words` parses the markup and strips emoji (the ranges in `_EMOJI`: pictographs, dingbats, flags, variation selectors, ZWJ, keycaps, tags), then applies capitals. `HookEvent.emphasis` holds each line's runs as character ranges. A space between two emphasised words is in their run, so "*pasti iri!*" is one run.
- **Markup rules:** asterisks pair from the left; an odd last one is shown; `**` is nothing.
- **Renderer:** `_emphasised` switches `\c` to `emphasis_colour` and back around each run.
- **Preview:** `<tspan>` fills per run, the shadow copy in the shadow colour throughout.
- **HookEditor:**
  - An "Emphasis" button and Cmd/Ctrl+B mark the selected words, or the word at the caret. A selection is trimmed, then widened to whole words. When the words are already one run, the button unmarks them (`aria-pressed`).
  - The fit line comes from the Preview Plan (`hook.size >= hook_style.size`) and names the style's line count. `GET /api/hook` and `HookFit` are removed.
- **Style panel:** Emphasis colour in the Text group.

**Checks:** Browser (scratch clone): selecting "nuh perusahaa" and pressing Cmd+B gave `Setetes racun bisa *bunuh perusahaan?*`, previewed in yellow; Cmd+B again unmarked it.

**2026-10-14: review fixes.**
- **Emphasis button.** It now finds the run the selected letters are inside, ignoring punctuation and asterisks at the ends (`runAround`), so `*rugi 500 juta*?` unmarks instead of wrapping again. Marking takes in whole any run the selection cuts into, so `*a* b *c*` becomes `*a b c*` rather than losing both runs.
- **Emoji.** The emoji ranges now cover Unicode's Extended_Pictographic (⏰ ‼ ▶ ↔ ⌚…), except ©, ® and ™, which fonts draw as text.
- **Capitals that lengthen a word.** When a capital is longer than its letter (ß → SS), each of its letters keeps the emphasis.
- **Preview.** Emphasis spans are cut by code point, as Python counts them.
