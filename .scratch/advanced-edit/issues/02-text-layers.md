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

**Status:** ready-for-agent

- [ ] A Candidate without Text Layers plans and renders byte for byte as before.
- [ ] Seam B: placement, fitting, clamping to the Clip, and animations in the plan.
- [ ] Seam A: a Text Layer burned in where and when the plan puts it (pixel colour at two times).
- [ ] Trimming the Clip leaves layers at the same Timeline time.
- [ ] Undoable; typecheck and build; browser walkthrough on desktop and phone.

## Comments
