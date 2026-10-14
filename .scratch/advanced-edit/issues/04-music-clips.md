# 04: Music Clips

**Parent spec:** `spec.md` in this feature folder (user stories 8, 9).

**What to build:**
- **Model:**
  - `MusicClip` on the Candidate (`music`): `media`, `start`, `offset`, `secs`, `volume`, `fade_in`, `fade_out`.
  - `Candidate.source_volume`.
  - An unknown or non-audio `media` is refused (422). Video items with sound may be used as music too.
- **Planner:** an `AudioEvent` per Music Clip, kept inside the Clip and the file.
- **Renderer:**
  - Each Music Clip is an extra input with `atrim`, `adelay`, `volume` and `afade`.
  - The Clip's own sound gets `volume=source_volume`.
  - Everything goes through `amix`, then `loudnorm`.
- **Preview:** `<audio>` elements slaved to `Playback` (play, pause, seek, drift resync), in both the workspace and the clip editor.
- **Workspace:**
  - Drag from the Audio tab onto the Audio track.
  - Move, trim either edge (trimming the start changes `offset`), split, delete.
  - The inspector sets volume and fades.
  - "Original sound" volume is set on the Main Track.
- **Glossary:** add **Music Clip**.

**Blocked by:** 03.

**Status:** done

- [x] A Candidate without music has an unchanged ffmpeg command.
- [x] Seam B: spans, clamping, fades in the plan.
- [x] Seam A: RMS shows music inside its span and none outside; a fade ramps; `source_volume` 0 mutes speech.
- [x] Deleting the used audio item is refused with this Candidate listed.
- [x] Preview stays in sync after seeks; typecheck and build; browser walkthrough.

## Comments

**2026-10-14: done.**

**Checks:**
- `tests/test_music.py`:
  - Seam B: clipping to the Clip's end and the song's, fades, and an encode command left unchanged without music.
  - Seam A, through the API and real ffmpeg: validation (an unknown item, an image, volume > 2, duplicate ids); the in-use delete refused with 409 naming the Candidate; music only where planned with the source muted (RMS per 0.1 s window).
- The render, watermark, review, planner, text and media suites pass (168).
- `npm run build`.
- Browser:
  - Music added at the playhead.
  - The preview's `<audio>` in step with the video (1.71 s into the song at 3.71 s into the Clip, the clip starting at 2.02 s).
  - Trimming the left edge moved the offset (start 3.0, offset 0.98).
  - The delete dialog named the clip using the song.

**Changes from the plan:**
- The loudness is measured on the mix, so that a Clip with music still lands at −14 LUFS.
- The preview plays volume through Web Audio, so that volumes above 100% sound as they will in the render.
- Clicking the Video track selects it; its inspector holds "Original sound".
- Splitting a Music Clip drops the fades at the cut.

**Note:** after backend edits, `make dev`'s `--reload` once hung waiting for the old worker to shut down while the browser held a streaming connection. Stopping that worker let the reloader start a new one.

**2026-10-14: review fixes.** Songs are dragged from the Audio tab onto the Audio track, landing where they are dropped.
