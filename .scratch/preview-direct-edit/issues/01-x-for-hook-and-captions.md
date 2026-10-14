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
- **Styles:** `HookStyle.x` and `CaptionStyle.x` (`Width`, 0–1080, default 540).
- **Planner:** `_hook` moves the whole hook (area, boxes, anchors, Kicker, Quote Mark) by `x - 540`, no further than the frame's edges. `_caption_placed` centres each caption line's area on x, or as near as keeps the line as set (with its outline) in the frame. At 540 nothing moves.
- **Frontend types:** `x` on `CaptionStyle` and `HookStyle`.

**Change from the plan:** the hook's x is how far its lines' middle is moved from the frame's middle, so that a hook whose area grows to the left for a Quote Mark still moves by exactly what was dragged.

**Checks:** Seam B (`test_planner.py`, 3 new tests), Seam A (`test_review.py`: PATCH takes x and refuses 1081; `test_render.py`: a draft with x places the hook and captions).
