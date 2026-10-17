# 05: Scale, rotation and opacity of a Text Layer on stage

**Parent spec:** `spec.md` (Solution "Transform and Keyframes", "On stage"; Implementation Decisions "Preview and editor"); docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md.

**What to build:** a Text Layer is handled on stage as an Overlay is.

- Corner grips set `transform.scale`, and the rotate grip `transform.rotation`, with the Overlay's snapping and guides. The centre stays on the frame, and the picture may go past its edges.
- The inspector shows the Transform's position, scale, rotation and opacity beside the Text Style. The font size stays in the Text Style.
- Scaling, turning and fading don't request a new picture. The picture is re-made at a larger scale only when the scale grows past what it was rasterised at.
- The dry run lists the bounds once turned and scaled.

**Blocked by:** 02.

**Status:** done

- [x] A rotated Text Layer's plate corners land in a rendered frame where the plan's turned bounds say.
- [x] A layer at scale 3 is as sharp in the render as one at size ×3 (its picture was made at scale 3).
- [x] At opacity 0.5, the text and the plate are half transparent over the video.
- [x] Dragging a corner grip scales the layer without rewrapping it. The rotate grip turns it. Each is one undo step.
- [x] Moving, turning or fading in the preview makes no picture request.

## Comments

**2026-10-17 (agent):** Built.
- **Model** (`backend/app/candidates.py`): `_check_drawn` no longer refuses a Transform's scale, rotation or opacity. It still refuses tracking, wrap width, fixed height and Strips (tickets 03/04).
- **Planner** (`backend/app/planner.py`, `text_event`): the keep-inside-the-frame clamp is gone. The area is centred on the Transform's centre, which the Transform keeps on the frame, so the picture may go past the edges.
- **When a picture is re-made:** the picture's raster scale is the Transform's scale rounded up to the next of `TEXT_PICTURE_SCALES` (1, 1.5, 2, 3, 4, 6, 8), and never below 1. Scaling within one step keeps the same file. Only a scale past the step makes a new, sharper one. `TextLayout.look` (a hash of the layout at scale 1) is sent as `TextEvent.look`. The preview (`editor/textPicture.ts`) keeps the largest picture of each look it has loaded. It draws that one at the wanted size, so scaling down fetches nothing. Scaling up past it fetches the larger picture and draws the old one enlarged until the new one arrives.
  - Decision: the plan stays pure (it never looks at which pictures exist on disk). So a plan scaled down across a step still names, and `preview_plan` still makes, the smaller picture (about 0.15 s on the backend). The browser never asks for it while it holds a larger one of the same look.
- **Stored Clips:** the old planner moved a layer whose area crossed an edge back inside the frame. `migration.migrated_text_layer` now centres such a layer where the planner drew it (`_drawn_where_it_was`), so the 9 golden layers of ticket 01 (the "corner" one included) still plan and look the same. Layers already saved in the Text Style shape (since ticket 01 merged) can't be told apart from new ones. One whose area crosses an edge now renders past it.
- **Stage** (`editor/textStage.ts`, `StageEdit.tsx`, `ClipPreview.tsx`): a Text Layer is a `StagePicture` now, no longer a `StageItem`. Its Grips sit on its area (not the ink room around its picture), with `fitted` = the area at scale 1. It uses a new `GripSet` `"corners-rotate"`: corners scale, the rotate handle turns, and there are no edge grips (side and top/bottom grips belong to ticket 03). It snaps, shows Smart Guides, pinches and twists on a phone, and is saved once on release (one undo step), all as an Overlay. While held, `heldTextEvent` draws the same picture file placed, scaled and turned from the gesture. A double-click, double-tap or Enter retypes it (`StagePicture.onEdit`), replacing Crop mode. The inline field is scaled and turned with the layer. `StageControls.texts` is now `{ onTransform }`, and `onPlace` covers only the hook and captions. In the Advanced Edit, a scale or turn changes only `transform`, and a move of several picked layers moves them together, as before.
- **Inspector** (`advanced/TransformFields.tsx` `TextTransformFields`, in `TextLayerFields` after Look): X, Y, Scale %, Rotation, Opacity, and Reset (scale 1, rotation 0, opacity 1, position kept). The font size stays in the Text Style. The multi-pick inspector has no Transform fields, since places stay each layer's own.
- **MCP:** the instructions describe scale, rotation and opacity. The dry run's `bounds` are the area once scaled and turned. `test_mcp` checks a merge of scale and rotation and the turned bounds.
- **Tests:** `test_text_layers.py` (centre past the edges, scale and turn keep the layout, raster steps and `look`, the migration's corner layer). `test_text_pictures.py` has one Seam A render that checks turned plate corners against the plan, half opacity of plate and letters, and scale 3 against size ×3 (a picture made at scale 1 has about twice the edge pixels, so the test can tell them apart). Frontend: `textPicture.test.ts`, `textStage.test.ts`, `stagePicture.test.ts`.
- **Left:** not checked by hand in a browser (pure functions, types and the backend are tested). Text Layers aren't Smart Guide targets for other pictures, as before. A Text Layer's stage handle is now among the pictures, under the caption line's handle where the two overlap; before, it was over it.
