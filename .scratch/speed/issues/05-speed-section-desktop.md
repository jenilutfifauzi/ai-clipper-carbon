# 05: The Speed section in the Advanced Edit

**Parent spec:** `spec.md` in this feature folder (user stories 1–4, 9–11, 15–16; Solution "Speed", "The Timeline", "Editing"; Implementation Decisions "The Advanced Edit"); ADR 0009, ADR 0004, ADR 0008.

**What to build:** on the desktop, the owner sets a Segment's or a video Overlay's Speed and its pitch switch in the inspector, and the Timeline shows and edits sped items truly.

- **The Speed section,** for a Segment or a video Overlay picked alone: chips 0.25 · 0.5 · 1 · 1.5 · 2 · 4, a logarithmic slider 0.0625–16, a number field (×), and the switch "Change pitch with speed". Each change is one step of undo.
- **A Speed change** sets the field, scales the item's Keyframes by `old ÷ new`, and for a Segment ripples as a trim of its right edge (the Main Track closes up or opens out; the layers follow while the Magnetic timeline is on). An Overlay keeps its start; its end moves, kept within its video.
- **Trim:** a drag's seconds × Speed move the range's end; the minimum of 0.3 s is on the Timeline; a Segment's range of the Source stays within the longest clip.
- **Split** maps the cut through the mapping (to the gap between Words for the Source); both halves keep `speed` and `pitch`, with their Keyframes re-anchored.
- **Clipboard** copies and pastes sped Segments and Overlays with their lengths on the Timeline.
- **Filmstrip and Waveform** follow what plays: a tile shows the frame at `start + (x ÷ pps) × speed`; the Waveform is squeezed or stretched.
- **A badge** on a sped Segment or Overlay shows its Speed ("2×"). The range hint shows the Timeline length.
- **The clip editor** shows a Clip with a sped Segment, and gives way to the Advanced Edit as for a cut Clip.

**Blocked by:** 03, 04.

**Status:** ready-for-agent

- [ ] Setting 2× on the middle of three Segments shortens the Main Track by half that Segment's length; a Text Layer after it moves up with the Magnetic timeline on, and stays with it off.
- [ ] A media Segment's scale Keyframe at 2 s sits at 1 s after setting 2× from 1×, and the picture at that moment is the same frame.
- [ ] Dragging the right edge of a 2× Segment by 1 s on the Timeline moves its Source end by 2 s (then snapped to Words on save).
- [ ] Splitting a 2× Segment gives two 2× halves whose joined playback equals the whole's.
- [ ] Copy and paste of a sped Segment keeps its Speed and its length on the Timeline.
- [ ] The Filmstrip of a 2× Segment shows two seconds of the Source per second of the Timeline; the badge reads "2×".
- [ ] Undo restores the Speed, the Keyframes and every rippled item in one step.
