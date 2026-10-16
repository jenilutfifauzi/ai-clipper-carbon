# 04: The Manual Layout

**Parent spec:** `spec.md` (user stories 26–27, 29–36, 54, 56; Implementation Decisions "Model", "Planner", "Merging and the Clipboard", "MCP"); ADR 0007.

**What to build:** Manual frames the Source by hand with a Framing, for one Scene (a Layout Override) or for the whole Candidate. It is still, and face tracking is not run for it. This ticket covers the model, the plan, the render, the preview, the Advanced Edit inspector and MCP. Grips on it come in 05, and the clip editor in 09.

- **Model.**
  - `Layout.MANUAL`.
  - `LayoutOverride.framing`, required for Manual and refused otherwise.
  - `Candidate.framing`, with the same rule against `Candidate.layout`.
- **Planner.**
  - `_framed`/`_choose` honour Manual, and Auto never picks it.
  - A Manual Scene skips `_follow` and needs no faces. It plans a Background panel (a blurred cover of the Source, or a colour) plus a `Picture` of the Source.
  - `SceneLayout.MANUAL`.
- **Every `ScenePlan` carries `framing`,** the Framing of its first frame:
  - Track: its first crop point as a Transform;
  - Blur: scale 1 over blur;
  - Split: a centred cover;
  - Manual and media: their own.
- **Renderer and preview** reuse 03's Background and `_picture` and `PicturePanel` for Source pictures.
- **Advanced Edit inspector:**
  - Manual in the Layout choices;
  - "Reframe by hand" on a Source Segment, which makes the Scene under the playhead Manual by copying `ScenePlan.framing` into a new override;
  - the Transform section, the Crop numbers and the Background for a Manual Scene;
  - "Only this Scene" and "Use for all Scenes".
- **Merge and Clipboard.**
  - Layout Overrides keep their Framing through the client merge.
  - A pasted Source Segment brings the overrides of its range, with their Framing.
- **MCP.** `_plan_view` lists each Scene's `layout` and `framing`. The nested merge works on `framing`.

**Blocked by:** 03

**Status:** done

- [x] Seam B:
  - [x] a Manual override plans a Background panel plus a `Picture` and needs no faces;
  - [x] a Candidate Layout of Manual applies to Scenes without an override;
  - [x] a Track Scene's `framing` reproduces its first crop within a pixel;
  - [x] Blur gives scale 1, and Split a centred cover.
- [x] Seam A:
  - [x] a Manual override without a Framing is refused;
  - [x] a Manual Scene at scale 1 over a colour shows the colour above and below the Source;
  - [x] the dry run lists the Scenes' Layouts and framings.
- [x] Seam C: a remote change to one Manual override and a local change to another both survive.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified, at each seam test first (`backend/tests/test_manual_layout.py`; `frontend/src/pages/job/editor/manual.test.ts`, `merge.test.ts`, `picture.test.ts`, `advanced/actions.test.ts`).

- **Model.** `Layout.MANUAL`; `LayoutOverride.framing` and `Candidate.framing` (`Framing | None`). `review.update` checks both (`_check_framing`): a Manual override or clip needs its Framing, any other refuses one (422, naming the framing). A PATCH's `framing` null leaves it, so a clip's Framing is dropped by itself when its Layout becomes another; an override's isn't (the agent sends `framing: null`, which the refusal says). `framing` is in `CandidateUpdate` (so in `edit_candidate` and Restore), `_look`, the "Layout" part of the Revision History, and `RenderedClip`. `MAX_SCALE` (8) is in `candidates.py`.
- **Planner.** `_framed` takes the Candidate's `framing`; a Scene whose override (or else the Candidate's Layout) is Manual is `framed_scene(..., SceneLayout.MANUAL, source.width, source.height, framing)`, before any faces are looked at, so it plans unanalysed too. `_choose` never sees Manual, and Auto never gives it. `ScenePlan.framing`: `framed_scene` carries its own (media and Manual); `_first_framing` gives Track `_showing(source, first crop box)`, Blur `Framing()`, Split a centred cover (`cover_scale`, at most 8); a portrait Source's passthrough gets scale 1 over black.
  - `_showing` is the Transform that covers the frame with a Source box. The centre is kept on the frame, so a Track crop near the Source's edge (a face more than about 300 px from the middle of a 16:9 Source) can't be reached by moving the picture alone: then the far side of the Source is cropped off, just enough to bring the centre back on the frame. Faces at 100, 400, 960, 1500 and 1820 px and none all draw their first crop within a pixel. Near the middle nothing is cropped.
