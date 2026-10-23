# 04: Preview header and the deck Transport

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- The player section becomes a `panel` with a header: "Preview" left, the output size and fps (e.g. `1080 × 1920 · 30 fps`, from the Canvas Aspect / export preset) centred, the AspectPicker right.
- A deck variant of `Transport` (`editor/ClipPreview.tsx`), Advanced Edit only: timecode box (`t / duration`) left; Go to start, Step back, Play/Pause, Step forward, Go to end centred; Compare, Hold Original, Take, Rate, Loop, Fullscreen right. No position slider (desktop and phone). The clip editor's Transport is unchanged.

**Blocked by:** 01

**Status:** done

- [x] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.

## Comments

- The desktop player section is a `panel` with `PreviewHeader` (Chrome.tsx): "Preview" | `previewFormat(canvas, fps)` (the Canvas in output pixels and the plan's fps, e.g. `1080 × 1920 · 30 fps`) | the AspectPicker. The size comes from the Canvas, not the export preset's resolution (the Render Plan is in Canvas pixels; the preset scales only at render).
- New `editor/DeckTransport.tsx`: `DeckTransport` (timecode box left; `before` Play `after` centred; `tools` right; a container query puts the buttons on their own row in a narrow player), plus `LoopButton` and `RateMenu` moved out of `ClipPreview.tsx` (the slider Transport uses them unchanged). `ClipPreview` takes an opt-in `deck={{ before, after }}`; the clip editor doesn't pass it and keeps its slider.
- `DeckButtons` (Chrome.tsx) replaces `FrameStep`: Go to start (Home) + One frame back (←) / One frame forward (→) + Go to end (End), via the existing `start`/`end`/`step-*` commands. Desktop tools: Compare, Hold Original, Take, Rate, Loop, Fullscreen. The phone also gets the deck (ticket 07 finishes its panel look).
- New `deckTransport.test.tsx` (no range input, order, button keys, header format). Ran with aspectPicker, compareRender and exportButton; `tsc --noEmit` clean.
