# 15: Burned captions from per-clip transcription

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 8, 52–55; Transcriber, Render Planner, Renderer).

**What to build:** Rendered Clips get accurate burned captions. They come from a fresh local transcription of just the clip's audio, not from YouTube's captions. Captions are:
- short UPPERCASE lines with a black outline and the active word in orange;
- on the panel seam in Split and in the lower third otherwise;
- always inside platform safe zones;
- set in the bundled Montserrat ExtraBold.

Captions can be turned off per Job.

**Blocked by:** 03 (Full local transcription fallback), 14 (Split & Blur layouts per scene).

**Status:** ready-for-agent

- [ ] For each Clip, the Transcriber runs on the clip range ±2 s in the Job's language. Words are mapped onto the clip timeline.
- [ ] Lines are at most about 16 characters or 1.4 s, in UPPERCASE, with a black outline. The active word is `#FF9F0A`, timed per word.
- [ ] Captions sit on the seam in Split and in the lower third in Track and Blur, and switch position at layout changes.
- [ ] No caption enters the top ~12%, bottom ~20%, or right ~12% of the frame.
- [ ] The bundled Montserrat ExtraBold is used through a fonts directory, with no dependency on system fonts.
- [ ] With captions off, nothing is burned. Every Clip is still a single encode.
- [ ] Seam B tests cover:
  - line-length and duration limits;
  - UPPERCASE text;
  - active-word timing;
  - positions per layout;
  - safe zones.
- [ ] Seam A test: with fake Transcriber Words, the Render Plan contains the expected caption events and the render succeeds.
- [ ] Manual visual check on a real Clip.
