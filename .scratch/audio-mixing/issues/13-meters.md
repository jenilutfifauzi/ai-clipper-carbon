# 13: Meters

**Parent spec:** `spec.md` in this feature folder (user stories 54–56; Solution "Meters"; Implementation Decisions "Preview", "Meters"); GLOSSARY "Meters".

**What to build:** on the desktop, a slim column beside the bottom panel shows the preview's sound level, left and right, while it plays, with a clip light that stays on until clicked.

- **One master bus.** Every heard element of the preview (the decks, Music Clips, Overlay and media Segment sounds) goes through one master `GainNode`. That node feeds a channel splitter with two `AnalyserNode`s, then the destination.
- **Ballistics, a pure function and the tested part:**
  - peak in, dB from −60 to 0;
  - instant attack, a fall of 24 dB/s;
  - a peak-hold line for 1.5 s, then falling;
  - the held peak shown in whole dB;
  - a clip latch when a sample reaches 0 dBFS, cleared by a click.
- **Reading.** The analysers are read on each animation frame while playing. Reading stops once the bars have fallen.
- **The column** sits beside the bottom panel (Timeline | Keyframes) on the desktop only. It has a "dB / L / R" legend. Its tooltip says the render is normalized to −14 LUFS afterwards. `workspace-layout` (#22) will absorb it.
- **It shows what is heard,** Track mute included.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Ballistics tests: a peak shows at once; it falls 24 dB in one second; the hold stays 1.5 s; a sample of 1.0 latches the clip light until cleared.
- [ ] Playing the preview moves the bars; pausing lets them fall and stops the reading.
- [ ] Every preview sound still plays at its gain through the master bus (no element bypasses it, none doubled).
- [ ] The column is absent on the phone.
- [ ] `npm run typecheck && npm run build` pass.
