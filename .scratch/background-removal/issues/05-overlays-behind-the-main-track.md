# 05: Overlays Behind the Main Track

**Parent spec:** `../spec.md` ("Model", "Planner", "Renderer", "Preview", "Editor"); ADR 0015, 0004.

**What to build:** the owner switches an Overlay (B-roll) to "Behind the Main Track". It moves to a new Behind Track under the Video Track and plays behind the speaker: it shows where a cut-out Segment's Matte takes the picture away, and where a media Segment doesn't cover the frame, and nowhere else. It keeps its own Timeline time.

**The model:** Overlay gains `behind` (default false). The Render Plan lists Behind Overlays apart, with the OverlayEvent shape.

**Drawing order:** each Segment's Background, then the Behind Overlays at that Timeline time, then its picture, all before the joins. So a Transition crossfades whole frames, and the Candidate's Grade and every Adjustment Layer cover the Behind Overlays. Outside their spans they cost a pass-through.

**The Behind Track:** it behaves as the Overlay Track does: lanes worked out from overlaps, hide, mute and lock (editor only), the Magnetic timeline, Ripple delete, Split all, drag and drop, Edit Points, and the Pick.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Seam B: Behind Overlays are listed apart; a Candidate without `behind` plans exactly as before.
- [ ] Seam A (fake matter): a Behind Overlay shows outside the kept area of a cut-out Segment, and not over a Segment that isn't cut out and covers the frame; under a Transition timing holds; the Candidate's Grade covers it.
- [ ] The Inspector's "Behind the Main Track" switch moves an Overlay between the Tracks, as one step of undo.
- [ ] vitest: the Behind Track's lanes, ripple and Split all.
- [ ] The preview draws the order above, with hide and mute on the Behind Track.
- [ ] MCP sets `behind`; the dry run shows it.
