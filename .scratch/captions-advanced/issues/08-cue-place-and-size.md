# 08: A Cue's own place and size

**Parent spec:** `../spec.md` (Domain and model: `CueEdit.x`, `y`, `scale`; Planning Cues: place and size; Advanced Edit: Preview); user stories 27–30, 37 (position).

**What to build:** the owner moves one caption off a face, or makes one key caption bigger, without touching the others.

**Model:** Cue Edits gain `x`, `y` (output px, as the Caption Style's custom position) and `scale` (bounded, over the Caption Style's size).

**Planning:**
- `x` and `y` place that Cue as a custom position does, kept in the frame. They override the Caption Style's position for it alone.
- `scale` multiplies the Caption Style's size before shrink-to-fit, so the Cue follows later changes to the size.

**Preview:**
- A picked Cue shows Grips: move and corners only, no edges and no rotation. They write its Cue Edit, one drag per undo step, with Smart Guides.
- Clicking a Cue on the preview picks it.
- With the captions picked, the Grips write the Caption Style Override, as today.
- The inspector of a picked Cue has its place and scale, with Reset position.

**Blocked by:** 07.

**Status:** ready-for-agent

- [ ] Planner: `x` and `y` move one Cue only and stay in the frame. `scale` 1.5 makes it 1.5× the style's size, and follows a style size change.
- [ ] Render (real ffmpeg): the moved Cue's ink is at its place in a frame, and the next Cue's is at the style's position.
- [ ] vitest: Grips on a picked Cue write `x`, `y` and `scale`. On the picked captions they write the Style Override. Reset position clears them.
- [ ] The MCP accepts `x`, `y` and `scale` in `cue_edits`.
- [ ] Browser walkthrough: drag and scale one Cue, then all captions. Smart Guides show.
