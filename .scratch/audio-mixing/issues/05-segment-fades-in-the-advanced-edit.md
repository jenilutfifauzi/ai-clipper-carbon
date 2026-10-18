# 05: Segment fades in the Advanced Edit

**Parent spec:** `spec.md` in this feature folder (user stories 4–7, 9, 58; Solution "Fades on every Segment"; Implementation Decisions "Editor actions", "Timeline", "Inspector"); GLOSSARY "Fade Ramp".

**What to build:** on the desktop, the owner fades a Segment by dragging a Fade Ramp at its start or end on the Timeline, or by typing in the inspector. Trimming, splitting and rippling keep the fades sensible. (The phone comes in 14.)

- **Inspector.** "Fade in" and "Fade out" on a Segment (not a Freeze frame), as on a Music Clip: each up to the smaller of 10 s and what the other leaves.
- **Timeline.** Fade Ramps on a Segment, over the sound band of its Filmstrip, drawn and dragged as a Music Clip's are. The handle shows on a picked Segment only. One drag is one undo step. The Segment's Waveform is shaped by its fades.
- **Split.** The head keeps the fade in and its fade out becomes 0; the tail's fade in is 0 and it keeps the fade out.
- **Trim and ripple** refit a Segment's fades as a Music Clip's are refitted.
- **Freeze frames** show no fades.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] Dragging a picked Segment's fade-in handle sets `fade_in`, as one undo step, and the preview's sound follows.
- [ ] The inspector's fade fields set and show a Segment's fades, limited as described.
- [ ] Splitting a Segment with both fades leaves the fade in on the head and the fade out on the tail only.
- [ ] Trimming a Segment shorter than its two fades refits them.
- [ ] A Freeze frame shows no fade fields or Ramps.
- [ ] Editor action tests cover split and refit; `npm run typecheck && npm run build` pass.