- **Renderer.** Nothing new: `_scene` already hands any Scene with a picture to `_framed_scene`, which draws the Background and `_picture` of `on_frame(picture)` from the Segment's own frames. Docstrings say so.
- **Preview.** The Source decks draw a Manual Scene (ADR 0006): `slotView(scene, slot)` (`picture.ts`) gives slot 0 the Background (the blurred cover panel, or its colour) and slot 1 the picture. `PanelView` takes `picture` and `colour` and always renders the same `SlotVideo` elements, so the video stays mounted between Scenes; a picture is placed by `pictureStyle`, as `PicturePanel` places one. `PreviewTransitions`' ghost uses it too. `sceneAt` moved from `ClipPreview.tsx` to `ScenesTrack.tsx` (beside `sourceTime` and `sceneOverride`) so pure modules can import it without the DOM.
- **Pure editor module** `frontend/src/pages/job/editor/manual.ts` (for 05 and 09 too): `sourceSceneAt(plan, index, count, time)` (the Scene under the playhead in Source Segment `index`); `sceneLayoutOverrides(overrides, plan, index, layout | "default")` (Manual copies `ScenePlan.framing`, at the Scene's middle in Source time); `reframed` ("Reframe by hand", "Only this Scene"); `forAllScenes` (the clip Manual with this Scene's Framing, its override removed); `withClipLayout` (the clip's Layout; Manual copies the Scene's Framing, another drops it); `framingSource(edits, plan, index)` → `{ framing, own }` (the override's, or the clip's when `own` is null; null for an automatic Scene); `withSceneFraming` (sets it where it comes from).
- **Advanced Edit inspector.** `AdvancedEdits` gained `layout` and `framing`, so they undo and merge like the rest. A Source Segment's inspector shows `advanced/SceneFields.tsx` for the Scene under the playhead (a hint when the playhead is on another Segment): "This Scene's layout" (the clip's, Auto, Track, Split, Blur, Manual) and "The clip's layout" selects; on an automatic Scene "Reframe by hand"; on a Manual one "This Scene" with "Use for all Scenes", or "All Scenes" with "Only this Scene", then `TransformFields` (with the Source's size for Fill) and `BackgroundFields`. History groups `layout:<at>:transform.<field>` for an override's Framing, `layout:clip:…` for the clip's.
- **Merge and Clipboard.** Nothing to change: Layout Overrides merge whole by `at` and are copied whole; tests now show a Manual override's Framing surviving both. `PART_OF.framing` is "Layout".
- **MCP.** `_plan_view` lists each Scene's `framing` beside its `layout`; the nested merge already worked on an override's `framing` (`{"at": …, "framing": {"transform": {"rotation": 90}}}` keeps the scale). The instructions get a paragraph on Manual.
- **Clip editor.** Unchanged but for types: its Layout pickers keep their four choices (Manual is 09's), `LAYOUT_HINTS` and the Scenes track name Manual. Choosing another Layout there drops a Manual clip's Framing (backend).

Choices: a Track Scene's Framing crops the Source where the centre clamp leaves no other way, rather than letting the centre leave the frame. "Use for all Scenes" removes this Scene's own override, so it then follows the clip's. The Advanced Edit also offers the clip's Layout (with Manual), since "Use for all Scenes" would otherwise leave no way back there. A portrait Source stays passed through; Manual isn't offered for it.

Not tried: no browser walkthrough (Reframe by hand on a Track Scene and comparing with the render, a Manual Scene over a colour in the preview, Use for all Scenes, a Transition out of a Manual Scene, the inspector on a phone sheet).
