# 02: Text Layers are rendered and previewed as pictures

**Parent spec:** `spec.md` (Implementation Decisions "Rasteriser", "Renderer", "Preview and editor"); docs/adr/0010-text-layers-are-rasterised-pictures.md.

**What to build:** a Text Layer is drawn once by libass onto a transparent picture, and that picture is what both the Clip and the preview show.

- **Prove the canvas first.** ffmpeg's `ass` filter with `alpha=1`, over a transparent `rgba` `color` source, should give clean straight alpha with antialiased edges. If it doesn't, recover alpha from a white-on-black and a black-on-white render (difference matting), still with libass.
- **The rasteriser:** it takes a Text Layer event's planned layout and style. It writes the ASS for it (each line at its planned anchor, the stroke as `\bord`, the plate as `\p1` drawings) and runs one ffmpeg into a PNG at the planned size, with a fonts directory holding just the Faces the layout needs.
  - Pictures are cached on disk by a hash of the layout and style, beside the other derived files, and swept with them (ADR 0005).
  - A render makes any missing picture before it starts.
- **The Render Plan:** a Text Layer's event carries its layout, its picture's size and hash, and its Transform planned as an Overlay's, with bounds once turned and scaled.
  - The picture's scale is the layer's Transform scale (keyed scale comes in ticket 12), capped at 4096 px on its longest side.
- **The renderer:** Text Layers leave the ASS script. Each one's picture enters the filter graph by the Overlay's image path, at the same stacking (over the captions, under the hook).
  - Fade, Pop and Slide become opacity, scale and a y offset over time, with the hook's curves.
- **The preview:** it shows the picture (served by the backend by its hash) as an image in the stage's SVG, placed with the Overlay's maths and animated the same way. The last picture stays on screen until a new one has loaded.
  - Inline editing of the words on stage keeps its editable field over the picture.
- **The dry run** lists each Text Layer's picture URL and bounds.

**Blocked by:** 01.

**Status:** done

- [x] A Text Layer's picture has alpha 0 away from its ink. A white stroke over transparency shows no dark fringe. The same layout gives the same file and isn't made twice.
- [x] A rendered frame shows a Text Layer's colour, stroke and plate at the planned bounds, matching what ticket 01's ASS path drew within a small tolerance.
- [x] Fade, Pop and Slide in and out render at the same moments and extents as before.
- [x] A Text Layer is drawn over the captions and under the hook.
- [x] The preview shows the picture at the plan's bounds. Moving the layer doesn't request a new picture; changing its colour does.
- [x] A swept Job's unused pictures are removed, and one used by a Revision is kept.

## Comments

**2026-10-17 (agent):** Built.
- **The canvas, proved first:** `ass` with `alpha=1` over a transparent `rgba` source does *not* give straight alpha on ffmpeg 9.0.2 / libass 0.17.5. A partly covered pixel comes out with its colour multiplied by its coverage and its alpha by it twice (a 50% green plate read back as (0,127,0) at alpha 63), so a white stroke gets a dark fringe. So the rasteriser uses the fallback, difference matting: one ffmpeg run draws the script over black and over white (`hstack`, raw RGB to a pipe); alpha = 1 − (white − black)/255, colour = black ÷ alpha. Checked: a 50% plate reads back exactly, and every partly transparent pixel of a white stroke stays white.
- **Planner** (`backend/app/planner.py`): `TextLayout` (style, size, lines, anchors from the picture's corner, size at scale 1, raster scale, plate box and radius) and its `name`, a hash of the layout, its Face's file hash and `TEXT_PICTURE_FORMAT`. The picture holds the area plus `TEXT_INK_ROOM` (half the size) and the stroke on each side, made even. Its anchors are kept from its own corner, so moving a layer keeps the same picture. `TextEvent` gains `layout`, `image` (the file name), `picture` (a `Picture`, the Overlay's shape) and `bounds` (the area once scaled and turned). The raster scale is the Transform's scale, capped at `MAX_TEXT_PICTURE` (4096).
- **Rasteriser** (`backend/app/text_pictures.py`): writes the layout's ASS (the plate as `\p1`, lines at their anchors, the stroke as `\bord`) with a fonts dir from `registry().gather`, mattes with numpy and writes the PNG with cv2. Pictures are cached in `jobs/<id>/texts/<hash>.png` (written under a temporary name, then renamed). `sweep` runs with the Retimed copies' sweep when a Job is opened (`api.sweep_unused`, renamed from `sweep_retimed`). It keeps the pictures of every Candidate and Revision state, and never touches one being written.
- **When pictures are made:** in `editor.preview_plan`, so the preview and the MCP dry run always have them (about 0.15 s per changed look), and in `rendering._render` before the encode. `Renderer.render` takes `pictures` and refuses a plan whose picture wasn't made.
- **Renderer:** Text Layers left the ASS script. With any, the script is cut in two: the Watermark text and the captions are burned first, then each Text Layer's picture, then the hook. A still one goes through `_picture` as an image Overlay does. An overlay onto 4:2:0 frames moves a picture to an even pixel, so one with its corner at an odd pixel is padded by a transparent one. One with Fade/Pop/Slide is drawn by a frame process (`PictureFrames` now takes a `sampled` rule), using `text_look`/`text_at`: opacity, scale about the centre and a drop in y, on the hook's straight-line curves. Fade alone uses the uncapped ramps libass's `\fad` used.
- **Proof against the old look:** `test_migrated_text_layers_plan_and_look_as_they_did` burns ticket 01's golden ASS lines over grey, then lays the 9 migrated layers' pictures over grey. It compares them at two moments that show all 9 between them: the largest difference is 3.4 levels (asserted ≤ 6, mean < 1). The byte comparison of ASS lines is gone, and the .ass fixture is now that reference.
- **Preview** (`frontend/src/pages/job/editor/textPicture.ts`, `ClipPreview.tsx`'s `TextLayerView`): an SVG `<image>` of `textPictureUrl(jobId, event.image)` at the `picture`'s centre and size, turned and faded by it, and animated by `hookLook` as before. `useTextPicture` keeps the last loaded picture until the new one loads. Inline editing is unchanged.
- **MCP:** the dry run's `text_layers` give `bounds` and `picture` (`/api/jobs/<id>/texts/<name>`, served immutable).
- **Decisions:**
  - The area is still kept inside the frame, as it was for stored Clips.
  - `_check_drawn` still refuses a scale, rotation or opacity other than the defaults. The picture path already applies them (the renderer and the preview both use the Transform), but the centre-on-frame rule, the stage grips and their tests are ticket 05's.
  - Ticket 05 should delete those lines of `_check_drawn` and the clamp in `text_event`.
- **Left:** nothing for this ticket.
