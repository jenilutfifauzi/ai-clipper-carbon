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

**Status:** ready-for-agent

- [ ] Seam B:
  - [ ] a Manual override plans a Background panel plus a `Picture` and needs no faces;
  - [ ] a Candidate Layout of Manual applies to Scenes without an override;
  - [ ] a Track Scene's `framing` reproduces its first crop within a pixel;
  - [ ] Blur gives scale 1, and Split a centred cover.
- [ ] Seam A:
  - [ ] a Manual override without a Framing is refused;
  - [ ] a Manual Scene at scale 1 over a colour shows the colour above and below the Source;
  - [ ] the dry run lists the Scenes' Layouts and framings.
- [ ] Seam C: a remote change to one Manual override and a local change to another both survive.
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments
