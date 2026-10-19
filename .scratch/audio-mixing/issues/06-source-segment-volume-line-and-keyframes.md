# 06: Volume Line and volume Keyframes on Source Segments

**Parent spec:** `spec.md` in this feature folder (user stories 10–13, 60; Solution "Source Segments get a Volume Line and volume Keyframes"; Implementation Decisions "Model", "Planner, other", "Renderer", "Timeline", "Inspector"); ADR 0016 (amends 0008); GLOSSARY "Volume Line", "Keyframe".

**What to build:** a Source Segment's volume can be dragged on its Volume Line and keyed over time, as a media Segment's can, in the editor and through the agent. The Clip's own sound slider (`source_volume`) still scales every Source Segment, keyed or not.

- **Model.** A Source Segment accepts volume Keyframes and still refuses picture Keyframes. A Freeze frame still refuses volume Keyframes. The error names what is refused.
- **Planner.** A Source Segment's `gain` carries its volume Keyframes.
- **Renderer.** The keyed path multiplies by `source_volume` for a Source Segment (it doesn't today, because only media Segments were keyed).
- **Preview.** The decks' Source sound follows the keyed curve × `source_volume`.
- **Timeline.** A Volume Line on Source Segments, at the Segment's own volume, following its Keyframes. It can be dragged on a picked one, with Auto-key. The Waveform is shaped by the gain.
- **Inspector and Keyframes pane.** The keyed volume control (‹ ◆ ›) on a Source Segment. Its volume row in the Keyframes pane.
- **MCP.** The instructions no longer say a Segment of the episode has none.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A Source Segment keyed from 1 to 0.25 renders as loud as its sampled gain at chosen times (tone), with `source_volume` 0.5 halving it.
- [x] The API and MCP accept volume Keyframes on a Source Segment and refuse picture Keyframes on it, and volume Keyframes on a Freeze frame.
- [x] Dragging a Source Segment's Volume Line sets its volume; once keyed, it writes a Keyframe at the playhead (Auto-key).
- [x] Split and trim of a keyed Source Segment re-anchor its volume Keyframes as a media Segment's are.
- [x] The Keyframes pane shows a Source Segment's volume row.
- [x] Backend tests and `npm run typecheck && npm run build` pass.

## Comments

**2026-10-18: done.** Built test first in `backend/tests/test_keyed_source_segments.py` (Seam B on the planner; Seam A through the API, MCP and the real ffmpeg) and the frontend's `advanced/keyedSegments.test.ts`, `advanced/actions.test.ts`, `advanced/timelineView.test.ts` and `editor/loudness.test.ts`.

**What was built:**
- **Model.** `Segment.__post_init__` (`candidates.py`) refuses only a Source Segment's picture Keyframes, naming the property: "Segment e shows the episode, whose Layouts frame it: it has no x Keyframes, only volume ones". Its volume Keyframes are checked against its Timeline length as a video's are. A Freeze frame's volume Keyframes are still refused by `_check_held` ("… which is silent: it has no volume Keyframes").
- **API.**
  - `review.update` no longer folds a lone Source Segment into the Clip's `start`/`end` when it has a volume other than 1 or Keyframes. Before this, a lone Segment's own volume was dropped on save, and its Keyframes would have been too.
  - `Episode.segments` re-anchors a Source Segment's Keyframes when the server snaps its ends to Words (`_snapped_keys` in `review.py`, through a new `rewindow` in `app/keyframes.py`). The Keyframes stay on the same moments of the Source, so an editor trim or split that the snap shortens isn't refused for a Keyframe past the end.
- **Planner.** `rendering.candidate_plan` passes a Source Segment's `keys` to its `SegmentInput`, so its `SegmentPlan.gain` carries its volume Keyframes. The planner itself needed no change.
- **Renderer.**
  - In `_source_inputs`, a keyed Source Segment's chain is `asetpts`, `_volume(gain)`, then `volume=<source_volume>` (left out at 1).
  - The plain `concat` path also requires no `gain`.
- **Preview.**
  - `loudness.ts` gained `sourceSound(segment, source_volume, fade?)`: a Source Segment's `AudioEvent`, its Keyframes' values times `source_volume`.
  - `PreviewMusic` sends the decks' masters through `followCurve` while a keyed Source Segment is shown (one event per shown Segment, so the curve isn't set again every tick). `CopiedSourceSegment` (`PreviewSegments.tsx`) does the same for a reversed or copied one.
  - `PreviewTransitions` samples the keyed value under its fade.
  - `playedFrom` (`playback.ts`) carries a Segment's volume Keyframes as `gain`, so the curve is heard before the plan has the Segments too (a Clip of one Segment).
