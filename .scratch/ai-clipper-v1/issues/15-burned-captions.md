# 15: Burned captions from per-clip transcription

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 8, 52–55; Transcriber, Render Planner, Renderer).

**What to build:** Rendered Clips get accurate burned captions. They come from a fresh local transcription of just the clip's audio, not from YouTube's captions. Captions are:
- short UPPERCASE lines with a black outline and the active word in orange;
- on the panel seam in Split and in the lower third otherwise;
- always inside platform safe zones;
- set in the bundled Montserrat ExtraBold.

Captions can be turned off per Job.

**Blocked by:** 03 (Full local transcription fallback), 14 (Split & Blur layouts per scene).

**Status:** done

- [x] For each Clip, the Transcriber runs on the clip range ±2 s in the Job's language. Words are mapped onto the clip timeline.
- [x] Lines are at most about 16 characters or 1.4 s, in UPPERCASE, with a black outline. The active word is `#FF9F0A`, timed per word.
- [x] Captions sit on the seam in Split and in the lower third in Track and Blur, and switch position at layout changes.
- [x] No caption enters the top ~12%, bottom ~20%, or right ~12% of the frame.
- [x] The bundled Montserrat ExtraBold is used through a fonts directory, with no dependency on system fonts.
- [x] With captions off, nothing is burned. Every Clip is still a single encode.
- [x] Seam B tests cover:
  - line-length and duration limits;
  - UPPERCASE text;
  - active-word timing;
  - positions per layout;
  - safe zones.
- [x] Seam A test: with fake Transcriber Words, the Render Plan contains the expected caption events and the render succeeds.
- [x] Manual visual check on a real Clip.

## Comments

**2026-10-14: implemented, not committed (awaiting owner review).** `make test`: 238 passed, about 136 s. That count has 6 new Seam B tests in `test_planner.py` and 3 new Seam A tests in `test_render.py`; the rest of the increase is ticket 17's work in progress. I re-rendered two real Clips of Job `1d5d363bec2e` with captions and checked their frames (below).

Built:
- `backend/app/planner.py`:
  - `plan_render(..., layout, words=None, camera)`;
  - `_captions` and `_caption_text`;
  - `SAFE_AREA`, `SEAM_CAPTIONS`, `LOWER_CAPTIONS`;
  - the `CAPTION_*` constants.
- `backend/app/renderer.py`:
  - `_ass` writes the script, `_caption_size` fits a line to its area, and `_font_widths` reads the font with fontTools;
  - the `ass` filter is applied on `[frame]` after `concat`;
  - `_check` now refuses only the hook.
- `backend/app/rendering.py`:
  - `Renders(store, settings, transcriber)`;
  - `_words` and its cache (`ClipWords`, `words_file`, `CAPTION_MARGIN_SECS`);
  - a step-based progress.
- `main.py` passes `ports.transcriber`. The CLI `render` uses a `WhisperTranscriber`.
- `pyproject.toml`/`uv.lock`: `fonttools` is now a direct dependency. It was already locked (4.66.1), through matplotlib.

**Caption pipeline.**
1. **Transcription.** Each Clip is transcribed by Whisper over its range plus 2 s on each side, clamped to the Source, so that the words at the edges are heard whole. It runs in the Job's language, through the `Watchdog`, with the existing `TranscriptionTuning` budget.
2. **Clip timeline.** Words are shifted onto the Clip's timeline and cached (see Caching).
3. **Planner (pure).**
   - **Which words count.** A word is captioned when its midpoint is inside the Clip, clamped to the Clip.
   - **Lines.** Words are added to a line until one of these applies:
     - the line would exceed 16 characters (a single longer word stands alone);
     - the line would exceed 1.4 s;
     - there is a pause of 0.5 s or more;
     - the previous word ended a sentence (. ? ! …);
     - the next word starts in a Scene whose captions go elsewhere.
   - **Timing.** A line appears with its first word. It leaves 0.3 s after its last word, or when the next line starts, and never more than 1.4 s after it appeared.
   - **Highlight.** Each word is highlighted from its own start until the next word starts. The highlights cover the event with no gaps.
   - **Position.**
     - Split: `SEAM_CAPTIONS` (130,860 820×200), centred on y=960.
     - Track, Blur and passthrough: `LOWER_CAPTIONS` (130,1296 820×200).
   - **Layout changes.** At a Layout change, a line still being spoken is split into two events, and its highlight carries on. A line whose words are all spoken ends at the change. A part shorter than 0.2 s joins its neighbour, so nothing flashes.
   - **Safe zones.** `SAFE_AREA` = x 0–950, y 232–1536. Lines are centred horizontally, so their x range (130–950) mirrors the 12% right margin on the left.
