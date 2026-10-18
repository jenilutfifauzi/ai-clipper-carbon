# 11: Ducking in the Advanced Edit

**Parent spec:** `spec.md` in this feature folder (user stories 39–41, 48, 58; Solution "Ducking"; Implementation Decisions "Timeline", "Inspector"); GLOSSARY "Ducking", "Volume Line".

**What to build:** on the desktop, the owner switches a Music Clip's "Duck under speech" on or off, sets its depth, and sees where and how far the music is ducked on the Timeline. Music Clips the owner adds duck at −12 dB. (The phone comes in 14.)

- **Inspector.** On a Music Clip of a song or a video's sound: "Duck under speech" and its depth (−1 to −30 dB). Hidden for a Music Clip of the Source.
- **New Music Clips** made by the editor (from the assets, a drop) have `duck` −12. Pastes keep what was copied.
- **Timeline.**
  - Under a ducked Music Clip's Volume Line, the ducked stretches (ramps included) are shaded from the plan.
  - Its Waveform is drawn at the full gain, duck included.
  - The Volume Line itself stays at the volume that is dragged.

**Blocked by:** 10.

**Status:** ready-for-agent

- [ ] Adding a song from the assets gives a Music Clip with Duck under speech on at −12 dB.
- [ ] Switching it off and on, and changing the depth, are each one undo step, and the preview's sound follows.
- [ ] A ducked Music Clip shows shaded stretches where the plan ducks it, and its Waveform dips there.
- [ ] A Music Clip of the Source shows no duck control.
- [ ] `npm run typecheck && npm run build` pass.
