# 09: Layout per Scene

**Parent spec:** `spec.md` in this feature folder (user story 24; "Layout per Scene").

**What to build:**
- **Candidate:** gains `layout_overrides: list[LayoutOverride(at, layout)]`.
- **Planner:** uses the override for the merged Scene that holds `at`.
- **Timeline:** a Scenes track coloured by Layout, with a popover to set one Scene's Layout (Auto clears the override), and "Analyse scenes" (`prepare`) when not analysed.

**Blocked by:** 03, 08.

**Status:** done

- [x] Seam B:
  - an override changes only its Scene;
  - it works with the Candidate's Layout set;
  - an override outside the clip does nothing;
  - captions move with a changed Scene's Layout.
- [x] Seam A: a render with one Scene overridden to Blur.

## Comments

**2026-10-14: done.** `make test`: 297 passed (3 new Seam B tests, 1 Seam A test). `npm run typecheck` and `npm run build` pass.

**Changes from the plan:**
- **The Scene's Layout is chosen in an inline panel under the timeline, not a popover.** The timeline scrolls horizontally and would clip one; the inline panel is simpler and as reachable by keyboard. `Popover.tsx` (ticket 05) wasn't needed.
- **An override of Auto chooses that Scene's Layout by its faces**, even where the Candidate's Layout is forced. "Clip's" removes the override.

Built:
- **Overrides.** `LayoutOverride(at, layout)` and `Candidate.layout_overrides`. A PATCH replaces the list (at most 200) and marks the Candidate edited.
- **Planner.** Each merged Scene takes the last override whose time it holds (a time at the Clip's end counts for the last Scene). `candidate_plan` shifts the overrides to the Clip's timeline. Captions follow the Scene's new Layout (seam or lower third).
- **`editor/ScenesTrack.tsx`:**
  - The plan's Scenes on the timeline, coloured by Layout (Track orange, Split blue, Blur grey). An overridden Scene shows a dot and "changed" in its label.
  - "Find scenes and faces" appears while the plan is unanalysed (`prepare`).
  - `SceneLayoutPicker` offers Clip's, Auto, Track, Split or Blur for the picked Scene. A new override is keyed at the Scene's middle.

**Browser check** (3444ea04, 8 Scenes, scratch clone):
- Picking Scene 1 and choosing Blur saved `[{at: 1659.87, layout: "blur"}]`, and the track read "Scene 1, Blur, changed".
- The preview at 2 s showed the wide shot over the blurred background, with the caption moved from the seam to the lower third.
