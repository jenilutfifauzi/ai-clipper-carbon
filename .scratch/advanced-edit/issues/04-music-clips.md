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

**Status:** ready-for-agent

- [ ] A Candidate without music has an unchanged ffmpeg command.
- [ ] Seam B: spans, clamping, fades in the plan.
- [ ] Seam A: RMS shows music inside its span and none outside; a fade ramps; `source_volume` 0 mutes speech.
- [ ] Deleting the used audio item is refused with this Candidate listed.
- [ ] Preview stays in sync after seeks; typecheck and build; browser walkthrough.

## Comments
