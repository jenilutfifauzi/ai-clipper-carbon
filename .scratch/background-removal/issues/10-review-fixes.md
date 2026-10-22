# 10: Review fixes: the plan carries the Matte's numbers, and the cut is the same in the preview and the render

**Parent spec:** `../spec.md`; ADR 0001, ADR 0015. From the branch's code review (2026-10-22).

**What to build:** the fixes the review found. After them, the preview and the render agree on every cut-out item, and no Matte number is copied by hand into the frontend.

- **ADR 0001:** the frontend hardcodes `MATTE_SIDE = 1280`, `MEDIA_FPS = 30` and `MATTE_PIECE_SECS = 10`, copied from the backend. The Render/Preview Plan must carry what the preview needs instead: the Matte's frame rate per item (the Source's, or the media item's real rate), its size, and its piece length.
- **Media frame rate:** Media Library Mattes are read at 30 fps. Check whether every Media Library video really is normalized to 30 fps on import (`media.py`). Either way, use the item's own rate, from the plan.
- **One fallback:** `matte_pieces` silently falls back to 30 fps when fps is 0, but `matte_frame` doesn't. Make the two agree (one rule, in one place).
- **Keyed pictures:** a cut-out Segment whose picture has Keyframes (a keyed Manual Scene or media Segment) is refused only at render, while the preview cuts it. Refuse it on save, naming the item, so the owner learns at once. The preview and the render then never disagree. If drawing it turns out to be cheap, drawing it in the render is also acceptable.
- **Feather scale:** the planner scales the feather by the Manual Framing only when the Candidate's own Layout is Manual. A Segment in a Manual Layout Override must use that override's Framing scale. A Track or Split override of a Manual Candidate must not use the Manual scale.
- **Sweep:** `sweep_unused` sweeps only media items still referenced by the Job's states. Matte pieces of a media item that no Candidate (nor its Revision History) uses any more must be swept too. Keep the rule that pieces an item still needs for another Job are kept, as for Retimed copies.
- **Drafts ask for the Matte:** a draft that turns Background removal on, or changes a range, asks for the pieces, as a save does (the spec's "saves and drafts").
- **Spec:** `../spec.md` still says CoreML runs ahead of the CPU. Bring it in line with ADR 0015 (CPU, until 13 lands).

**Blocked by:** 01–09

**Status:** ready-for-agent

- [ ] The preview reads every Matte number from the plan; no backend constant is duplicated in the frontend (the shared `matte_frames.json` fixture stays).
- [ ] A media item at another frame rate (e.g. 25 fps) is cut on the right frames in the render and the preview mapping (Seam A + vitest).
- [ ] A keyed cut-out picture is refused on save with a message naming it (API and MCP), or drawn correctly in the render.
- [ ] The feather of a Segment in a Manual Layout Override is scaled by its Framing; a Track override in a Manual Candidate isn't (Seam B).
- [ ] An unreferenced media item's Matte pieces are swept; pieces another Job needs are kept.
- [ ] A draft with Background removal on asks for the pieces.
- [ ] The spec matches ADR 0015.
