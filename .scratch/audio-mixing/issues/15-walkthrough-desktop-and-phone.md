# 15: Walkthrough, desktop and phone

**Parent spec:** `spec.md` in this feature folder (Testing Decisions "Walkthrough"; roadmap section E).

**What to build:** a walkthrough of the whole feature in a real browser (the `run` skill or ego-browser), on the desktop and on a phone-sized viewport, then a render through the MCP tools. Anything found is fixed here or filed as a new ticket.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14.

**Status:** done

- [x] Desktop: fade a Segment by its Fade Ramp and hear it.
- [x] Desktop: key a Source Segment's volume on its Volume Line.
- [x] Desktop: M on a mixed Pick.
- [x] Desktop: add a video Overlay and unmute it.
- [x] Desktop: Detach a Source Segment, slide its sound 1 s earlier for a J-cut, then Reattach.
- [x] Desktop: add a song and hear and see it duck; change its depth.
- [x] Desktop: set a Music Clip to 2× and to Reverse.
- [x] Desktop: save a Segment's sound as WAV.
- [x] Desktop: watch the Meters and latch the clip light.
- [x] Phone: the same mute, fade, Detach and Ducking from the toolbar and sheets.
- [x] MCP: `edit_candidate` with `dry_run=true` shows Muted, fades and ducked spans. `render_clips` → `list_clips` gives an MP4 whose mix matches the preview.
- [x] Full backend suite, `npm run typecheck && npm run build` and the frontend tests pass.

## Comments

**2026-10-19: done.**

**How it was run:**
- A copy of Job `8ef59ab26333` (an 82 s talking Clip, `777ba258`) in a scratch data folder, with the backend on port 8765 serving the built frontend. Driven with ego-browser.
- Desktop at 1440×1150. Phone at 390×844, mobile, with emulated touch (`Input.dispatchTouchEvent`).
- A 90 s 440 Hz steady tone was uploaded as the song, so a duck can be read as a level.
- Sound was measured, not judged by ear:
  - the Meters' bars, sampled while playing;
  - a tap on everything the page sends to its `AudioDestinationNode`, for the clip editor and the phone, which have no Meters;
  - the saved WAV and the rendered MP4, through ffmpeg `astats`, with a 440 Hz band-pass for the tone and a 1.2 kHz high-pass for the speech.

**Desktop:**
- **Fade Ramp.** Segment 1 was split at 10 s and 20 s. Dragging its Fade Ramp saved `fade_in: 2.1`. The Meters rose from −36 dB to −19, −13 and −12.6 over the first 2 s, against −13 to −8 for the same speech unfaded.
- **Volume Line on a Source Segment.** Dragging Segment 2's line saved volume 0.84. A Keyframe at 12 s, then a drag at 17 s, saved two linear volume Keyframes (0.84 to 0.48), drawn as a slope on the Timeline. This covers 06's untested drag.
- **M on a mixed Pick.** The Pick was a Muted Segment 1, the heard song and a Text Layer.
  - M Muted both sounds, and the Text Layer was ignored.
  - M again unmuted both. Undo was one step.
  - The Muted look showed: a flat Waveform, the crossed speaker and no Volume Line.
  - The Hook can't join a multi-Pick: shift-clicking it picks it alone. This was already so, and not part of this feature.
- **Video Overlay.** It was added at volume 1, Muted, and silent on the Meters. M unmuted it, and the Meters read −11 to −6 dB.
- **Detach, J-cut, Reattach.** Detach audio from Segment 2's context menu:
  - made a Music Clip of the Source with Segment 2's range, volume and Keyframes, and `detached_from`;
  - Muted the Segment, and showed no Duck control.

  Sliding it about 1 s earlier (start 9.05) made its speech heard from 9.0 s while Segment 1 still played. Reattach audio on its context menu deleted it and unmuted the Segment. This covers 09's J-cut by hand.
- **Song and Ducking.** Adding the song saved `duck: −12`.
  - With the Video Track muted, the Meters read the tone at −42 dB under speech and −30 dB in the 59.07–60.11 pause: 12 dB.
  - At depth −24 (arrow keys on Depth) they read −54 and −30: 24 dB.
  - The duck stayed while the Video Track was muted (spec story 49).
  - The Volume Line is shaded over every ducked stretch, with a notch at the pause.
- **Olive shading (11).** Over a song ducked almost end to end, the shading turns the whole clip olive. Filed as 16.
- **Speed and Reverse (07).** At 2× the song lasted 41.06 s (its read kept), and its `<audio>` played at rate 2 with pitch kept. R made `reversed-preview-0-82120.mp4`, and the `<audio>` played that Retimed copy at rate 2, at the right time.
- **Save sound as WAV.** Segment 1's file was `… - Segment 1.wav`: `pcm_s16le`, 48 kHz, 2 channels, 10.08 s long. Against the Source it was −13.5, −11, −4.5 and −2.6 dB through its 2.1 s fade, then equal.
- **Meters.**
  - Segment 1 and the Clip's own sound were set to 2 (4× in all). The bars reached 0 dB and the clip light latched red.
  - It stayed red 3 s after Pause, and a click cleared it.
  - 4× read exactly 12 dB above 1× on the same speech.
