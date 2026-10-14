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

**Status:** done

- [x] Text Layers drag, nudge and snap in the Advanced Edit; undo takes back one drag at a time.

## Comments

**2026-10-15: done.** `npm run typecheck` and `npm run build` pass.

Built: `editor/StageEdit.tsx`. `useStageEdit(plan, stage, items, selected, onSelect)` takes `StageItem`s (an id, a label, where and when each is drawn, an optional size range, an optional vertical range for its middle, `onPlace`, `onEdit`). It returns `transform(id, area)` for the drawing and `StageHandles` for the handles. Inside: pointer capture, output-pixel points, the held offset (until a plan made after the last change comes), one undo group per gesture, arrow nudges, corner resize, snapping with guide lines (Alt: none), and double-tap or Enter to edit. Text Layers use it in place of `useTextDrag`/`TextHandles`, and gain nudging, snapping and corner resize (`size`, 16–320).

**Checks:** Browser (scratch clone, test server on :8010): the hook snapped to the safe area's bottom with the guide drawn; arrow keys nudge.

**2026-10-15: after review.**
- A press becomes a drag only once the pointer goes 4 CSS px. Before, a tap's jitter set Position Custom and stopped a double-tap.
- **Change from the plan:** snapping reaches 6 CSS px on screen, not 12 output px. That is about 18 output px on a phone-sized frame and about 25 on the Advanced Edit's desktop player, so a guide is as easy to hit at any frame size.
- The safe area's top and bottom are defined once (`SAFE_TOP`, `SAFE_BOTTOM` in `StageEdit.tsx`).

Checked: a press with 1–2 px of jitter left the hook's overrides as they were.
