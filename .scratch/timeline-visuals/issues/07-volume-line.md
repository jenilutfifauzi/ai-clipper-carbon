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

**Status:** ready-for-agent

- [ ] Seam D (vitest): setting the volume on a Music Clip and on a media Segment rounds and clamps it. There is no setting for a Source Segment.
- [ ] Seam E (vitest): the curve gives gains 0, 1 and 2 at p = 0, ⅔ and 1, and its inverse round-trips.
- [ ] In the browser:
  - drag the line of a picked Music Clip, pausing while holding, and one Cmd+Z restores it;
  - on a phone, dragging an unpicked Music Clip moves it, with its volume unchanged;
  - a locked Music Track's line doesn't drag.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
