# 12: Keyframes on Text Layers

**Parent spec:** `spec.md` (Solution "Transform and Keyframes"; Implementation Decisions "Planner (layout)": picture scale, "Renderer", "Preview and editor"); docs/adr/0008-keyframes-for-pictures-and-sound.md.

**What to build:** a Text Layer's position, scale, rotation and opacity can be keyed with Eases, as an Overlay's are.

- **Model and validation:** a Text Layer gains `keyframes` for position, scale, rotation and opacity, with ADR 0008's rules. Trimming, splitting and the Magnetic timeline keep its motion where it was, as for Overlays.
- **The picture's scale** is the largest the layer reaches: its constant or keyed scale, times Pop's peak. It is capped at 4096 px on its longest side.
- **Renderer and preview:** they key the picture as they key an Overlay's.
  - Fade, Pop and Slide are stacked on the keyed values: opacity multiplied, scale multiplied, y offset added.
- **Editor:** Text Layers' rows in the Keyframes pane (Dopesheet and Curves), keyframe buttons by the Transform's fields, and Auto-key from stage grips and fields.
- **MCP:** keyframes can be set and merged as an Overlay's. The dry run lists them.

**Blocked by:** 05.

**Status:** done

- [x] A Text Layer keyed from x=200 to x=880 over 1 s with Ease out is at the eased x at given frames of the render.
- [x] Keyed rotation and opacity show in rendered frames as planned.
- [x] Pop on a layer keyed to scale 2 peaks at its picture's full resolution, and stays sharp.
- [x] Splitting a keyed Text Layer keeps each half's motion on the same moments.
- [x] Moving a keyed layer on stage writes a Keyframe at the playhead (Auto-key). The Dopesheet retimes it.
- [x] A keyed Text Layer set through MCP renders the same as one keyed in the editor.

## Comments

**2026-10-17 (agent):** Built.
- **Model** (`backend/app/candidates.py`): a Text Layer has `keys`, as an Overlay has (ADR 0008 names the field `keys`; the ticket's "keyframes" is the concept). Only x, y, scale, rotation and opacity, checked by `checked_keys` against its `secs` (so the MCP server refuses a length that strands one, and a volume Keyframe). `Keys` is now a `type` alias: the tools' schemas define it once and refer to it, which keeps them under the 65 000-byte budget (64 322 with this ticket; main was 64 885).
- **Planner** (`backend/app/planner.py`): `text_event` gives the picture its motion with `with_motion` (now taking the drawn size at scale 1, the layout's), so the preview and the renderer sample it with `picture_at`. `reached_scale` is the largest scale the layer is drawn at: its constant scale, or its largest scale Keyframe while keyed (they replace it), times `POP_PEAK` (1: Pop grows to full size, never past it). The picture is made at the next of `TEXT_PICTURE_SCALES` up from that, capped at 4096 px as before. `text_bounds_at` is the area's box at a time, for the dry run.
- **Renderer** (`backend/app/renderer.py`): a keyed Text Layer goes through the frame process, as an animated one did. `text_at` samples its Keyframes first (`picture_at`), then multiplies opacity and scale and adds the drop of Fade, Pop and Slide.
- **MCP:** `edit_candidate` and `merge_candidate_items` take `keys` on Text Layers, merged by property as an Overlay's. The dry run's `text_layers` give `keys` (Timeline time, Eases by name) and `bounds_at_keys` (the area's box at each). The instructions name Text Layers among the keyed items.
- **Editor:** `keying.ts` has a `text` kind (its Track, its Transform fields as rows, no sound), so K, [ and ], the ruler's diamonds, the Keyframes pane (Dopesheet and Curves) and the Ease sheet work on a Text Layer picked alone. `TextTransformFields` now takes the layer: in the Advanced Edit it shows the Transform at the playhead, with a ‹ ◆ › per field and auto-key, as `OverlayTransform`. Its Reset (`resetTextLayer`) clears the scale, rotation and opacity Keyframes and keeps the centre's. Split, trim, ripple, the Magnetic timeline, group moves and the Clipboard already re-anchored any item with `keys`.
- **Stage and preview:** `StageControls.texts` gains `transformOf` and a time on `onTransform`, as the Overlays' have: a keyed layer is gripped where it is at the playhead (`textEventAt` in `textStage.ts`), and a gesture writes Keyframes there (`writeItemTransform`). `TextLayerView` draws `placedText` (Keyframes, then the animations, as `text_at`), and a keyed one is written to its SVG elements on every frame of the playback, as `PicturePanel` does. Retyping a keyed layer opens the field where it is at the playhead.
- **Decisions:**
  - New Text Layers and Text Presets carry no Keyframes: `TextLook` leaves `keys` out and `newTextLayer` gives `{}`.
  - The multi-pick text inspector has no keyed note (the PickSummary's note is for mixed picks); a keyed Text Layer is edited alone.
- **Tests:** `backend/tests/test_keyed_text_layers.py` (model, planner, stacking, one Seam A render for the eased x, the turn and fade, and Pop at scale 2 against the size ×2; MCP merge, refusals, dry run and the editor's plan). Frontend: `advanced/keyedTextLayers.test.ts`, and new cases in `editor/textStage.test.ts` and `editor/textPicture.test.ts`.
- **Left:** not checked by hand in a browser. The phone's Transform sheet still covers Overlays and Segments only; a Text Layer's Transform and its Keyframe buttons are in its inspector.