- **First Play (13).**
  - After a reload, with Play as the first click, the advanced edit was heard.
  - The clip editor's preview was heard too: its context ran at once, at −19 to −12 dB.

**Phone (390×844, touch):**
- On Segment 3, the toolbar's Mute Muted it and Unmute unmuted it.
- The Edit sheet's Fade out slider, dragged by touch, saved 1.2 s.
- The sheet's Detach audio made the Detached sound, which kept the 1.2 s fade, and Muted the Segment. The sheet then showed "Detached from Segment 3" and Reattach.
- On the song's Edit sheet:
  - switching Duck under speech off saved `null`, and the Depth row was hidden;
  - switching it on saved −12;
  - dragging Depth by touch saved −20.

**MCP** (streamable HTTP at `/mcp` on the scratch backend):
- **Agent Detach.** `merge_candidate_items` added a Music Clip of the Source with `detached_from` and Segment 2's range, Keyframes and volume, starting 1 s early (9.08). It also set the Segment's `muted`, all in one call. It came back with `duck: null`.
- **Dry run.** `edit_candidate` with `dry_run=true` listed every sound:
  - Segment 1's `fade_in` 2.1;
  - Segments 2 and 3 `muted`, with Segment 3's `fade_out` 1.2;
  - both Detached sounds as `source: true`;
  - the song's `duck: −20` and its `ducked` stretches.

  The stretches had a gap at 19.45–19.70, where the J-cut sound ends at 18.95 and Segment 3's Detached sound starts at 19.95: the duck follows the moved sound.
- **Render.** `render_clips`, then `wait_for_job`, then `list_clips` gave `clips/777ba258.mp4` (82.2 s). In it:
  - the 440 Hz band rose from ducked to −16.8 dB at 19.38–19.62 and fell back by 19.95;
  - in a pause that the speech spans join (around 59.5 s), the tone was −37.7: 20.9 dB down, for a depth of −20;
  - the speech band was silent (−50 dB) from 19.0 to 19.75, the J-cut's gap;
  - the speech rose over the first 2 s, Segment 1's fade.

  The preview at 18–20.8 s showed the same shape: the tone came up in 19.38–19.63 and the speech came back at 20.0.
- **Words changed with the render.** The render made the Clip's own Words (`words/`, transcribed locally). From then on the preview plan uses them too (`words_source: clip`). The pause at 59.07–60.11 that the Transcript's Words left is under the 0.8 s bridge in the Clip's own Words, so both plans now duck through it. This is the spec's rule ("the Clip's own where they have been made"), not a mismatch.

**Fixed here (test-first):**
- **The phone's first tap on Play was silent.** Since 13 routes the decks through Web Audio, the AudioContext is made when the preview mounts, suspended, and resumed on `pointerdown` or `keydown`.
  - A touch grants user activation only on `pointerup`/`touchend`, so the first tap's `resume()` did nothing: the context stayed `suspended` and nothing was heard (measured: −120 dB).
  - `PreviewMusic.tsx` now also resumes on `pointerup`. With the fix, the first tap was heard at once (−20 to −8 dB, context `running`).
  - Test: `masterBus.test.ts`, "is resumed by a tap's pointerup…".
- **Muting the Video Track silenced a Detached sound of the Source on the Music Track.** `heardDraft` muted the Video Track by setting `source_volume` to 0, which also scales Music Clips of the Source.
  - It now sets each Segment to volume 0 and drops its volume Keyframes, and leaves `source_volume` as it is. A draft without Segments still gets `source_volume` 0.
  - A muted Overlay Track drops volume Keyframes the same way. Before, a keyed Overlay or a keyed Source Segment would still be heard under a muted Track.
  - After the fix, the J-cut's sound was heard from 9.0 s with the Video Track muted.
  - Tests: `trackState.test.ts`, two new.

**Filed:** 16, the ducked shading reads as an olive clip colour.

**Worth knowing:**
- **The browser's own stalls.** The automated browser often stops animation frames for 0.5–1 s right after Play. The page's own `requestAnimationFrame` counted 0 frames while the `<video>`'s `currentTime` ran. So the Meters and the clock freeze, and short peaks are missed: speech read about 5 dB under its file's peaks, while a steady tone read within 1.6 dB.
  - The Detached sound's `<audio>` sometimes started late on the first Play after a reload, because its start waits on those frames.
  - Neither was seen once frames ran; worth a look on real hardware.
- **Re-applying the phone viewport replays the sheet's opening animation.** Taps during it fall through to whatever is under them, so two stray taps toggled the Muted switch. That was the harness, not the app.

**Suites:**
- backend: SEE_BACKEND passed (the known `test_resilience.py::test_other_jobs_run_while_a_job_waits_for_quota` deselected);
- `npm run typecheck && npm run build`: clean;
- `npx vitest run`: 974 passed (67 files).
