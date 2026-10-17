# 11: Freeze frame in the Advanced Edit

**Parent spec:** `spec.md` in this feature folder (user stories 24–28; Solution "Freeze frame", "The Timeline", "Editing"; Implementation Decisions "The Advanced Edit"); ADR 0009, ADR 0004, ADR 0008.

**What to build:** on the desktop, the owner freezes the frame at the playhead with Freeze frame (Shift+F) and sets how long it holds.

- **The action,** among the item tools and on Shift+F, on the Segment under the playhead when it is at least 0.3 s from its edges on the Timeline (and not itself a Freeze frame):
  - split there into head, a 1 s Freeze frame of the frame shown at the playhead (at any Speed, in Reverse), and tail;
  - ripple an insertion of 1 s at the playhead (the layers after it follow while the Magnetic timeline is on);
  - a Transition after the Segment stays after the tail; none inside;
  - Keyframes re-anchored on head and tail; for a video, the Framing's values at that frame become the Freeze frame's constants;
  - the new Freeze frame is picked. One step of undo.
- **Its length:** dragging either edge changes `hold` (the frame stays), and the inspector shows a Duration field instead of the Speed section. Ripple follows the Magnetic timeline.
- **The Timeline:** its Filmstrip repeats its frame; no Waveform; a badge ❚❚ with its hold.
- **Shortcuts sheet** lists Shift+F; F stays full screen.

**Blocked by:** 05, 10.

**Status:** ready-for-agent

- [ ] Shift+F at 3 s into a 6 s Segment gives 3 s, 1 s held, 3 s; a Text Layer at 5 s moves to 6 s with the Magnetic timeline on.
- [ ] On a 2× Segment the held frame is the Source frame shown at the playhead.
- [ ] On a keyed media Segment, the Freeze frame's Framing equals the picture shown at the playhead.
- [ ] Dragging the Freeze frame's right edge to 2.5 s sets `hold` 2.5 and ripples by 1.5 s; the Duration field shows 2.5.
- [ ] Shift+F within 0.3 s of a Segment's edge, or on a Freeze frame, does nothing.
- [ ] Undo removes the Freeze frame and restores the Segment and the rippled items in one step.
