# 03: Tracer: a 1:1 or 16:9 Candidate from Job to Clip

**Parent spec:** `../spec.md` (Implementation Decisions "Model", "Planner": Track, Blur and defaults, "API and MCP"); GLOSSARY (Canvas Aspect); docs/adr/0022-a-canvas-aspect-per-candidate-in-its-own-pixels.md.

**What to build:** a Job made with aspect 16:9 (or 1:1) gives Candidates of that shape. Their preview, stage and rendered Clip have that shape. An MCP agent can set and read the aspect.

**Model**
- **The Candidate's `aspect`:** one of `9:16`, `4:5`, `1:1`, `16:9`.
  - It is saved with each Revision, in the Revision part that holds the Layout. A Candidate saved without it reads as `9:16`.
  - Duplicate keeps it.
  - An unknown value is a 422.
- **`JobOptions.aspect`:** defaults to `9:16`. Selection's Candidates and Candidates added by hand take it.

**Validation, planner and render**
- **Validation:** Candidate-owned positions (Transforms, their Keyframes, Cue Edits) are checked against the Candidate's Canvas. For example, x 1500 is accepted on 16:9 and refused on 9:16.
- **The planner** makes the plan on the Candidate's Canvas.
  - Track crops at the Canvas's aspect. On 16:9 with a 16:9 Source, that crop is the whole Source and the camera doesn't move.
  - Blur fits the Source over its blurred cover. With the same aspect as the Canvas, the Source alone shows.
  - Split keeps today's stacked panels for now (06 changes it).
- **The render** gives the Canvas's shape at the Export Preset's short side.

**Editing and MCP**
- **Changing `aspect`** through the PATCH or `edit_candidate` makes a new Revision, and the Clip goes stale. Positions are not rescaled yet (04 adds that).
- **MCP:**
  - `create_job_from_url` and `create_job_from_file` take `aspect` in the options.
  - `get_candidate` shows `aspect` and the Canvas size.
  - `edit_candidate` takes `aspect`.
  - `dry_run`'s Preview Plan shows the Canvas and the Safe Area.

**Blocked by:** 01, 02.

**Status:** ready-for-agent

- [ ] API/MCP tests: the aspect is validated, it defaults on old Candidates, `JobOptions.aspect` reaches Selection's and a hand-added Candidate, Duplicate keeps it, a change makes a new Revision and a stale Clip, and positions are validated per Canvas.
- [ ] Planner tests (Seam B): Track's crop aspect on 1:1 and 4:5; Track on 16:9 with a 16:9 Source covering the Source without movement; Blur's band on 1:1 and none on 16:9 with a 16:9 Source.
- [ ] Render test (Seam A): a 1:1 Candidate at 1080p is 1080×1080; a 16:9 one is 1920×1080; a 16:9 one at 720p is 1280×720.
- [ ] Browser: a 16:9 Candidate's Advanced Edit shows a 16:9 stage, and dragging a Text Layer across the whole width works.
- [ ] Before the last commit: `git merge main`.
