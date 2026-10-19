# 14: Phone

**Parent spec:** `spec.md` in this feature folder (user stories 21, 57; Solution, all of the editor's parts); GLOSSARY "Advanced Edit".

**What to build:** on a phone, the owner mixes with the toolbar and the bottom sheets, as on the desktop:
- mutes and unmutes the Pick;
- Detaches and Reattaches;
- fades a Segment;
- sets a Music Clip's Speed and Ducking.

The Meters stay desktop only.

- **Toolbar.** A Mute button for the Pick, with M's rule (any heard → all Muted; all Muted → unmuted). It is disabled when the Pick has no sound.
- **Bottom sheets.**
  - **A Segment's:** fades, Muted, Detach audio or Reattach audio.
  - **A Music Clip's:**
    - Speed, pitch and Reverse;
    - Muted;
    - Duck under speech and its depth;
    - "Detached from Segment N" with Reattach.
  - **A video Overlay's:** Muted.
- **Timeline.** The Muted look, a Segment's Fade Ramps and the ducked shading show on the phone's Timeline as on the desktop. Fade handles can be dragged at touch size.
- **Save sound as WAV** is in the item's sheet, where the phone's browser allows a download.

**Blocked by:** 03, 05, 09, 11.

**Status:** done

- [x] On a phone-sized viewport, the toolbar's Mute toggles the Pick by M's rule.
- [x] A Segment's sheet sets its fades, mutes it, and Detaches and Reattaches it.
- [x] A Music Clip's sheet sets its Speed, Muted and Ducking, and shows Reattach on a Detached sound.
- [x] Fade handles are draggable by touch.
- [x] `npm run typecheck && npm run build` pass.

## Comments

**2026-10-19: done.** Built test first in `frontend/src/pages/job/advanced/phoneMixing.test.tsx` (8): the toolbar's Mute and the sheet's WAV entry.

**What was there already (audited at 390 px, nothing duplicated):** the Inspector is shared, so the Edit sheet already showed:
- a Segment's Muted switch (03), fades (05) and Detach audio / Reattach audio (09);
- a Music Clip's Speed, pitch and Reverse (07), Muted, Duck under speech and Depth (11), and "Detached from Segment N" with Reattach (09);
- a video Overlay's Muted.

The toolbar's Speed sheet took a Music Clip (07). The Timeline draws the Muted look, Fade Ramps and ducked shading whatever the width, and Fade Ramp handles already dragged by touch (`ItemHandle`: Pointer Events, `touch-none`, pointer capture).

**What was built:**
- **Toolbar Mute** (`Chrome.tsx`' `MuteButton`, `actions.ts`' `muter`). It sits after Speed in the bar of a Pick, and after Edit in the bar of picking several. It goes by M's rule through `toggleMute`, as one change.
  - It reads "Unmute", with a speaker, once every picked item with sound is Muted.
  - It is off when the Pick has no sound (a Text Layer, a Freeze frame, an image, nothing).
  - `toggleMute` and `muter` share `pickedSounds`.
- **Save sound as WAV in the item's sheet** (`itemSound.ts`' `sheetSound` and `canDownload`). The Edit sheet ends with a "Save sound as WAV" button for the one picked Segment, Music Clip or Overlay. It is offered where the browser saves a link's file (`download` on `<a>`) and goes through the same `saveSound` as the desktop's menu. On a silent item it is off and says why. It is also off while another WAV is being made.
- **Fade handles at a finger's size.** A Fade Ramp's hit area is 24 px square, or 44 px under `pointer: coarse` (a CSS variable, `--fade-hit`, so the clamp keeping it off the trim edges follows). The item's height cuts it: 36 px tall on a Music Clip, about 36 px on a Segment's band.
- The Detach audio, Reattach audio and Reattach buttons are 44 px tall in a sheet (`in-data-sheet:min-h-11`).

**Checked in a browser** (ego-browser, 390 × 844 with touch emulation, `pointer: coarse`; a copy of a review Job in a scratch data dir, the backend on its own port, the built frontend):
- With a Segment picked, the bar read Done · Edit · Transform · Speed · Mute · Split · … Mute made it Muted ("…, Muted" in its name, the button then "Unmute"), and Unmute brought it back.
- The Segment's sheet showed Muted, Detach audio, Fade in and Fade out, and Save sound as WAV. The WAV downloaded as "<Candidate> - Segment 1.wav".
- Detach audio made "The episode's sound" Music Clip, picked, and Muted the Segment. Its sheet showed "Detached from Segment 1 · Reattach", Muted, fades, Speed and WAV, with no Duck (the Source's sound). Reattach removed it and unmuted the Segment.
- The fade-in handle measured 44 × 44. A touch drag of 60 px set Fade in to 3.9 s, and its Ramp showed.
- A song added from the Audio sheet: its sheet showed Muted, the fades, "Duck under speech" at −12 dB, Speed and WAV. The toolbar Muted and unmuted it.

**Left as is / worth knowing:**
- **No Music Clip "sheet" of its own.** The ticket's sheets are the existing Edit sheet, plus the Speed sheet for Speed. Both already held every control, so no new sheet was made.
- **Not checked on real hardware:** the touch drag ran through emulated touch events.
