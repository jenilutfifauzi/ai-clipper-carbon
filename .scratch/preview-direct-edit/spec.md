# Edit the hook and captions on the preview

Status: ready-for-agent
Created: 2026-10-15

## Problem Statement

The hook and the captions are only drawn on the preview: they can't be touched. Their place is a Position (Top, Middle, Bottom or Custom with a height slider) in the clip editor, the hook's words are typed in the Hook tab, and the captions' words are corrected in the Text tab. The Advanced Edit's inspector even says "Its words and look are changed in the clip editor." In CapCut I tap a text on the video, drag it where I want it, pull its corner to make it bigger, and double-tap it to retype it.

## Solution

On the preview of the Advanced Edit and of the clip editor, the hook and the captions can be:
- **selected** with a click (the Advanced Edit's inspector shows the selected one);
- **dragged anywhere** (x and y), snapping to the frame's centre lines and the safe area's edges (Alt held: no snapping), with guide lines while snapped;
- **nudged** with the arrow keys (8 px, Shift 40 px);
- **resized** from a corner, which sets their Style's size;
- **retyped** in place with a double-click (or Enter while selected): the hook's text (Cmd/Ctrl+B for Emphasis), its Kicker, or the words of the caption line on screen (saved as Word Edits).

Text Layers get the same handles (move, nudge, snap). Caption Style is one for every caption, so moving or resizing a caption moves or resizes them all, as CapCut's "apply to all".

## User Stories

1. As a clipper, I want to drag the hook anywhere on the preview, so that it sits where the shot leaves room.
2. As a clipper, I want to drag the captions anywhere on the preview, so that they don't cover a face or a product.
3. As a clipper, I want the hook and captions to snap to the centre and the safe area, so that they line up without fiddling.
4. As a clipper, I want to nudge a selected hook or caption with the arrow keys, so that I can place it exactly.
5. As a clipper, I want to pull a corner to make the hook or captions bigger or smaller, so that I size them by eye.
6. As a clipper, I want to double-click the hook to retype it, so that I don't leave the preview to fix a word.
7. As a clipper, I want to double-click the Kicker to retype it.
8. As a clipper, I want to double-click a caption line to correct its words, so that a transcription mistake is fixed where I see it.
9. As a clipper, I want every one of these changes undone and redone in the Advanced Edit.
10. As a clipper, I want the render to put the hook and captions exactly where the preview shows them.

## Implementation Decisions

- **Style:** `HookStyle.x` (the box's centre) and `CaptionStyle.x` (each line's centre), 0–1080, default 540, like `WatermarkStyle.x`. They apply at every Position; a drag sets Position Custom with x and y. Choosing Top, Middle, Bottom or Auto puts x back at 540.
- **Planner:** the hook's area is centred on x, kept in the frame; its boxes, lines, Kicker and Quote Mark move with it. A caption line's area keeps its width (which sets the line's size) and is centred on x, moved in so that the line as set (with its outline) stays in the frame. At x 540 the plan is as before.
- **ADR-0001 holds:** the frontend sends x, y and size; the planner places. The preview draws a drag, a resize or a retyping in progress until the next plan comes back, as it does for the Watermark and Text Layers.
- **Frontend:** one module (`editor/StageEdit.tsx`) holds the gestures for every movable item on the stage: pointer capture, output-pixel points, the held offset, one undo group per gesture, nudging, corner resize, snapping and guides, and the selection frame.
- **Advanced Edit:** `AdvancedEdits` gains `hook_text`, `hook_kicker`, `style_overrides` and `word_edits`, so they are undone and saved with the rest. `Picked` gains `{ kind: "captions" }`.
- **Clip editor:** the preview's handles write through `useStyleDraft`'s `setMany` and the Candidate's save. They are off on the Watermark tab, where the Watermark is dragged.
- **Caption retyping:** the line's Words are matched to the Preview Plan's Words by time. Typed words replace them one for one; extra typed words join the last Word; Words left over are removed (empty text).

## Testing Decisions

- Seam B (pure planner): x moves the hook and captions and is kept in the frame; x 540 gives the old plan.
- Seam A (HTTP): overrides with x pass PATCH and preview-plan.
- Frontend: no test runner. `npm run typecheck`, `npm run build`, and a browser walkthrough of each gesture in both editors and on a phone-width window.

## Out of Scope

- Rotation, per-caption positions (every caption shares Caption Style), keyframes.
- Dragging the Watermark in the Advanced Edit.

## Further Notes

- Builds on `.scratch/advanced-edit/` and `.scratch/hook-styles/`.
