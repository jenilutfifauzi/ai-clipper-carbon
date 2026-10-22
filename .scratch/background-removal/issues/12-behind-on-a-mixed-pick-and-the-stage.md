# 12: Behind on a mixed Pick, and Behind Overlays on the stage

**Parent spec:** `../spec.md` (User Stories 7–9, 35); ADR 0015. From the branch's code review (2026-10-22).

**What to build:**
- **The "Behind the Main Track" switch works on a Pick of several Overlays** (shared field, Mixed when they differ, one step of undo). It is refused with a notice for any that sit on a locked Track. This applies on the desktop and in the phone's sheet.
- **Behind Overlays can be picked, moved, scaled and rotated on the preview stage** with their Grips and Smart Guides, like any Overlay. Because they are drawn under the Segment's picture, decide how a click reaches them (for example, where they show through the cut, or when the Behind Track is the only one with an item under the pointer) and document the choice in the ticket's Comments.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] vitest: the switch on a mixed Pick (all, Mixed, locked refusal, one undo step).
- [ ] vitest: `stagePictures` (or its successor) lists Behind Overlays, and dragging one moves it.
- [ ] Walkthrough in the browser, desktop and phone width.