- **Timeline** (`Tracks.tsx`).
  - Source Segments that aren't Freeze frames get the `VolumeLine` at their own volume (`segmentHeard`), keyed or not. It is dragged through the existing `onVolume` → `writeItemKey`, so Auto-key works.
  - `SourceFilmstrip` takes a `Heard` (new `sourceHeard` in `timelineView.ts`: the Segment's volume or Keyframes times `source_volume`), so the Waveform follows the curve.
  - The `· N%` label is hidden once keyed, as on a Music Clip.
- **Keying** (`keying.ts`).
  - The `segment` kind finds a Source Segment as a keyed item with no Transform and no media. Its only row is `volume`: `keyable` now also gets the keyed item, and `keyRows` passes it.
  - Writing a Source Segment's keys sets only its `keys` and `volume`. A Freeze frame of the Source is still not keyable.
  - So the Keyframes pane, K, [ ], the ruler diamonds and the inspector's ‹ ◆ › work on a picked Source Segment.
- **Inspector.** "This Segment's sound" is a `KeyedVolume` with its cluster, written through the inspector's `volumeOf` (a Keyframe at the playhead once keyed). `setVolume` (`actions.ts`) now sets a Source Segment's volume too, but not a Freeze frame's.
- **Trim and split.** These needed no code: `dragSegment`'s `retimed` and `split`'s `rekeyed` already re-anchor any Segment's Keyframes. The tests pin it for a Source Segment.
- **MCP.**
  - The Keyframes paragraph says any Segment's `volume` can be keyed, with `source_volume` scaling an episode Segment's, and that a Segment of the episode has no picture Keyframes.
  - It also says an episode Segment's Keyframes stay on their moments as its ends snap to Words.
  - The dry run's `sounds` lists a keyed Source Segment (`media: null`); that needed no code.

**Decided differently / left for later:**
- **The server re-anchors a Source Segment's Keyframes on its Word snap.** The ticket didn't ask for this, but without it a trim or split of a keyed Source Segment is refused whenever the snap shortens it.
  - Python's `rewindow` keeps a cut span's whole Ease, where the editor's takes the part it plays (`easePart`). The snap moves an edge by a fraction of a second, so the difference is small.
- **A Source Segment over a Manual Scene with its own override:** the Keyframes pane, K and the ruler diamonds act on the Manual Scene's picture, as before. Its volume row shows only where no such Scene is under the playhead. The inspector's ‹ ◆ › on "This Segment's sound" always works.
- **The Transition's ghost deck** sets the keyed value on each tick rather than following a curve. The overlap is short.
- **Not checked by hand in a browser:** dragging the Volume Line, the inspector's cluster, and hearing the curve on the decks. What stands in for that:
  - `keyedSegments.test.ts` checks the drag's `writeItemKey` (the constant, then a Keyframe at the playhead, and none outside), the toggle, the trim, the split and the rows;
  - `loudness.test.ts` checks the decks' sound;
  - `timelineView.test.ts` checks the Waveform's gain;
  - typecheck and build cover the wiring;
  - ticket 15's walkthrough covers the rest.
- **Tests:**
  - `test_keyed_source_segments.py`:
    - the planner's `gain`;
    - API kept and refused cases, and the lone Segment kept;
    - Keyframes kept on their Words across a snap that moves both ends;
    - the MCP merge, refusal and dry run;
    - two real renders of a keyed Source Segment over a steady 880 Hz song, reading the 440 Hz tone against it in the same window, within 0.5 dB of the sampled gain, and 6 dB down at `source_volume` 0.5.
  - `test_keyed_segments.py`'s refusal test now expects the new message.
