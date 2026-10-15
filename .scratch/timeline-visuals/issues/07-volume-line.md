# 07: Volume Line

**Parent spec:** `spec.md` in this feature folder (user stories 24–34; Implementation Decisions "Seam D (the actions module) gains three edits", "A new pure module for the Timeline's view (Seam E)" (the Volume Line's curve), "Gestures").

**What to build:** every Music Clip and media Segment shows a thin line at its volume. On a picked item, the owner drags the line up and down to set its volume:
- a % label shows while dragging;
- the Waveform reshapes live, and the inspector follows;
- releasing ends one step of undo.

Source Segments have no line. Locked Tracks show the line, but it doesn't drag.

- **Seam D: set an item's volume,** for a Music Clip or a media Segment. It is rounded to 0.01 and clamped to 0–2. It is not offered for a Source Segment.
- **Seam E: the curve** between a position `p` (bottom 0 to top 1) and a gain, as the spec gives it: `gain = 2 · p^k`, `k = ln(1/2) / ln(2/3)`. 100% sits at two thirds of the height, and 0% is at the bottom.
- **The gesture:**
  - on a picked item, the line's hit area is at least 24px tall;
  - dragging it changes that item only, even when several are picked;
  - it goes through the history as one of the Timeline's per-gesture drag groups (ticket 01);
  - elsewhere on the item, a drag moves or trims it as today;
  - on an unpicked item, a tap picks it.

**Blocked by:** 01 (One gesture is one step of undo), 05 (Waveform on Music Clips and media Segments).

**Status:** done

- [x] Seam D (vitest): setting the volume on a Music Clip and on a media Segment rounds and clamps it. There is no setting for a Source Segment.
- [x] Seam E (vitest): the curve gives gains 0, 1 and 2 at p = 0, ⅔ and 1, and its inverse round-trips.
- [x] In the browser (walkthrough 09):
  - drag the line of a picked Music Clip, pausing while holding, and one Cmd+Z restores it;
  - on a phone, dragging an unpicked Music Clip moves it, with its volume unchanged;
  - a locked Music Track's line doesn't drag.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-15: done.** Built as specified: `setVolume` in `actions.ts` (Seam D), `volumeOfHeight` and `volumeHeight` in `timelineView.ts` (Seam E), and on the Timeline `VolumeLine` in `Tracks.tsx`, dragged through `ItemHandle` in `AdvancedTimeline.tsx`. Choices made on the way:
- `ItemHandle` is the on-item handle, for the Fade Ramp's handles (08) to reuse. It is a hit area that drags on its own: it captures the pointer and stops the item's move and the Timeline's scrub or rubber band, and its `touch-action: none` lets a touch drag at once instead of scrolling. `onGrab(handle)` is called as a drag begins and gives what each move does, with `{ dx, dy }` from where the pointer went down and the drag's group, `drag:handle:<n>`. `label` shows beside where it was grabbed while the drag lasts.
- The line drags from where it was when grabbed, by the share of the item's height dragged, so it doesn't jump to the pointer. Its 24px hit area is kept inside the item, so that at 200% or 0% it isn't clipped.
- The inspector's volume sliders, for a Music Clip and a video's Segment, also go through `setVolume`, keeping their groups (`music:<id>:volume`, `segment:<id>:volume`). A Source Segment's slider is unchanged.
- A video's Segment without sound has no Volume Line, as its inspector has no volume.
- The line is drawn in the DOM over the item's canvas, not as a canvas layer: it needs no windowing, and its hit area sits with it.

Not seen in a browser yet: left for the walkthrough (09).
