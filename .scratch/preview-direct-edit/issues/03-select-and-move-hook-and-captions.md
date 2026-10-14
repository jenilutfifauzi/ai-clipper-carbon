# 03: Select and move the hook and the captions

**Parent spec:** `spec.md` in this feature folder (user stories 1, 2, 3, 4, 9; "Advanced Edit", "Clip editor").

**What to build:**
- `ClipPreview` takes hook and caption controls. A handle sits over the hook's area and the caption line on screen while they show; the selected hook is shown whole while paused.
- A drag, nudge or snap writes `{position: "custom", x, y}` into the hook's or the captions' Style Overrides (hook y: the box's top; caption y: the line's centre). Every caption moves together while held.
- **Advanced Edit:** `AdvancedEdits` gains `hook_text`, `hook_kicker`, `style_overrides`, `word_edits`; `Picked` gains captions. The inspector's hook and captions panels say how to edit on the preview, and have "Reset position".
- **Clip editor:** the handles write through `useStyleDraft`; off on the Watermark tab.

**Blocked by:** 01, 02.

**Status:** ready-for-agent

- [ ] Browser: drag the hook and captions in both editors; undo/redo in the Advanced Edit; reload keeps them.

## Comments
