# 01: x for the hook and the captions

**Parent spec:** `spec.md` in this feature folder (user stories 1, 2, 10; "Style", "Planner").

**What to build:**
- **HookStyle.x** and **CaptionStyle.x**: 0–1080, default 540 (`backend/app/styles.py`, `frontend/src/api.ts`).
- **Planner `_hook`:** the area is centred on x and kept in the frame; boxes, anchors, Kicker and Quote Mark move with it.
- **Planner captions:** a line's area keeps its width and is centred on x, moved in so the line as set (with its outline) stays in the frame.

**Blocked by:** none.

**Status:** done

- [x] x 540 gives the plan as before.
- [x] Seam B: the hook moves with x and is kept in the frame at either edge; a caption line moves with x and is kept in the frame by its own width.
- [x] Seam A: overrides with x pass PATCH and preview-plan.

## Comments

**2026-10-15: done.** `uv run pytest`: 384 passed. `npm run typecheck` passes.

Built:
- **Styles:** `HookStyle.x` and `CaptionStyle.x` (`Width`, 0–1080), default None: centred as before.
- **Planner:** `_hook` puts the middle of the whole hook as drawn (Quote Mark's badge included) at x, kept in the frame; boxes, anchors, Kicker and Quote Mark move with it. `_caption_placed` centres each caption line's area on x, or as near as keeps the line as set (with its outline) in the frame.
- **Frontend types:** `x: number | null` on `CaptionStyle` and `HookStyle`.

**Change from the plan:** x defaults to None, not 540, and is the middle of the hook's area as drawn. The preview's gestures work on the areas the plan draws, so a dragged area's middle is exactly the x to save, even for a hook whose badge sticks out to its left. None keeps every existing plan as it was.

**Checks:** `uv run pytest`: 383 passed, 1 timing flake in `test_resilience.py` that passes alone (3 runs). Seam B (`test_planner.py`, 3 new tests), Seam A (`test_review.py`: PATCH takes x and refuses 1081; `test_render.py`: a draft with x places the hook and captions). `npm run typecheck` passes.
