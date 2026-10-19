# 05: Segment fades in the Advanced Edit

**Parent spec:** `spec.md` in this feature folder (user stories 4–7, 9, 58; Solution "Fades on every Segment"; Implementation Decisions "Editor actions", "Timeline", "Inspector"); GLOSSARY "Fade Ramp".

**What to build:** on the desktop, the owner fades a Segment by dragging a Fade Ramp at its start or end on the Timeline, or by typing in the inspector. Trimming, splitting and rippling keep the fades sensible. (The phone comes in 14.)

- **Inspector.** "Fade in" and "Fade out" on a Segment (not a Freeze frame), as on a Music Clip: each up to the smaller of 10 s and what the other leaves.
- **Timeline.** Fade Ramps on a Segment, over the sound band of its Filmstrip, drawn and dragged as a Music Clip's are. The handle shows on a picked Segment only. One drag is one undo step. The Segment's Waveform is shaped by its fades.
- **Split.** The head keeps the fade in and its fade out becomes 0; the tail's fade in is 0 and it keeps the fade out.
- **Trim and ripple** refit a Segment's fades as a Music Clip's are refitted.
- **Freeze frames** show no fades.

**Blocked by:** 04.

**Status:** done

- [x] Dragging a picked Segment's fade-in handle sets `fade_in`, as one undo step, and the preview's sound follows.
- [x] The inspector's fade fields set and show a Segment's fades, limited as described.
- [x] Splitting a Segment with both fades leaves the fade in on the head and the fade out on the tail only.
- [x] Trimming a Segment shorter than its two fades refits them.
- [x] A Freeze frame shows no fade fields or Ramps.
- [x] Editor action tests cover split and refit; `npm run typecheck && npm run build` pass.

## Comments

**2026-10-18: done.** Built test first in `frontend/src/pages/job/advanced/segmentFades.test.ts` (Seam D's actions and Seam E's `segmentHeard`).

**What was built:**
- **Actions** (`actions.ts`).
  - `setFade` takes a Music Clip's or a Segment's id (not a Freeze frame's). A Segment's fades are limited by its Timeline length (`segmentLength`), or by the `heard` seconds the Timeline passes (a Transition's overlap included). The signature is unchanged, so `TrackHandlers.onFade` and AdvancedEdit's wiring needed no change.
  - `fadesFitted`: a Segment's fades shortened by the same share when they no longer fit (`fadesWithin`). `dragSegment` (trims, on the Magnetic timeline or not, each step from the drag's origin, so dragging back brings them back) and `setSpeed` refit through it.
  - `cutFades`: Split and Freeze frame cut a faded Segment as a Music Clip is cut. The head keeps the fade in (within its length) and the tail keeps the fade out; there are no fades at the cut. The Freeze frame gets none. An unfaded Segment's parts are left without `fade_in` and `fade_out`, as before.
- **Timeline** (`Tracks.tsx`, `timelineView.ts`).
  - `segmentHeard` (and so `sourceHeard`) now goes through a Segment's fades, fitted as the plan fits them. The Waveform, and a keyed Volume Line, are shaped by them.
  - `Heard` gains an optional `tail`: the seconds a Segment is still heard under the Transition into the next one, past its drawn end. Its fade out ends there, as the render's does. `Tracks` takes it from the plan's Segment, for a Segment with a Transition after it.
  - `FadeRamps` serves Segments too, over the Filmstrip's sound band (`band`). Their handle is centred on the band's top, and the fade out's slope is shifted by `tail`. It appears on a picked Segment of an unlocked video Track only, through `ItemHandle`, so one drag is one undo step. Freeze frames, and videos without sound, show none.
- **Inspector** (`MainTrack.tsx`, `Inspector.tsx`). `FadeFields`: "Fade in" and "Fade out" sliders on a Segment that isn't a Freeze frame (and, for a video's, one with sound). They work as on a Music Clip: each goes up to the smaller of 10 s and what the other leaves of its length. One history group per field (`segment:<id>:fade_in`), through `setFade`.
- **Preview:** no change. The decks and the media Segments follow the plan's fitted fades (04), so the sound follows once the draft is planned.

**Decided differently / left for later:**
- **Rippling:** a Segment isn't a layer, so `ripple.ts` didn't change. Here "ripple refit" is a trim of a Segment on the Magnetic timeline, as well as a Speed change.
- **Two limits for a Segment:**
  - The inspector limits a fade by the Segment's drafted length.
  - The Timeline's handle limits it by its planned length (snapped to Words, the overlap included).
  - These differ by the Word snap at most.
- **Not checked by hand in a browser.** No backend was running to drive the Advanced Edit (the ai-clipper server was unreachable). Instead:
  - typecheck and build cover the wiring;
  - the vitest cases cover the actions and the gain;
  - ticket 15's walkthrough covers dragging the Ramps and hearing them.
