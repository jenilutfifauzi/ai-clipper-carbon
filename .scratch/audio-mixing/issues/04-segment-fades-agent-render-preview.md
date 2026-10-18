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

**Status:** ready-for-agent

- [ ] A Source Segment with a 1 s fade in renders rising from silence: its level at 0.25 s and 0.5 s is within tolerance of a quarter and a half of its level at 1.5 s (tone).
- [ ] A media Segment's fade out ends in silence at its end.
- [ ] Fades of 3 s and 3 s on a 4 s Segment are fitted to 2 s and 2 s in the plan.
- [ ] A fade on a Segment beside a Transition multiplies the crossfade; the render's Clip length is unchanged.
- [ ] The API and MCP refuse fades on a Freeze frame and outside 0–10 s.
- [ ] The shared gain vectors gain Segment fade cases, passing in pytest and vitest.
- [ ] A stored Candidate without fades renders the same command as before.
