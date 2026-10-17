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

**Status:** ready-for-agent

- [ ] The fixture's cases pass in pytest and vitest: Timeline length with and without Transitions; Timeline → Source → Timeline round trips for forward, 2×, 0.5×, reversed and held Segments.
- [ ] No inline `source_start + (t − start)`-style mapping or `end − start` Segment length remains outside the mapping, in the backend or the frontend.
- [ ] Every existing backend and frontend test passes unchanged.
- [ ] A cut Clip with Transitions plans, renders and previews exactly as before (same Render Plan apart from the new default fields).
