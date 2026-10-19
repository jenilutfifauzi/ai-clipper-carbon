# 16: Ducked shading reads as a clip colour

**Parent spec:** `spec.md` in this feature folder (Timeline: "Ducked stretches are shaded under a Music Clip's Volume Line"); found in 15's walkthrough.

**Status:** needs-triage

**What happened:** under speech, a ducked Music Clip is shaded from the bottom up to its Volume Line in the Volume Line's yellow at low alpha (`DuckedShade` in `frontend/src/pages/job/advanced/Tracks.tsx`, `oklch(0.88 0.16 90 / 0.28)`). That yellow over the Music lane's green comes out olive. A podcast clip's song is ducked almost end to end, so the whole clip turns olive:
- it reads as a different clip colour, not as "turned down here";
- the Waveform under it is hard to make out;
- only the short gaps in the speech show the clip's own green, so the eye reads the gaps as the marked part.

Seen on the desktop at 1440 px, with a steady-tone song under an 82 s talking Clip, at −12, −20 and −24 dB.

**What to decide:**
- a shade that doesn't mix with the lane's hue, such as a darker or neutral tint, a hatch, or a band along the top;
- or shading the part of the clip that is not ducked instead.

The shape itself is right: it follows the Volume Line and the ramps, and it disappears when Duck under speech is switched off or the clip is Muted.

- [ ] A fully ducked Music Clip still reads as a Music Clip, with its ducked stretches still visible.
- [ ] Its Waveform stays legible under the shade.
