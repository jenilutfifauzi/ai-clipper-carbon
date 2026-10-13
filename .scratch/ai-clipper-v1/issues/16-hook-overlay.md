# 16: Hook overlay

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 36, 55–56; Render Planner hook rules).

**What to build:** Each Clip shows its hook text, including any edit made in Review, for the first 3 seconds. The hook sits at the top, just below the safe zone, as white Montserrat text in a dark semi-transparent box. It never overlaps the captions.

**Blocked by:** 15 (Burned captions from per-clip transcription).

**Status:** done

- [x] The latest hook text is used. It wraps to at most 2 lines, and Review warns when the text is too long to fit.
- [x] The hook shows from 0 to 3 s, below the top safe zone, and does not overlap the caption region in any layout.
- [x] An empty hook produces no overlay.
- [x] Seam B tests cover timing, line limit, position within the safe zone, and no overlap with captions.
- [x] Manual visual check on a real Clip.

## Comments

**2026-10-14: implemented, not committed (awaiting owner review).** `make test`: 243 passed, about 97 s (3 new Seam B tests in `test_planner.py`, 1 new Seam A test in `test_render.py`, 1 new API test in `test_review.py`; one ticket 13 assertion adjusted). `npm run typecheck` and `npm run build` pass. Two real Clips of Job `1d5d363bec2e` were re-rendered with their hooks and checked frame by frame (below).

Built:
- `backend/app/planner.py`:
  - `plan_render(..., words, hook="", camera)`, and `_hook`;
  - `fit_hook(text) -> (lines, size)`: the one place the hook is laid out;
  - `FontMetrics` / `font_metrics()`: the bundled font's advance widths and vertical metrics, read with fontTools. These moved here from the renderer's `_font_widths`, and the captions' `_caption_size` now uses them too;
  - `HookEvent` gains `size`;
  - `HOOK_SECS` 3, `HOOK_SIZE` 88, `HOOK_LEADING` 0.82, `HOOK_PAD_X` 36, `HOOK_PAD_Y` 26, `HOOK_WIDTH` 748.
- `backend/app/renderer.py`: `_hook_events` and `_rounded_box`, in the same `ass` script and filter as the captions. `_check` no longer refuses the hook. The ASS file is written when there are captions or a hook.
- `backend/app/rendering.py`: passes `hook=candidate.hook_text`, the Candidate as it is when its render starts. That is the latest Review edit.
- `backend/app/api.py`: `GET /api/hook?text=` → `{lines, fits}` (422 above 200 characters).
- Frontend: `api.hookFit`, and `HookEditor.tsx` drops its 40-character counter. It shows "Fits on 1 line / 2 lines", "No hook: the clip opens without one", or a warning, "Too long for 2 lines: it will be set smaller on the video".

**Layout rules** (`fit_hook`, pure, Seam B):
- The text is whitespace-collapsed. Blank text gives no lines, so no `HookEvent` and no overlay.
- **One line** when it fits in 748 px at size 88. Size 88 is libass's size (56 px to the em, capitals 39 px). The box is as wide as the captions' area: x 130–950 minus 36 px padding each side.
- **Otherwise two lines**, broken between words where the longer line is shortest (balanced, not greedy).
- **Too long for two lines.** The two lines are set smaller, so that the longer just fits (`size` < 88). The text is never cut and never goes to 3 lines.
- **"Too long" means exactly that.** Review asks `GET /api/hook`, which calls the same `fit_hook`. So the warning and the render can't disagree. It is checked 250 ms after typing pauses, on the draft rather than the saved text.
  - On the real hooks: 24–36 characters fit; the 48-character hook of `3cc01d0e` doesn't (it would render at 72.8).
- **Widths are advance sums** without kerning, as for the captions, so they slightly overestimate.