4. **Punctuation (decision).** Whisper's text is uppercased.
   - Punctuation at either end of a word is dropped: `halo,` → `HALO`, `"kok` → `KOK`.
   - Trailing `?`/`!` are kept (`KENAPA?`), and so are `% # @ &` (`50%`).
   - Punctuation inside a word stays (`MAIN-MAIN`, `2,5`).
   - A word that is only punctuation is dropped.
   - Sentence ends break lines.

**ASS approach.**
- **Script.** `PlayRes` is 1080×1920, `WrapStyle: 2` (no wrapping) and `YCbCr Matrix: None`. The style is `Montserrat ExtraBold` at 110, not bold, white, with a 7 px black outline and no shadow, `\an5\pos(area centre)`.
- **One Dialogue event per word.** Each shows the whole line with that word in `\c&H0A9FFF&` (#FF9F0A).
  - Unlike `\k`, which keeps sung words coloured, this gives exactly one active word.
  - The line never moves, because the glyphs are the same in every event.
- **Font size.** libass sets a font so that its Windows ascent plus descent (1.562 em) equals the size. Size 110 is therefore 70 px per em.
  - A line wider than its area (measured from the font's advance widths, outline included) gets `\fs` reduced. libass doesn't wrap `\pos` events within the margins, which I checked.
- **Bundled font only.** `fontsdir=backend/assets/fonts`. libass's debug log shows `fontselect: (Montserrat ExtraBold, 400, 0) -> Montserrat-ExtraBold` from the bundled file.
- **Single encode.** The script is written to `clips/.<id>.part.ass` and removed afterwards. The poster also shows the caption on screen at 1 s.
- **Captions off.** With the Job's `captions` false, nothing is transcribed and the plan has no captions, so there is no ass filter.

**Caching and memory.**
- **Cache.** `words/<start ms>-<end ms>.json` holds `{start, end, language, model, words}`, including the margin words. A render reuses it when the range, language and `whisper_model` match. So hook and layout edits never re-transcribe; a bounds edit does.
- **Freeing Whisper.** The Whisper worker stays loaded across a batch and is stopped in `Renders.run`'s `finally`, which frees the ~2.1 GB.
- **No overlap.** The steps per Clip run strictly in order (Whisper, then detection, then encode), so Whisper never computes while MediaPipe or ffmpeg runs.
- **Stopping.** `Renders.stop()` stops the Transcriber only while a render is transcribing, so a pipeline's full-episode run isn't hit. A stop turns into `RenderStopped`, so the Clip resumes.
- **Stalls.** A stall twice becomes a Clip error ("…stalled twice; try again").

**Tests.**
- **Seam B:**
  - line limits and greedy fullness;
  - a long word alone, and the 1.4 s cap;
  - UPPERCASE and punctuation;
  - exact highlight and line timings: linger, next line, pause, margin words dropped, a word clamped at 0;
  - seam vs lower third per layout, forced layouts and portrait;
  - moving at a cut, a line ending at a cut, a short part joining, and Blur→Track not moving;
  - safe zones checked against the spec's percentages;
  - a JSON round trip.
- **Seam A** (a plain 10 s Source, so any non-background pixel is caption):
  - the `(language, start−2, end+2)` call;
  - the exact plan events;
  - white and orange pixels only inside the area, with the orange to the left or right of the white per active word, and nothing before or after the lines;
  - hook and layout re-renders keep the words file (same mtime), and a bounds edit calls again;
  - captions off: no call, no events, no pixels;
  - a forced Split with a 15-W word: centred on y≈960, orange and outline inside x 130–950.
- **Mutation checks.** Each of these broke a test:
  - margin 0;
  - captions ignored;
  - no fit;
  - always lower third;
  - no uppercase;
  - no sentence break;
  - no pause break;
  - linger crossing a cut;
  - no short-part merge;
  - cumulative highlight.

  Not covered: a change of language or model invalidating the cache.

**Real check** (Job `1d5d363bec2e`, M1 with 8 GB, `python -m app.cli render 1d5d363bec2e 2f6cdf1b 3444ea04`, 248 s for the command). **The machine was swapping heavily**: 7.7 GB of swap in use, with Chrome, VS Code and ego open.

| Clip | Length | ASR (range with margins) | Words | Render total | Cached re-render | Ticket 14 encode |
|---|---|---|---|---|---|---|
| 2f6cdf1b | 26.8 s | 71.5 s for 30.8 s (with the model load), 0.44× realtime | 75 | 88.0 s | 10.0 s | 6.4 s |
| 3444ea04 | 70.4 s | 122.3 s for 74.3 s (model loaded), 0.61× realtime | 185 | 157.3 s | 19.4 s | 16.3 s |

- **Memory.** Peak MLX memory was 2.15 GB and the worker's max RSS 0.74 GB.
- **ASR speed.** Far slower than ticket 03's 3.3× realtime, and slower than the spec's 1.9×. That is swap, not the code: the loaded-model call was also slow.
- **Encode cost.** The cached re-render (no Whisper call) shows the burn adds about 3 s per Clip, under the same memory pressure.
- **Size.** The files are a little larger (26.4 MB and 71.0 MB): there is more detail to encode.
- **Frames.** I looked at 8 timestamps across Track, Split and the switches: 0.8, 6.5, 12.5 and 21.0 s of 2f6cdf1b; 2.4, 9.8, 23.2 and 49.5 s of 3444ea04.
  - Legible, with a crisp outline. Exactly one orange word.
  - Track captions sit on the chest, below the face.
  - Split captions sit on the seam, between the faces.
  - "JUGA SAMA" moved to the seam right after the cut at 23.02 s.
  - Everything is inside the 12%/20%/12% guide lines, including UNCOMFORTABLE (13 characters).
- The Clips are left re-rendered with captions, and the words are cached in `words/`. Backups of the pre-check `clips/`, `analysis/` and JSONs are in the session scratchpad (`backup15/`).

**For ticket 16 (hook box).**
- **Where the hook goes.** Place it inside `SAFE_AREA`, from y=232 down. Keep it above y≈860, the top of the seam caption band in Split.
- **Overlap with captions.**
  - Captions never go above y=860.
  - Lower-third captions occupy y 1296–1496 and seam captions 860–1060, both at x 130–950.
  - So a hook box in y 232–~700 never collides with captions in any layout.
  - In Split it covers the top panel's face, which sits around y≈330–380, for 3 s. Keep the box as short as 2 lines allow.
- **Reuse.** The ASS script (`_ass`) can take a second style and event for the hook, with `\an8` and a `BorderStyle 3` box or a drawn rectangle, in the same `ass` filter. The hook's Montserrat weight is in the same `fontsdir`. Extend `_caption_size`'s measuring for its fit.

Open issues:
- **Short lines.** Greedy breaking leaves short single-word lines ("YA", "EEE", "INI") at sentence ends and pauses. Balanced breaking could come later.
- **Whisper's accuracy.** It mishears some words and names ("LID", "BUKER").
- **Missing glyphs.** A character Montserrat lacks falls back to a system font through libass's CoreText provider. Measuring counts such a character as 1.562 em, so it still fits.


**2026-10-14: verified by the owner's session.** 243 tests pass and the frontend builds. Committed together with the concurrently built tickets 15–17, which share files.
