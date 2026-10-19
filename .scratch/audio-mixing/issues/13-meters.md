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

**Status:** done

- [x] Ballistics tests: a peak shows at once; it falls 24 dB in one second; the hold stays 1.5 s; a sample of 1.0 latches the clip light until cleared.
- [x] Playing the preview moves the bars; pausing lets them fall and stops the reading.
- [x] Every preview sound still plays at its gain through the master bus (no element bypasses it, none doubled).
- [x] The column is absent on the phone.
- [x] `npm run typecheck && npm run build` pass.

## Comments

**2026-10-18: done.**

**What was built:**
- **The master bus** (`frontend/src/pages/job/editor/masterBus.ts`): one `GainNode`, mixed to two channels (`channelCount` 2, explicit, speakers, so that a mono Source or song is metered on both sides), feeding the destination and a channel splitter with an `AnalyserNode` per side. `masterBus(audio)` makes it on first need; `heardBus()` gives it once anything plays through Web Audio. `PreviewMusic`'s `gainOf` now connects each element's own gain to the bus instead of the destination, so the decks, Music Clips, Overlay sounds, media Segments and the Transition ghost all go through it once.
- **The decks' masters are always routed** now (PreviewMusic set their volume only when it wasn't 1, or once routed), so that the Source is metered at any volume. Their sound is unchanged: the gain is the same `source_volume` × the Segment's volume.
- **The ballistics** (`advanced/ballistics.ts`, pure): `decibels` (−60 to 0), `meterStep` (instant attack, 24 dB/s fall, a held peak for 1.5 s that then falls, never under its bar, the clip latch at a sample ≥ 1), `clearClip`, `heldPeak` (whole dB, the louder side's, or null), `settled`.
- **The feed** (`advanced/meterFeed.ts`): `MeterFeed` wakes on the Playback's `subscribe` when it plays, reads the two analysers' peaks (`getFloatTimeDomainData`) on each animation frame, and once paused feeds silence (nothing is read) until the bars and held peaks are down, then stops its frames.
- **The column** (`advanced/Meters.tsx`): the clip light (a button; a click clears it), a ruler from 0 to −60 dB, the two bars (green to −12 dB, orange to −3, red above, drawn straight onto their elements each frame with `clip-path`, so only the number and the light re-render), each side's held-peak line, the "dB / L / R" legend and the held peak in whole dB. Its tooltip (`title`) says the render is normalized to −14 LUFS afterwards. It sits in the desktop branch of `AdvancedEdit.tsx` only, beside the bottom panel's section inside a new row (`mx-3 flex gap-3`, which took over the panel's height classes), so `workspace-layout` can move `<Meters playback={playback} />` whole.
- **Tests:** `ballistics.test.ts` (a peak shows at once, 24 dB in one second, the 1.5 s hold then its fall, the held peak in whole dB, the clip latch until cleared, settling); `meters.test.tsx` (nothing read until playing; playing moves the bars; pausing lets them fall, reads nothing, and the frames stop once down; the clip light stays until cleared; the column's legend and tooltip); `masterBus.test.ts` (with a fake AudioContext: each element routed once through its own gain at its value, into the bus; only the bus reaches the destination; its splitter feeds the two analysers).
- Checked in Chrome on a scratch page (an oscillator into the bus): the bars rise and fall, a gain of 1.3 latches the light, a click clears it, light and dark themes.

**Decided differently / left for later:**
- **Routing the decks always means the AudioContext is made when the preview mounts**, not on the first music or volume. It starts suspended and is resumed on the first pointer or key press (as before), which comes before any Play. Worth hearing in the walkthrough (15): the first Play, the clip editor's preview, and the phone, where the decks are now routed too.
- **The Media Library's audition player** isn't part of the preview, so it isn't metered.
- **A skim's sound snippets** pass through the bus but aren't metered: the Meters read only while playing.

