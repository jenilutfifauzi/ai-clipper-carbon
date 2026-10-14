# 02: Text Layers

**Parent spec:** `spec.md` in this feature folder (user stories 4–7).

**What to build:**
- **Model:**
  - `TextLayer` on the Candidate (`text_layers`), anchored to Timeline time.
  - `CandidateChange` and `CandidateUpdate` validate it: `secs` > 0, kept inside the Clip, and font names from the existing list.
- **Planner:** a `TextEvent` per layer, with its area, the font size after fitting to the frame, and its animations. It is drawn above the captions and below the hook.
- **Renderer:** one ASS style and event per layer, with fade, pop and slide_up done by `\fad`, `\t` and `\move`.
- **Workspace:**
  - The Text tab adds a layer at the playhead.
  - The Text track supports move, trim, select, duplicate and delete.
  - The inspector edits text, font, size, colour, outline, box, align, and in/out animation.
  - Layers can be dragged on the preview.
- **Clip editor:** its preview draws Text Layers, read-only.
- **Glossary:** add **Text Layer**.

**Blocked by:** 01.

**Status:** done

- [x] A Candidate without Text Layers plans and renders byte for byte as before.
- [x] Seam B: placement, fitting, clamping to the Clip, and animations in the plan.
- [x] Seam A: a Text Layer burned in where and when the plan puts it (pixel colour at two times).
- [x] Trimming the Clip leaves layers at the same Timeline time.
- [x] Undoable; typecheck and build; browser walkthrough on desktop and phone.

## Comments

**2026-10-14: done.**

**Checks:**
- `tests/test_text_layers.py`: Seam B (placement, lines and alignment, the box and shrinking, the time kept in the Clip, ASS layers and order) and Seam A (saving and validation through the API, kept through a trim, burned in by the real ffmpeg where and when planned).
- The planner, watermark, review and styles suites still pass.
- `npm run build`.
- Browser walkthrough on a copy of a real Job:
  - Added a Title and typed two lines.
  - Dragged it on the preview (saved at y 1167).
  - Split it at 1.52 s with Cmd+B, then undid the split.
  - On a phone, a tap selected it and the toolbar showed Split, Duplicate and Delete.

**Changes from the plan:**
- The animations are the hook's (`none | fade | pop | slide`), with the same field names, so that the renderer animates both with one set of helpers.
- Look presets were added to the Text tab: Text, Title, Label, Subtitle.
- Overlapping layers stack in lanes on the Text track.
- While paused, the selected layer is shown whole, even on a frame its animation hasn't reached, so that it can be seen while it is edited.
