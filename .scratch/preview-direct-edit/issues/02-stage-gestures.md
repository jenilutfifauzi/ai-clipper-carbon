# 02: One module for gestures on the stage

**Parent spec:** `spec.md` in this feature folder (user stories 3, 4; "Frontend").

**What to build:**
- `frontend/src/pages/job/editor/StageEdit.tsx`, from `useTextDrag` and `TextHandles` in `ClipPreview.tsx`:
  - pointer capture, points in output pixels, the held offset until the plan has it, one undo group per gesture;
  - arrow-key nudging (8 px, Shift 40 px);
  - corner resize (scale = pointer's distance from the centre over the distance when grabbed);
  - snapping of the centre to x 540 / y 960 and of the edges to the safe area (y 232, y 1536, x 950) within 12 output pixels, off while Alt is held, with guide lines while snapped;
  - a selection frame: dashed outline, corner handles with at least a 24 CSS px hit area, `touch-none`, focusable.
- Text Layers use it: the same drag as before, plus nudging and snapping.

**Blocked by:** none.

**Status:** ready-for-agent

- [ ] Text Layers drag, nudge and snap in the Advanced Edit; undo takes back one drag at a time.

## Comments