**Box and position:**
- The box's top is at y=232, the top of `SAFE_AREA`. It is centred on x=540, and its width is the longest line plus padding.
- Its height runs from the first line's capital height to the last line's descender, plus 26 px each side: 106 px for one line and 178 px for two at size 88. So it ends at y ≤ 410, and captions never go above 860.
- Lines are separate `\an5\pos` events whose baselines are placed from the font's Windows ascent and cap height, so the spacing is exact rather than libass's line height (a whole size).
- **Look:** white Montserrat ExtraBold, the only bundled weight and the captions' font. The box is a black ASS vector drawing (`\p1`) with 24 px Bézier-rounded corners at 60% opacity (`\alpha&H66&`).
- **Fade:** `\fad(0,200)`, so the hook disappears over 2.8–3.0 s. There is no fade-in, so that the first frame, which platforms show as the preview, has the hook. The poster at 1 s shows it too.
- **Timing:** 0 to min(3 s, Clip duration).
- **Single encode:** the box and lines are only extra events in the existing `ass` filter, and cost no measurable encode time (7.1 s and 16.9 s, against 10.0 s and 19.4 s for ticket 15's cached re-render under heavier swap).

**Tests.**
- **Seam B:**
  - 0–3 s, and the whole Clip when it is shorter;
  - one line versus a balanced 2 lines;
  - a long text kept on 2 lines, set smaller, fitting to within 2 px;
  - a single over-wide word;
  - `fit_hook` matching the plan;
  - blank and whitespace-only → none;
  - for every Layout (Auto, with its Blur, Track and Split scenes, and forced Track, Split and Blur), portrait, and 4 texts: inside the 12%/12% safe zones, centred, ≤ 2 lines, box ≥ lines + padding, bottom ≤ 860, and no vertical overlap with any caption event (both the seam and lower-third areas present);
  - a JSON round trip.
- **Seam A** (plain 10 s Source, captions spoken during the hook):
  - the hook is edited twice before rendering, and the second text (whitespace-collapsed) is in the plan and the Clip;
  - the plan's exact event;
  - at 0.0, 1.5 and 2.6 s, every changed pixel above y=600 lies exactly in the planned box: about 60% opacity dark, with the white text inside the padding;
  - the caption is in the lower third at the same time;
  - nothing at 3.3 s;
  - a blank hook re-render → `hook: null` and nothing drawn.
- **API:** `GET /api/hook` lines and fits, a long text, empty, and 422.
- **Mutation checks.** Each of these broke a test:
  - no 3 s cap;
  - no shrink;
  - greedy first break;
  - box at the seam;
  - blank text treated as a hook.
- **Ticket 13's** hook-only re-render test now expects the same plan apart from `hook`.

**Real check** (Job `1d5d363bec2e`, `python -m app.cli render 1d5d363bec2e 2f6cdf1b 3444ea04`, 25 s for the command, words and analysis cached):
- **The hooks:** 2f6cdf1b "Setetes racun bisa / bunuh perusahaan?" (Track at 0–3 s, box 673×178) and 3444ea04 "Stop bisnis hanya / karena feeling?" (Split at 0–3 s, seam captions).
- **Frames at 0.5, 2.5 and 3.5 s of each:**
  - The box is visible and legible at 0.5 and 2.5 s, and gone at 3.5 s.
  - It is clear of the captions in both: the lower third in Track, the seam in Split.
  - In Track it sits over the background, above the head. In Split it covers part of the top panel's face for the 3 s (expected, see ticket 15's note).
- **Not checked in a browser:** the Review warning. The dev proxy answers `GET /api/hook` (the 48-character hook gives `fits: false`).
- **Files.** Backups of the pre-check `clips/` and the JSON files are in the session scratchpad (`backup16/`). Both Clips are left re-rendered with hooks. 3cc01d0e wasn't re-rendered: it has no cached words, so it would need Whisper.

Open issues:
- **Split:** the hook covers the top speaker's face for 3 s. A smaller size for Split, or moving the box to the seam band's top (captions then lower), would be the owner's call.
- **Over-long hooks** are shrunk without a floor. 200 characters would render tiny, but Review warns.
- **The selection prompt** still asks for "about 40 characters". With balanced breaking at size 88, typical text fits up to about 40–45 characters.

**2026-10-14: verified by the owner's session.** 243 tests pass and the frontend builds. Committed together with the concurrently built tickets 15–17, which share files.
