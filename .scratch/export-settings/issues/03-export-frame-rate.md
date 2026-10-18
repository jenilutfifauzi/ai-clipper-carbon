# 03: Export frame rate

**Parent spec:** `../spec.md` (Solution "the frame rate changes the render"; Implementation Decisions "Planner and renderer"); docs/adr/0021-export-presets-and-a-plan-drawn-at-any-size.md (the frame rate is the one Export Setting the plan depends on).

**What to build:** a Clip rendered at the Export Settings' frame rate, with everything that snaps to frames on the output's frames.
- **The planner takes the frame rate to plan at.** Everything that uses the Source's rate today uses it instead: frame-snapped cuts, Transitions, Freeze frames, Manual Scenes' cover check, keyed pictures' frame times.
- **The render plans at the export's rate,** or the Source's for Same as Source, and encodes at it. The plan file beside the Clip carries that rate.
- **The Preview Plan always plans at the Source's rate.**
- **A rate above the Source's** gives the picture layers', Overlays' and keyed Framings' motion at the higher rate. The Source's frames repeat.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A 60 fps setting on a 30 fps Source gives a 60 fps Clip with the right duration. Same as Source keeps the Source's rate.
- [ ] 23.976 and 29.97 give those exact rates (ffprobe's r_frame_rate).
- [ ] Planner (pure): a plan at 60 fps snaps a Freeze frame and a Transition to 60 fps frames, and the Preview Plan of the same Candidate stays at the Source's rate.
- [ ] A keyed Shape at 60 fps is at its keyed place at a frame between two of the Source's frames.
- [ ] Existing renders at Same as Source are unchanged.
