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

**Status:** done

- [x] Setting 2× on the middle of three Segments shortens the Main Track by half that Segment's length; a Text Layer after it moves up with the Magnetic timeline on, and stays with it off.
- [x] A media Segment's scale Keyframe at 2 s sits at 1 s after setting 2× from 1×, and the picture at that moment is the same frame.
- [x] Dragging the right edge of a 2× Segment by 1 s on the Timeline moves its Source end by 2 s (then snapped to Words on save).
- [x] Splitting a 2× Segment gives two 2× halves whose joined playback equals the whole's.
- [x] Copy and paste of a sped Segment keeps its Speed and its length on the Timeline.
- [x] The Filmstrip of a 2× Segment shows two seconds of the Source per second of the Timeline; the badge reads "2×".
- [x] Undo restores the Speed, the Keyframes and every rippled item in one step.

## Comments

**2026-10-17: done.**

**What was built (all frontend, `pages/job/advanced/`):**
- `speed.ts`: `SPEED_RANGE`, `SPEED_CHIPS`, `speedOf` (clamped, three significant figures, so 0.0625 stays exact), `speedLabel` ("2×"), and the slider's octave mapping.
- `SpeedFields.tsx`: the inspector's Speed section (a `Group`): chips 0.25 · 0.5 · 1 · 1.5 · 2 · 4 (an `aria-pressed` group, as the Keyframes pane's view toggle), the `Slider` over log2 of the Speed (−4..4, labelled "Any speed"), "Exact speed" typed in (×; a number outside 0.0625–16 waits instead of being clamped, so typing "0.5" never passes 0.0625×), and the `Switch` "Change pitch with speed" for an item with sound. It sits under the range hint in `SegmentFields` (not for a Freeze frame) and above the Time group in `OverlayFields` (videos only). **08:** the Reverse switch goes as one more row of this `Group`, after the pitch switch.
- `actions.ts`: `setSpeed(scene, {kind, id}, speed, {longest, video})`. A Segment keeps its range; its Keyframes go through `keyActions.scaledKeys(keys, old ÷ new)` (which drops a Keyframe crowded closer than a frame to the one kept before it, sped up); the change of its Timeline length is one `TrackChange` at its end (removed or inserted), rippled by `rippledIf` on the Magnetic timeline, so the layers follow as for a trim of its right edge. Refused with a notice when a video's Segment would play under 0.1 s (`MEDIA_MIN_SECS`) or the Clip would pass the longest clip. An Overlay keeps its start; `secs` × old ÷ new, kept within `(duration − offset) ÷ speed` of its video, its Keyframes scaled and re-anchored to that. `gestureSpeed()` makes each step of a group (`segment:<id>:speed`, `overlay:<id>:speed`) from the edits as it began (as `gestureRetime` does), so the slider dragged through a slow Speed and back brings back the layers its ripple cut and the Keyframes it crowded, and the history's group makes it one step of undo. `AdvancedEdit` wires it as `onSpeed`; `pitch` is a plain field change.
- Trim (`draggedSegments`): the drag already moved the range's edge through `sourceAt` (01); the minimum of 0.3 s is now on the Timeline (× Speed in the file), and a Source Segment's range stays within the longest clip (`longestClip(job.options.max_secs)`, passed through `dragSegment`'s new `longest`).
- Split: Segments already cut through the mapping and kept their fields (01); tests pin a 2× media and Source split. An Overlay's second part now starts at `offset + (at − start) × speed` in its video; so does an Overlay cut by a ripple (`ripple.ts`, `skipped × speed`) or pasted cut short at the Clip's start (`clipboard.ts`).
- Timeline: the Overlay's trim (`Tracks.tsx`) reads its video through its Speed (longest it can be, earliest start, the offset a start trim moves); `TimingFields` (offset and "Stays for" limits) too. A `SpeedBadge` ("2×") on sped Segments and Overlays, and ", at 2×" in their accessible names. Overlays have no Filmstrip on the Timeline (a thumbnail), so nothing more there. Filmstrip and Waveform of Segments were already read at `shown.speed` (01); tests pin a 2× tile row and its Peaks chunks.
- Manual Scenes (03's note): `keying.ts`' `manualScene` finds the Speed of the Segment showing the Scene (by the plan's Segments' scene counts) and shows the override's Keyframes divided by it (Timeline seconds); `withSceneKeys` writes them back times it, as the planner's `_keyed_manual` reads them.

**Tests:** `advanced/speed.test.ts` (17: ripple on and off, Keyframes on the same frame, refusals, Freeze frame, Overlay start and video end, the gesture's origin and one change, trims at 2× and their limits, splits of media, Source and Overlay, an Overlay cut by a ripple, Clipboard Segment and Overlay, Filmstrip tiles and Peaks chunks at 2×); `keyedScenes.test.ts` "a Manual Scene in a sped Segment". Checked in the browser on a copy of a real Job: 2× on a one-Segment Clip halves it (20.1 s → 10.0 s), the badge shows, the edit saves.

**Decided differently, or for later:**
- **No Speed change is refused for a stranded Keyframe**: the editor scales them, so none is stranded. A Keyframe dropped as crowded at a higher Speed is lost once the gesture ends (undo brings it back).
- **A Manual override's Keyframes read and written back** go through `× 1/speed` and `× speed` to a millionth, so an override edited in a sped Segment may have its other Keyframes moved by a millionth of a second. A Keyframe a frame apart on the Timeline in a slow Segment is less than a frame apart on the Source's scale, which the backend may refuse.
- **The preview outside 0.25–4×** plays at the nearest of those (02, 03) until 09: the Speed section doesn't say so.
- **Reverse** isn't handled by trim, split or the badge (08): `draggedSegments`' edges still assume forwards, as 01 noted.
