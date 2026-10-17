# 12: Speed, Reverse and Freeze frame on a phone

**Parent spec:** `spec.md` in this feature folder (Solution "Editing": on a phone); ADR 0009.

**What to build:** on a phone, the owner reaches Speed, Reverse and Freeze frame from the Advanced Edit's toolbar.

- **A Speed button** in the toolbar for a Segment or a video Overlay picked alone opens a Speed sheet: the chips, the slider, the number field, the pitch switch and Reverse with its progress. A Freeze frame's sheet shows its Duration.
- **Freeze frame** sits beside Split in the toolbar.
- The Edit sheet's inspector shows the same Speed section.

**Blocked by:** 05, 08, 11.

**Status:** ready-for-agent

- [ ] At phone width, picking one Segment shows Speed in the toolbar; picking two hides it.
- [ ] The Speed sheet sets 2× and Reverse, each one step of undo, with the Timeline updating behind it.
- [ ] Freeze frame from the toolbar inserts a 1 s Freeze frame at the playhead.
- [ ] Every control of the sheet is reachable with the thumb and meets the 44 px tap target.
