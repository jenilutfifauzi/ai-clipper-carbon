# 03: Select and move the hook and the captions

**Parent spec:** `spec.md` in this feature folder (user stories 1, 2, 3, 4, 9; "Advanced Edit", "Clip editor").

**What to build:**
- `ClipPreview` takes hook and caption controls. A handle sits over the hook's area and the caption line on screen while they show; the selected hook is shown whole while paused.
- A drag, nudge or snap writes `{position: "custom", x, y}` into the hook's or the captions' Style Overrides (hook y: the box's top; caption y: the line's centre). Every caption moves together while held.
- **Advanced Edit:** `AdvancedEdits` gains `hook_text`, `hook_kicker`, `style_overrides`, `word_edits`; `Picked` gains captions. The inspector's hook and captions panels say how to edit on the preview, and have "Reset position".
- **Clip editor:** the handles write through `useStyleDraft`; off on the Watermark tab.

**Blocked by:** 01, 02.

**Status:** done

- [x] Browser: drag the hook and captions in both editors; undo/redo in the Advanced Edit; reload keeps them.

## Comments

**2026-10-15: done.** `npm run typecheck` and `npm run build` pass.

Built:
- `ClipPreview` takes `stage: StageControls`: ids `"hook"`, `"captions"`, `"text:<id>"`. A caption line's handle is its letters as set, padded by 12 px (measured like the highlight box). The hook's middle stays in the safe area (232–1536), and a caption line's middle stays 100 px inside it, as the planner keeps them, so a drop never jumps.
- `editor/placing.ts`: `placedFields` / `placedOverrides` (position Custom, x, y, size) and `unplacedOverrides` / `isPlaced` for "Reset position".
- **Advanced Edit:** `AdvancedEdits` gains `hook_text`, `hook_kicker`, `style_overrides`, `word_edits`. `Picked` gains captions, chosen on the preview or by a click on the Captions track (which now seeks 50 ms into the line, so that it shows). The inspector's Hook and Captions panels hold a one-sentence hint (the rest in an InfoTip) and "Reset position".
- **Clip editor:** the handles write through `useStyleDraft`'s `setMany`, and selecting the hook or the captions opens its tab. They are off on the Watermark tab.

**Checks:** Browser (scratch clone of Job c37ac3bbb8ad, candidate 1e4e0e73):
- Advanced Edit: the hook was dragged, saved as `{position: custom, x: 288, y: 1307}`, and undone. The captions were dragged up and right, saved as `{position: custom, x: 715, y: 578}`, with every line moved and the line kept in the frame.
- Clip editor: the hook was dragged, saved as `{x: 423, y: 767}`, and the Hook tab opened.
