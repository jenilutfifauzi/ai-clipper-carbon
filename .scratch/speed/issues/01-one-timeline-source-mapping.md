# 01: One mapping between Timeline time and Source time per Segment

**Parent spec:** `spec.md` in this feature folder (Implementation Decisions "One mapping between Timeline time and Source time per Segment", "The Candidate model": the one function for a Segment's Timeline length); docs/adr/0009-speed-keeps-the-range-and-reverse-is-a-derived-copy.md.

**What to build:** a prefactor with no change in behaviour. Every place that maps a Segment's Timeline time to its Source (or video) time, or works out its length on the Timeline, goes through one mapping, so that the later tickets change one rule instead of a dozen.

- **The mapping, in the backend and the frontend:** a Segment's Timeline length, Timeline → Source and Source → Timeline, written for forward, sped, reversed and held Segments from the start (only forward at 1× is reachable yet). Both test suites read one shared fixture, as the Keyframe sampler's do.
- **Callers moved onto it:**
  - backend: the Timeline length and Transition overlap, the longest-clip check, the Candidate's duration, the planner's main-track loop and Segment Words, Word Edit and Layout Override shifts, Manual Scene anchoring, the preview words, render progress, the renderer's per-Segment reads and keyed Scenes, the keyed frame decode, the MCP plan view;
  - frontend: the played Segments and their overlap cut, the decks' read, enter, move and park, the Skim, `follow`, the Loop Region's wrap, the trim drag, split, the Clipboard's length, Segment Keyframe spans, Filmstrip tiles and Waveform chunks, the Scenes track's Source time.
- **Transition overlaps are worked out from Timeline lengths everywhere.** Today one place uses Source lengths and another Timeline spans.
- **The Render Plan's Segment entries** carry `speed`, `reverse` and `hold`, at their defaults (1, false, none).

**Blocked by:** None (can start immediately).

**Status:** done

- [x] The fixture's cases pass in pytest and vitest: Timeline length with and without Transitions; Timeline → Source → Timeline round trips for forward, 2×, 0.5×, reversed and held Segments.
- [x] No inline `source_start + (t − start)`-style mapping or `end − start` Segment length remains outside the mapping, in the backend or the frontend.
- [x] Every existing backend and frontend test passes unchanged.
- [x] A cut Clip with Transitions plans, renders and previews exactly as before (same Render Plan apart from the new default fields).

## Comments

**2026-10-17: done.**

**Where the mapping lives:**
- backend: `app/segment_time.py`. `SegmentTime(start, end, speed=1, reverse=False, hold=None)` with `length` (Timeline length, `hold` or `(end − start) ÷ speed` to 6 decimals), `span` (the range's length: what is read), `source_at(offset)`, `offset_at(source)`, `offset_of(into)` (the same for a time given in seconds into the range, as Words, Word Edits and Layout Overrides reach the planner) and `part(begin, end)` (a Scene's piece of it). `segment_time(segment)` reads a Candidate's Segment (its `speed`, `reverse` and `hold` with their defaults until the Segment has them); `transition_overlap` moved here from `candidates.py`, and `track_length(times, joins)` is the Main Track's length, which `candidates.timeline_length` now calls.
- frontend: `pages/job/editor/segmentTime.ts`. `segmentLength`, `sourceAt`, `offsetAt` on a `SegmentRange` (`start`, `end`, optional `speed`, `reverse`, `hold`); `playedSourceAt`, `playedTimeAt`, `playedUntil` and `rangeOf` on a `PlayedRange` (a Segment as played); `paceOf`, `playingFrom` (a Filmstrip's or Waveform's media from its left edge), `transitionOverlap`, `trackLength`.
- Both are tested on `backend/tests/fixtures/segment_times.json` (`tests/test_segment_time.py`, `segmentTime.test.ts`).
- `SegmentPlan` (planner and `api.ts`) and `SegmentInput` carry `speed`, `reverse` and `hold`, with a `time` property in Python; `rendering.candidate_plan` passes them from `segment_time(segment)`. In `api.ts` they are optional, so that plans written by hand in the tests still type-check. `PlayedSegment` extends `PlayedRange`, and `playedFrom` copies only the fields a Segment has (`paceOf`).

**Left as they were, on purpose:**
- Shifts between Source time and seconds into a Segment's range (`edit.at - segment.start`, `o.at - segment.start` in `rendering.py` and `editor.py`, `transcript_words`) stay: they are on the Source's side, which Speed doesn't change (ADR 0002, 0009). The planner then places them on the Timeline through `offset_of`.
- Overlays' reads (`_overlay_inputs`, and the `SegmentTime` the renderer builds for a keyed Overlay's `VideoDecode`) and Music Clips are 1:1 still: an Overlay's Speed is ticket 04. (`follow`, `filmstripTiles`, `chunksAcross` and the Filmstrip and Waveform layers already take an optional pace or `speed` and read through the mapping; the Advanced Edit passes a Segment's.)
- `editor.py`'s preview Words still ignore Transition overlaps, as before (each Segment's Words placed from the sum of the lengths before it). Kept unchanged; the plan's captions do take the overlaps into account.
- The clip editor's trim of an uncut Clip (`clipTrimmed`) is on the Source, and an uncut Clip has no Speed (a sped one is stored as `segments`).

**Checks:**
- A cut Clip with four Segments, three Transitions, Word Edits and Layout Overrides (a keyed Manual one) plans identically before and after (`asdict` of the Render Plan, the new fields aside), with the same Source reads and keyed Scene decode.
- Rounding: a Segment's length is now rounded to 6 decimals wherever it is used (it was raw in most places), as the spec says. No test noticed.

