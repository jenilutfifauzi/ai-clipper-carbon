# 02: Cut out a Source Segment in the render (tracer)

**Parent spec:** `../spec.md` ("Model", "Matte store and runner", "Planner", "Renderer", "Editor", "MCP"); ADR 0015.

**What to build:** the owner switches on "Remove background" for a Source Segment (or several picked at once), in any Layout. The Inspector shows "Finding the subject… N%" while the Matte is made in the background. The rendered Clip shows only the speaker, their surroundings replaced by their own picture blurred (the default Background). In this ticket the preview still shows the picture whole; 03 draws the cut. The agent can do the same through MCP and follow the Matte's progress.

**The model:** a Segment gains an optional `background_removal` = `{subject, feather}`. `subject` is `person` only, and `feather` is 0–40 output px at the picture's fitted size (default 4). An unknown subject or a value out of range is refused on every save path, naming the item. An absent field is off.

**The Matte:**
- A Matte module keeps pieces of 10 s aligned to the Source's timeline, keyed by subject, model version and piece start. Each piece is a grayscale video at a 1280 px long edge, at the Source's frame rate, one Matte frame per frame.
- Its interface, for a range, says which pieces exist, are missing, in progress or failed. It enqueues the missing ones, gives progress, and retries.
- The model sits behind a narrow matter seam: frames in at model size, alpha frames out, with recurrent state kept across a run. The real matter runs RVM through onnxruntime with CoreML ahead of the CPU. Each piece starts 1 s early to warm up, and the warm-up frames are dropped.
- A runner (like the Retimed copies') makes pieces one at a time, outside the Worker, at low priority, latest request first. Saves that switch Background removal on or change a range ask for them.
- A failure is remembered per piece until a Retry.

**The render:**
- The planner puts Background removal (feather scaled by the item's scale) and the pieces read on the SegmentPlan, and the dry-run view shows it.
- The renderer reads the Matte with the same `-ss`/`-t` as the picture, follows the Layout's crop and scale, feathers it, and `alphamerge`s it after crop, scale and flips, before the Grade and Video Effects.
- It composites the result over the Segment's picture blurred (the default Background, used in every Layout; in Blur it replaces the Layout's fill). All of this happens before the joins.
- A render makes the missing pieces first, inside its job, with progress. A failed piece, or the model absent, fails the render with a message naming the item and the cause.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Seam B: the field reaches the SegmentPlan with its feather scaled; the dry run shows it; a stored Candidate without it plans exactly as before.
- [ ] Seam A with a fake matter (it keeps one coloured disc of a generated pattern): a rendered frame shows the disc's colour inside and the blurred picture outside; the feather softens the edge; a Transition keeps its timing; a stored Candidate renders the same command as before.
- [ ] Switching on makes the pieces covering the range; a trim within them, or a second Candidate over the same Source time, makes none.
- [ ] A render makes missing pieces first; a failed piece fails the render with its message, and Retry clears it.
- [ ] The Inspector section gains the switch, the feather and the Matte's status (progress, failed with Retry), on a mixed Pick (shared fields) and in the phone's sheet, each change one step of undo.
- [ ] MCP: `merge_candidate_items` and `edit_candidate` set the field and refuse bad values; a tool reports (and waits on, with `ctx.report_progress`) a Candidate's Matte progress.
- [ ] Run only this feature's backend test files.
