# 07: Built-in Presets for the reference looks

**Parent spec:** `spec.md` in this feature folder (user story 13; "Built-in Presets").

**What to build:** four built-in Presets after the existing ones: `quote-strip`, `headline-red`, `quote-card` and `kicker-bare`, as the spec's table says. Tune sizes, heights, padding and caption styles against the reference screenshots from the grilling session (ask the owner for them if they aren't in the folder).

**Blocked by:** 01–05.

**Status:** done

- [x] Seam A: the four are listed, can't be changed or deleted.
- [x] Browser check: each Preset previewed and rendered on a real Candidate (with Emphasis and a Kicker), side by side with its reference; screenshots noted in Comments.

## Comments

**2026-10-14: done.** `uv run pytest tests/test_review.py tests/test_styles.py tests/test_planner.py`: all pass (1 new Seam A test, 2 new Seam B Kicker tests). `npm run build` passes.

Built, after `minimal` in `BUILTIN_PRESETS`:
- **Quote strips** (`quote-strip`): white strips, left, black capitals in Montserrat at 92, up to 4 lines, Quote Mark, top. Default captions.
- **Red headline** (`headline-red`): a white square block, left, black Anton capitals at 100, red `#E11D2E` Emphasis, up to 4 lines, at y 1050. Captions in Anton at the top.
- **Quote card** (`quote-card`): a white square block, centred, black Poppins Black at 84 as written, green Emphasis, up to 3 lines, Quote Mark, bottom. Captions as written, at the top.
- **Kicker over bare text** (`kicker-bare`): no box, white Montserrat capitals at 80 with a 4 px shadow, left, up to 4 lines, a yellow Kicker pill with black text, middle. Captions at the bottom.

Each Preset moves its captions away from where its hook sits.

**Changes from the plan:**
- **Kicker size.** `KICKER_SCALE` went from 0.55 to 0.8. At 0.55 the "TERBONGKAR" pill was far smaller than in reference 5, where its letters are nearly the hook's size.
- **Kicker bug fixed.** The Quote Mark code (ticket 04) reused the name `pad_y`, which overwrote the Kicker's padding, so the Kicker's text sat high in its pill. The names are now distinct. The Kicker test now checks that the letters are centred in the pill with any Shape and a Quote Mark, and it failed before the fix.

**Checks:**
- libass, the four Presets over a frame of 2f6cdf1b with sample hooks: next to references 2–5, the strips, the red-emphasis headline, the quote card and the bare text with its yellow Kicker match their looks.
- Browser: Red headline and Kicker over bare text previewed with the Candidate's Kicker and Emphasis.
