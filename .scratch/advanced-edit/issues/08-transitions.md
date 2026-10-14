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

**Status:** done

- [x] Seam B: the overlap shortens the Clip; clamping; dropped when its join disappears.
- [x] Seam A: `xfade` render has the expected duration; a frame mid-transition differs from both ends.
- [x] Typecheck and build; browser walkthrough.

## Comments

**2026-10-14: done.**

**Checks:**
- `tests/test_transitions.py`:
  - Seam B: the overlap shortens the Clip; captions split at the Transition's middle; clamped to half the shorter Segment.
  - Seam A: saved, validated, and dropped with their join.
  - Seam A: a crossfade render is the planned length, with a frame in its middle between the two pieces' brightness.
- `npm run build`.
- Browser:
  - A Fade put on a join by clicking its diamond and the kind (saved; the plan 0.5 s shorter).
  - While playing through it, the held last picture fades over 0.5 s.

**Changes from the plan:**
- The Job's history record is renamed `StatusChange`.
- Captions are moved into the planner's pieces: each Segment brings its own Words and Word Edits, so the planner can place them after the overlaps.
- Each Segment's picture is brought to the Clip's frame rate and time base before an `xfade`, which needs them alike.
- The preview plays one piece at a time. At the handover it copies the outgoing picture and animates it away as the kind does. The timing is exact and the look approximate (the outgoing piece is held still).
- Kinds are put on a join by a click on its diamond and then on a kind, or by dragging a kind onto the diamond.

**2026-10-14: review fixes.** **Preview:** the outgoing Segment keeps playing through the overlap on a playback of its own (its panels, or its video), its sound fading out, taken away as the kind does it. This replaces the held picture.

**Planning:** a Transition next to a Media Library video that is gone is left out (`tests/test_advanced_rules.py`).
