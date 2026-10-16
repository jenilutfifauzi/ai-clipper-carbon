# 01: A keyed image Overlay, end to end

**Parent spec:** `spec.md` in this feature folder (user stories 1–4, 8–10, 42–43, 45–48; Implementation Decisions "The Candidate model", "One sampling module, twice", "Planner", "Renderer", "Preview", "MCP"); docs/adr/0008-keyframes-for-pictures-and-sound.md.

**What to build:** the agent can animate an image Overlay's position, scale, rotation and opacity with Keyframes and Eases. The preview plays the motion, and the rendered Clip moves the same way. There is no editor UI for Keyframes yet (06): this is driven through MCP and the API. Video Overlays and decoration on keyed pictures come in 02.

- **Model.** The Ease and Keyframe value objects, and `keys` on the Overlay for `x`, `y`, `scale`, `rotation` and `opacity`. The spec's validation: properties allowed, sorted, one frame apart, at most 100, `at` within the Overlay, values in range, the Ease tidied. An Ease is accepted as a preset's name or four numbers, and stored as four numbers.
- **The sampling module,** in the backend and the frontend: the value at a time, and the bezier solver. Both test suites read one shared fixture of Ease vectors.
- **Planner.** A keyed Overlay's picture carries its motion (a track per keyed property, in Timeline time) and its drawn size at scale 1. A keyed picture is planned whole, not trimmed to the frame.
- **Renderer.** The renderer can take raw RGBA inputs from pipes. A new Python frame process draws a keyed image Overlay for each output frame with OpenCV: crop, sampled size, flips, rotation, opacity, and a 2 px transparent margin. ffmpeg lays it over with straight alpha where today's picture chain goes. OpenCV becomes a declared dependency. An unkeyed Overlay keeps today's chain.
- **Preview.** A keyed Overlay samples its motion on every frame of the playback clock and writes its styles directly, outside React's render. The Grips and Smart Guides use its bounds at the playhead.
- **MCP.**
  - `keys` in the edit tools, merged by property in `merge_candidate_items`.
  - A change of the Overlay's `start` or `secs` that strands a Keyframe is refused, with a message naming it.
  - The dry run lists the Keyframes in Timeline time and the bounds at each.
  - The instructions get the Keyframes paragraph.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Seam K:
  - [ ] each preset and some Custom Eases (one overshooting) at x 0, 0.25, 0.5, 0.75 and 1, within 1e-6, in pytest and vitest from the shared fixture;
  - [ ] the value before the first Keyframe, after the last, between two, and at two a frame apart.
- [ ] Seam B:
  - [ ] an Overlay keyed in `scale` 1 → 2 plans a scale track at its start plus each `at`, with its drawn size at scale 1;
  - [ ] a keyed zoomed picture is planned whole.
- [ ] Seam A, real ffmpeg:
  - [ ] an image Overlay keyed in `x` 200 → 800 over 2 s, Ease in-out, has its centre at 500 ± 2 px in the frame at 1 s;
  - [ ] held at 0.5 opacity and 90°, it matches the static chain's frame above a set PSNR;
  - [ ] an unkeyed Clip's ffmpeg command is unchanged.
- [ ] Seam A, HTTP and MCP:
  - [ ] Keyframes a frame apart are accepted, closer ones refused;
  - [ ] a 101st Keyframe, an `at` past the Overlay and an out-of-range value are refused;
  - [ ] an MCP change of `secs` that strands a Keyframe is refused, naming it;
  - [ ] a merge with only opacity Keyframes keeps the scale Keyframes;
  - [ ] `ease_out` is stored as four numbers;
  - [ ] the dry run lists the Keyframes and their bounds.
- [ ] The preview's motion matches the rendered Clip at a few times (checked by hand on one Clip).
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.
