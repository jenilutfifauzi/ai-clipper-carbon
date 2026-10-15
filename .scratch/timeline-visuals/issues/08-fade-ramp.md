# 08: Fade Ramp

**Parent spec:** `spec.md` in this feature folder (user stories 35–41; Implementation Decisions "Seam D (the actions module) gains three edits", "Gestures").

**What to build:** every Music Clip draws its fade in and fade out as slopes at its ends. On a picked Music Clip, each slope has a handle at its top:
- the owner drags it to set that fade's length;
- a seconds label shows while dragging;
- the Waveform reshapes live;
- one drag is one step of undo.

Trimming a Music Clip shorter than its fades shortens them. Locked Tracks show the ramps, but the handles don't drag.

- **Seam D:**
  - set a Music Clip's fade in or fade out: each is clamped to 0–10 s, and the two together never exceed the Clip's length;
  - trimming a Music Clip clamps its fades by the same rule.
- **The gesture:** handles with hit areas of at least 24×24px, on picked Music Clips only. They work like the Volume Line's drag (ticket 07): one gesture group, one item.
- **Segments get no fades** (`audio-mixing`).

**Blocked by:** 07 (Volume Line).

**Status:** done

- [x] Seam D (vitest):
  - a fade dragged past 10 s clamps to 10;
  - a fade in that would cross the fade out is cut to the remaining length;
  - trimming a Music Clip below the sum of its fades shortens them.
- [ ] In the browser:
  - drag both handles of a picked Music Clip, then undo each with one Cmd+Z;
  - the ramps and Waveform match the inspector's fades;
  - a locked Music Track's handles don't drag.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-15: done.** Built as specified: `setFade` and `changeMusic` in `actions.ts` (Seam D), the rule they share, `fadesWithin`, in `edits.ts`, and on the Timeline `FadeRamps` in `Tracks.tsx`, dragged through ticket 07's `ItemHandle`. Choices made on the way:
- **Setting a fade** cuts it to what the other fade leaves of the Music Clip. **Trimming** shortens both by the same share when together they no longer fit: 6 s and 2 s on a Clip trimmed to 4 s become 3 s and 1 s.
- **Every trim goes through it:** the Timeline's trim drags and the inspector's time fields (through `changeMusic`, which `updateMusic` now uses), a Main Track cut on the Magnetic timeline (`ripple`), and a split, whose parts keep no fade longer than they are.
- **The planner changed to match** (`audio_events` in `backend/app/planner.py`). It heard each fade as half the Music Clip at most, which would have rendered a 7 s fade in drawn on a 10 s Clip as 5 s. It now shortens the two fades by the same share only when together they are longer than what is heard, as `fadesWithin` does, so the ramps, the Waveform, the preview and the render agree. A Music Clip cut by the Clip's end is drawn the same way. The model and its validation (each 0–10 s) are unchanged.
- **The inspector's fade sliders** go through `setFade` too, keeping their groups (`music:<id>:fade_in`, `music:<id>:fade_out`). Each goes up to what the other leaves, instead of half the Clip.
- **The ramps** are drawn in the DOM over the item's canvas, like the Volume Line: an SVG slope at each end, shading what it quietens. Each handle's 24×24px hit area sits at the top of its slope, kept clear of the item's trim edges, and over the Volume Line's. The fade out's seconds show to the left of its handle (`ItemHandle`'s new `labelBefore`), so that they aren't cut off at the Clip's end.

Not seen in a browser yet: left for the walkthrough (09).
