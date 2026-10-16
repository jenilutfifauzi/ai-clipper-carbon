# 07: Loop Region

**Parent spec:** `spec.md` in this feature folder (user stories 34–48, 84; Implementation Decisions "Navigation math: Loop Region", "`Playback` with two decks: Loop"); GLOSSARY "Loop Region".

**What to build:** the owner marks In and Out and watches the stretch between them over and over, with a seamless return from Out to In.

- **Marks.**
  - I sets In at the playhead and O sets Out.
  - Crossed marks swap.
  - The marks are clamped inside the Clip, with at least one frame between them. They stay in Timeline time when the Clip is edited, and are clamped again if it gets shorter.
- **The ruler** shows the Region as a band whose ends can be dragged.
- **Loop on and off.** L or a loop button in the player bar turns Loop on and off, and the button shows the state. L with no marks marks the whole Clip. Alt+X clears the marks and turns Loop off.
- **With Loop on:**
  - Space plays from the playhead if it is inside the Region, and otherwise from In;
  - at Out, playback goes back to In without stopping;
  - the parked deck is parked at In when Out comes before the next join, so the wrap is seamless.
- **With Loop off,** playback stops at the Clip's end as today.
- **Kept in the editor only.** The Region is never saved or undone, and is gone when the editor closes.
- **The table.** The rows `mark-in`, `mark-out`, `loop` and `clear-marks` appear on the sheet.

**Blocked by:** 02 (frame grid), 05 (two decks).

**Status:** ready-for-agent

- [ ] Seam E (vitest), worked examples:
  - [ ] crossed marks swap;
  - [ ] marks past the Clip clamp;
  - [ ] Play's start inside and outside the Region;
  - [ ] the wrap target.
- [ ] Seam F (vitest), with In 2 s and Out 4 s:
  - [ ] playing from 3 s wraps to 2 s at 4 s on the parked deck without stopping;
  - [ ] Play from 6 s starts at 2 s;
  - [ ] Loop off stops at the end as today.
- [ ] Seam G: `i` and `I` give `mark-in`, `l` gives `loop`, Alt+X gives `clear-marks`, and Cmd+L gives nothing.
- [ ] A 2-second Region across a join loops ten times with no visible pause. Dragging the band's ends adjusts it.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
