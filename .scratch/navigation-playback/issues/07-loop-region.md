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

**Status:** done

- [x] Seam E (vitest), worked examples:
  - [x] crossed marks swap;
  - [x] marks past the Clip clamp;
  - [x] Play's start inside and outside the Region;
  - [x] the wrap target.
- [x] Seam F (vitest), with In 2 s and Out 4 s:
  - [x] playing from 3 s wraps to 2 s at 4 s on the parked deck without stopping;
  - [x] Play from 6 s starts at 2 s;
  - [x] Loop off stops at the end as today.
- [x] Seam G: `i` and `I` give `mark-in`, `l` gives `loop`, Alt+X gives `clear-marks`, and Cmd+L gives nothing.
- [ ] A 2-second Region across a join loops ten times with no visible pause. Dragging the band's ends adjusts it.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. The Loop math is in `playhead.ts`, beside the frame grid (tested in `playhead.test.ts`): `loopRegion(marks, { fps, duration })` makes the Region from the marks (an unset In is the Clip's start and an unset Out its end; crossed marks swap; both are kept inside the Clip, at least a frame apart; null with no marks); `loopStart(time, region)` is where Play starts (the playhead inside the Region, Out not included, otherwise In); and `wrapTarget(region, segments)` is where Out goes back to (In's Segment, its time, and its time in the Source, or null in a media Segment). `Playback` (`playback.ts`) takes the Region with `setLoop(region | null)`, null being Loop off, and gives it back as `loop`. `parkTarget()` parks at In's Source time while Loop is on, the time is before Out and Out is in the time's Segment (before the next join, or at it); with In in a media Segment it parks nowhere new, and that video waits at its start through `follow`. The tick wraps at Out (at the handover when Out is at the Segment's end, so that no frame past it shows) through `enter`, which now takes a time in the Segment: the decks swap when the parked one is ready at In, otherwise the live deck seeks there, and playing goes on either way. `play()` without a time (and so Space and the play button) starts from In outside the Region, and `toggle()` no longer goes back to 0 at the end while Loop is on. The keymap's new rows are `mark-in` (I), `mark-out` (O), `loop` (L) and `clear-marks` (Alt+X), under playback. `useShortcuts` reads keys through the new `keysOf(event)`: with Alt held and a key that isn't a letter (a Mac's ⌥X types ≈, ⌥E a dead key), the letter comes from `event.code` (`KeyX`), so Alt+letter works on a Mac and other layouts' letters are left as they are.

The marks and Loop on/off are state of the Advanced Edit (`Workspace`): never saved or undone, and gone when it closes. The marks are kept as set, in Timeline time, on the playhead's frame; the Region is made from them on every render against the Clip as it is, so a shorter Clip clamps it (and a longer one again gives the marks as set). L with no marks marks the whole Clip; Alt+X clears them and turns Loop off. The ruler draws the Region as a band (in the accent while Loop is on, grey while off) whenever a mark is set. Its two ends are dragged on the Clip's frames with pointer capture, and a drag past the other end swaps them; the band itself lets a press through to the ruler's scrub. The loop button is in the Advanced Edit's compact transport, before the rate menu (`ClipPreview`'s new `loop`, passed on a desktop only), lit while on as the Magnetic toggle is. The phone shows the band, and gets its button with 10.

Choices the spec left open. Marks that cross when set swap at once, so I after Out makes the old Out the In. Turning Loop on while playing past Out plays on to the Clip's end and stops, as Loop wraps only from before Out; Space then starts from In. `playback.ts` (in `editor/`) now imports the Loop helpers from `advanced/playhead.ts`, the first import that way; the clip editor never sets a Region.

Not tried in the browser: a 2-second Region across a join looping ten times with no visible pause, and dragging the band's ends, are left for the walkthrough (11). Worth watching there: a Region of a few frames, shorter than the parked deck's seek, wraps by seeking rather than swapping until the seek lands.

**2026-10-16: Review fixes.** `LoopRegion`, `loopStart` and `wrapTarget` moved to `frontend/src/pages/job/editor/loop.ts` (tested in `loop.test.ts`), so `editor/` no longer imports from `advanced/`; `advanced/playhead.ts` keeps `LoopMarks` and `loopRegion`, importing the type. `ordered()` in `AdvancedEdit.tsx` stays: `loopRegion` swaps crossed marks for the Region, but the marks themselves have to be stored in order for the next I or O to move the end the band shows.
