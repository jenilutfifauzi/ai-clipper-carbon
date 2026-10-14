# 08: Transitions

**Parent spec:** `spec.md` in this feature folder (user story 14).

**What to build:**
- **Model:**
  - `Transition` on the Candidate (`transitions`): `after` (a Segment id), `kind`, `secs` (0.2–1.5).
  - Kinds: `fade`, `fadeblack`, `fadewhite`, `slideleft`, `slideright`, `slideup`, `slidedown`, `wipeleft`, `zoomin`, `circleopen`.
  - The length is clamped to half of the shorter neighbour.
  - It is dropped when its Segment is deleted or moved to the end.
- **Planner:**
  - A `TransitionEvent`. The two Segments overlap by `secs`, so the Clip is that much shorter.
  - Layers keep their Timeline time, and the plan clamps any that now run past the end.
- **Renderer:** the pair is joined with `xfade=transition=<kind>:duration:offset` and `acrossfade` instead of `concat`.
- **Preview:**
  - Both Segments' videos play during the overlap.
  - CSS imitates the kind (opacity, translate, clip-path, scale).
  - The timing must match exactly; the look only roughly.
- **Workspace:**
  - The Transitions tab lists the kinds.
  - Drop a kind on a join, or tap the join on mobile.
  - The inspector sets the length; delete removes the Transition.
- **Glossary:** add **Transition**. Note that `jobs.Transition` (the Job status history) is a different thing, and consider renaming it.

**Blocked by:** 05 (06 is not needed, but test a join with a media Segment once it exists).

**Status:** ready-for-agent

- [ ] Seam B: the overlap shortens the Clip; clamping; dropped when its join disappears.
- [ ] Seam A: `xfade` render has the expected duration; a frame mid-transition differs from both ends.
- [ ] Typecheck and build; browser walkthrough.

## Comments
