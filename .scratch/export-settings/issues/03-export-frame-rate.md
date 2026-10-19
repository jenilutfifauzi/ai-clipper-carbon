# 03: Export frame rate

**Parent spec:** `../spec.md` (Solution "the frame rate changes the render"; Implementation Decisions "Planner and renderer"); docs/adr/0021-export-presets-and-a-plan-drawn-at-any-size.md (the frame rate is the one Export Setting the plan depends on).

**What to build:** a Clip rendered at the Export Settings' frame rate, with everything that snaps to frames on the output's frames.
- **The planner takes the frame rate to plan at.** Everything that uses the Source's rate today uses it instead: frame-snapped cuts, Transitions, Freeze frames, Manual Scenes' cover check, keyed pictures' frame times.
- **The render plans at the export's rate,** or the Source's for Same as Source, and encodes at it. The plan file beside the Clip carries that rate.
- **The Preview Plan always plans at the Source's rate.**
- **A rate above the Source's** gives the picture layers', Overlays' and keyed Framings' motion at the higher rate. The Source's frames repeat.

**Blocked by:** 01

**Status:** done

- [x] A 60 fps setting on a 30 fps Source gives a 60 fps Clip with the right duration. Same as Source keeps the Source's rate.
- [x] 23.976 and 29.97 give those exact rates (ffprobe's r_frame_rate).
- [x] Planner (pure): a plan at 60 fps snaps a Freeze frame and a Transition to 60 fps frames, and the Preview Plan of the same Candidate stays at the Source's rate.
- [x] A keyed Shape at 60 fps is at its keyed place at a frame between two of the Source's frames.
- [x] Existing renders at Same as Source are unchanged.

## Comments

**2026-10-19, agent:** Built.
- **Planner** (`app/planner.py`): `plan_render(..., fps=None)` plans at `fps`, or at `source.fps` without one. `RenderPlan.fps` is the rate planned and encoded at, and the new `RenderPlan.source_fps` is the Source's. Keyed pictures (media Segments, keyed Manual Scenes through `_keyed_manual`, and so their cover check) are drawn and checked at frames of the plan's rate. The camera's follow (`_follow_speaker`, `_follow`) stays on the Source's frames, since the faces and crops are the Source's.
- **Decision: at another rate than the Source's, a Freeze frame's hold and a Transition's overlap are whole frames of the plan's rate** (at least one, `whole_frames`), and the Segments after them move with them. At the Source's rate nothing is snapped, so Same as Source plans, the Preview Plan and the Timeline's `track_length` are exactly as before. Today's planner never snapped times to frames: cuts are where the Words put them, and the renderer joins the Source's frames as they come. Snapping every edge at every rate would change existing plans and the editor's Timeline lengths, which the last box rules out.
- **Renderer** (`app/renderer.py`): `_rate(plan)` gives 23.976, 29.97 and 59.94 as `24000/1001`, `30000/1001` and `60000/1001`. `_rate_value` is its float, and the transitions' `fps=` uses it too. A 29.97 Source at Same as Source is now spelled `30000/1001` where the graph names its rate. When `plan.fps != plan.source_fps` (`_resampled`):
  - the joined frames are brought to the rate (the `[timed]` step keyed pictures already used), so captions, Overlays and picture layers are drawn on the output's frames;
  - with several Segments and no Transition, each Segment is brought to the rate before the concat, so cuts land on the Clip's frames;
  - a Freeze frame's one frame is brought to the rate before `tpad`, so it holds whole frames of it.
  At the Source's rate the command is byte for byte as before, except for the NTSC spelling above.
- **Render worker** (`app/rendering.py`): `candidate_plan(..., fps=None)` and the worker builds `export = ExportSettings()` once, plans at `export.fps` and renders with `export`. The editor's Preview Plan (`app/editor.py`) passes no `fps`, so it plans at the Source's rate.
- Tests: `backend/tests/test_export_frame_rate.py`.
  - Seam B: a keyed Manual Scene's cover is checked at 60 fps frames between the Source's; at 60 fps a Freeze frame and a Transition last 20 frames, and at the Source's rate (or `fps=25` on a 25 fps Source) the plan is as before.
  - Seam A, on a 30 fps portrait Source: 60, Same as Source, 23.976 and 29.97 give `60/1`, `30/1`, `24000/1001` and `30000/1001` with 2 s of frames. A Freeze frame after a cut or after a Transition at 60 fps keeps the plan's length. A keyed Shape at 60 fps is at its keyed x at frame 31, between two of the Source's frames. The Preview Plan says `fps` = `source_fps` = 25.
  - The existing planner, freeze frame, transitions, keyed, render, export settings, segments, sped and reversed files pass unchanged.
- **For 04:** pass the Preset's settings in place of `ExportSettings()` in `Renders._render`. `export.fps` already goes to `candidate_plan`. The plan file beside the Clip then carries that rate. The frontend's `RenderPlan` type (`frontend/src/api.ts`) doesn't list `source_fps` yet; nothing reads it.
