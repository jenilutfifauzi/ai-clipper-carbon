# 09: Manual in the clip editor

**Parent spec:** `spec.md` (user story 37; Implementation Decisions "Clip editor"); ADR 0007.

**What to build:** in the clip editor, Manual joins the Layout choices for the Candidate and per Scene.
- Choosing it copies the plan's `ScenePlan.framing`.
- On the preview, a Manual Scene's picture can be dragged to pan and scaled from its corners, through 05's gesture module.
- There is no rotation, edge stretch, crop or Background here.

**Blocked by:** 04, 05

**Status:** done

- [ ] Walkthrough: choose Manual for one Scene and for the Candidate, pan and zoom, and compare with the render. The Advanced Edit shows the same Framing.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified, test first at each seam (`frontend/src/pages/job/editor/clipManual.test.ts`; `stagePicture.test.ts` for the Grip sets).

- **Pure module** `frontend/src/pages/job/editor/clipManual.ts` (the clip editor saves each change at once, so these give only the fields a change sets): `sourceSceneNear(plan, near)` (the Scene under the playhead when it shows the Source, else the first that does); `clipLayoutChange(edits, plan | null, near, layout)` → `{layout, framing}` through `withClipLayout` (Manual copies that Scene's `ScenePlan.framing`; another Layout sends `framing: null`; before a plan, Manual keeps the clip's Framing or `FITTED`, now exported from `manual.ts`); `pictureChange(edits, plan, source, transform)` → `{framing}` or `{layout_overrides}`, wherever `withPictureTransform` put it; null for anything but a Manual Scene.
- **Layout pickers.** `CandidateEditor`'s `LAYOUTS` and `ScenesTrack`'s `CHOICES` gain Manual. `SceneLayoutPicker`'s `onChange` now gives the choice (`Layout | "default"`), and `CandidateEditor` makes the overrides with `sceneLayoutOverrides` (Manual with the plan's Framing; another Layout's override has none, so a Manual one's Framing goes). The hints say how to pan and zoom.
- **Grips.** `GripSet` (`"all" | "corners"`) and `gripsIn` in `stagePicture.ts`; `StagePicture.grips` and `PictureTarget.grips` carry it, and `Grips` draws the corners only (no edge bars, no rotate handle or its line) for `"corners"`. Moves and corner scales still snap to 06's Smart Guides there.
- **The stage.** `CandidateEditor`'s `stage` has a `pictureAt` from `pictureSource` on the Candidate (`mainTrackOf` for an uncut clip), for a plan Scene that is Manual only, with corners-only Grips; a gesture saves `pictureChange` once on pointer up. Its pick is its own state (`pictureOn`), cleared when the hook or captions are picked.
- **Draft.** `candidateDraft` now sends `framing` too (the backend already took it via `CandidateUpdate`, and a missing one kept the saved one, so the preview was right before; now it is explicit).

Choices: a clip made Manual copies the Framing of the Scene under the playhead (as the Advanced Edit's "The clip's layout" does), not the Scene picked on the Scenes track. A portrait Source still passes through whatever the Layout, so its stage offers no picture (the plan's Scene isn't Manual).

Not tried: no browser walkthrough (Manual for a Scene and for the Candidate, pan and corner zoom against the render, the same Framing in the Advanced Edit).
