# 04: Segment fades, for the agent, the render and the preview

**Parent spec:** `spec.md` in this feature folder (user stories 1–3, 6, 8–9, 60; Solution "Fades on every Segment"; Implementation Decisions "Model", "Planner, other", "Renderer", "Preview", "MCP"); ADR 0016.

**What to build:** the agent can fade a Segment's sound, Source or media, in at its start and out at its end, linearly, up to 10 s each. The render and the preview hear the same fades, including under a Transition, where they multiply the crossfade. There is no editor UI yet (05).

- **Model.** `fade_in` and `fade_out` (0–10 s, default 0) on Segment. A Freeze frame refuses them.
- **Planner.** `SegmentPlan` carries them, fitted to its Timeline length as a Music Clip's are (both scaled down when together longer than it). The gain function and the shared fixture (01) gain a Segment's case.
- **Renderer.**
  - Each Segment's sound chain gets a linear `afade` in and out after its volume (or keyed volume), measured from the Segment's sound start, the Transition overlap included.
  - `acrossfade` stays as it is.
  - The plain `concat` path requires no fades.
- **Preview.** The decks' Source sound and a media Segment's event follow a gain curve that includes the fades, also when the volume isn't keyed.
- **MCP.** The fields pass through the edit tools. The instructions describe them. The dry run lists each Segment's fades.

**Blocked by:** 01.

**Status:** done

- [x] A Source Segment with a 1 s fade in renders rising from silence: its level at 0.25 s and 0.5 s is within tolerance of a quarter and a half of its level at 1.5 s (tone).
- [x] A media Segment's fade out ends in silence at its end.
- [x] Fades of 3 s and 3 s on a 4 s Segment are fitted to 2 s and 2 s in the plan.
- [x] A fade on a Segment beside a Transition multiplies the crossfade; the render's Clip length is unchanged.
- [x] The API and MCP refuse fades on a Freeze frame and outside 0–10 s.
- [x] The shared gain vectors gain Segment fade cases, passing in pytest and vitest.
- [x] A stored Candidate without fades renders the same command as before.

## Comments

**2026-10-18: done.**

**What was built:**
- **Model.** `Segment.fade_in` and `fade_out` (the new `Fade` type in `candidates.py`, 0–10 s, which the Music Clip's fades now use too), after `hold`. `_check_held` refuses them on a Freeze frame ("Segment still is a Freeze frame (hold), which is silent: it has no fades"). A lone Source Segment played as filmed is no longer folded into `start`/`end` when it has fades, alongside 06's rule for a volume or Keyframes of its own.
- **Planner.** `fades_within` is the fade fitting pulled out of `audio_events`, now shared by Music Clips and Segments. `SegmentInput` and `SegmentPlan` carry the fades; `plan_render` fits a Segment's to its Timeline length (its overlap with a Transition included). `gain_at` takes a `SegmentPlan` as well, before the Clip's own volume and the crossfade. `candidate_plan` passes the fades through.
- **Renderer.** A faded Segment's sound chain is `asetpts=PTS-STARTPTS`, its volume (or 06's keyed volume × `source_volume`), then `_fades` (the Music Clip's `afade`s, now one helper). It is measured from the Segment's start on the Timeline, so under a Transition the `acrossfade` multiplies it. The plain `concat` path requires no fades, and an unfaded Clip's command is unchanged. `fixtures/segmented_command.json` was taken from the code before this ticket, so it pins a cut Clip's command (a video's Segment, a Transition, Source Segments, a song).
- **Shared fixture.** `gain_vectors.json` cases may say `"item": "segment"`. There are three: faded; fades longer than it, shortened; keyed and faded. `test_gain.py` plans them through `plan_render` as a video's Segment, and `loudness.test.ts` through `segmentSound`.
- **Preview.**
  - `loudness.ts`: `segmentSound`, merged with 06's `sourceSound`, which it replaces, makes a Segment's sound. That sound is its volume or Keyframes (a Source Segment's × `source_volume`) and its fades. A Transition taking it away adds a `crossfade` that falls linearly and multiplies, as acrossfade does. `changing` says when a curve must be followed.
  - The decks' masters (`PreviewMusic`) follow the planned Segment's curve while the plan has the Segments the playback plays, and the drafted one otherwise (06's path).
  - `MediaSegment`, `CopiedSourceSegment` and the Transition ghost (`PreviewTransitions`) hear the fades × crossfade.
- **MCP.**
  - The fields pass through `edit_candidate` and `merge_candidate_items`.
  - An instructions paragraph describes them.
  - The dry run's `segments` give `fade_in` and `fade_out` when set.
- **Tests.** `backend/tests/test_segment_fades.py`:
  - Seam B: fitting at 1× and 2×; fades from the overlap's start.
  - The command fixture.
  - API and MCP saving and refusals, and the dry run.
  - Real renders:
    - a Source Segment fading in heard at ¼, ½ and ¾ (±0.5 dB);
    - a video Segment's fade out ending below −30 dB;
    - a fade out under a 1 s Transition heard as fade × crossfade, the Clip as long as unfaded.
  - `loudness.test.ts` adds the Segment and crossfade cases.

**Decided differently / left for later:**
- **The tool list was over its 69 000-byte budget** with the Segment's two fields in both tools (69 315). `build_mcp` now strips pydantic's `title`s from every tool's parameter schema (`_untitled`): they only repeat each field's name. The list is ~60 500 bytes, which also leaves room for 02's and 07's fields. A property named `title` and defaults are kept.
- **The preview's Transition stays the ghost's approximation.** The incoming Segment isn't faded in by the crossfade, as before; its own fade in is heard. A fade on a Segment drawn from the draft before a plan has it (a lone Segment in the Advanced Edit) isn't heard until the plan comes, since the plan fits it.
- **No editor UI** (05). `timelineView.ts` still draws a Segment's Waveform unfaded.
