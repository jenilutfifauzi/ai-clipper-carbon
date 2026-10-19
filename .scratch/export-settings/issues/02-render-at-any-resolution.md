# 02: Render at any resolution

**Parent spec:** `../spec.md` (Solution "every size is sharp"; Implementation Decisions "Planner and renderer"); docs/adr/0021-export-presets-and-a-plan-drawn-at-any-size.md.

**What to build:** a Clip rendered at 720p, 1080p, 1440p or 4K looks like the same edit at another size, with sharp text.
- **The Render Plan stays in 1080×1920 output pixels.** The preview, the Preview Plan and every saved position are unchanged.
- **The renderer draws the plan at the Export Settings' size** (720×1280, 1080×1920, 1440×2560, 2160×3840). Every coordinate and size it writes is multiplied by one factor, height / 1920:
  - Scene panels, crops and Blur's background;
  - Overlays, media Segments and Manual Framings, with their Keyframes, corners, borders and shadows;
  - Transitions' geometry;
  - the captions' and hook's ASS, drawn by libass at the output size;
  - the Watermark (text and Logo);
  - the picture layers (Text Layers and Shapes), rasterised at the output size and placed there.
- **Picture names include their scale,** so a 4K picture and a 1080 one of the same layer don't collide.
- **The poster** is the Clip's frame at the Clip's size.
- **No hard-coded 1080×1920 is left in the render path** (the keyed pictures' frames included). Everything goes through the output size.

**Blocked by:** 01

**Status:** done

- [x] At 720p, a caption, a Text Layer, a Shape, an Overlay and the Watermark land at their 1080 positions × 2/3. Checked by sampling pixels of a rendered frame.
- [x] At 1440p, a Text Layer's edge is about as many pixels wide as at 1080. The picture is rasterised at 1440, not scaled up.
- [x] A keyed Overlay and a rotated Shape are where their scaled Keyframes say at given frames, at 720p.
- [x] A Blur Scene and a Transition render at 720p and 4K without error, at the right size.
- [x] At 1080, renders are unchanged: the existing render tests pass.
- [x] The Preview Plan is the same for any Export Settings.

## Comments

**2026-10-19, agent:** Built.
- **The plan at another size** (`app/scaled_plan.py`, new): `scaled_plan(plan, size)` is a pure function giving the Render Plan as drawn in a `size` frame, every output pixel × height / 1920; a plan at its own size is itself (so at 1080 the renderer draws exactly the plan it did). Scaled: panels' areas (even, inside the frame), Pictures (drawn size even, centre, bounds, radius, border width ≥ 1, shadow, `unscaled`, the X/Y Keyframes of `motion` and of a Scene's `ignored`), caption and hook boxes, sizes, anchors and kicker, the Watermark's area and size, picture layers' area, bounds, anchors and plate box. Kept: Source pixels (crops, paths), item pixels (a Picture's crop and item size), times, styles, Segments, Transitions, the `framing` a switch to Manual starts from. `drawn_scale(plan)` is the factor for what the renderer holds in planner pixels.
- **Picture layers** are rasterised at the output size: their layout's scale × the factor, under MAX_LAYER_PICTURE (as `picture_scale` caps it), which gives another `PictureLayout.name` of the same `picture_key`, so a 4K picture and a 1080 one don't collide. `renderer.picture_layouts(plan, export)` lists the layouts to make before a render; the render worker uses it.
- **Renderer** (`app/renderer.py`): `render` draws `scaled_plan(plan, output_size(export))` in the filter graph and the frame processes (`PictureFrames(..., frame=)`, `_piped`'s `-video_size`, `on_frame(picture, frame)`, background fills and `pad` at `plan.width × plan.height`). Blur's shrink is × `drawn_scale` so the blur looks the same at every size; a picture layer's Slide drop is × it too (`layer_at(event, time, drawn)`). xfade Transitions are relative to the frame and needed nothing.
- **Decision: the ASS script (captions, hook, text Watermark) is written from the plan in its own pixels** (PlayRes 1080×1920, which its styles' sizes, outlines and shadows are in) and libass scales it to the frame, which sets the glyphs at the output size, so they are sharp. All four sizes are exactly 9:16, so nothing is stretched. Writing it in output pixels would have meant scaling every style field too, for the same picture.
- **Poster**: still split from the graph's last picture, so it is the Clip's frame at the Clip's size. No `FRAME`/1080×1920 is left in the render path (`frames.py` defaults to `FRAME` only for callers that draw the plan as it is).
- **Preview Plan**: untouched; the renderer never changes the plan it is given (checked in the 720p test), and the plan file beside a Clip is the planner's.
- **For later tickets**: 03 (frame rate) is orthogonal: `scaled_plan` keeps `fps` and times. 04 passes the Preset's settings to both `picture_layouts` and `render` in `rendering.py` (the one place `ExportSettings()` is built now). 07 (Save frame) should draw through `scaled_plan` at the default Preset's size the same way, making the picture layers with `picture_layouts` first. Source video above its resolution is upscaled by the panels' `scale`, as ADR 0021 says.
- Tests: `backend/tests/test_render_sizes.py`. Seam B: a plan at its own size is itself; at 720p every output pixel is 2/3 and Source/item pixels stay; at 4K pictures are rasterised twice as large under the cap. Seam A (real ffmpeg): at 720p a caption, Text Layer, Shape, Overlay and Logo land at 2/3 of their 1080 extents (pixel counts 4/9); at 1440p a Text Layer's picture is 4/3 the raster and its antialiased edge grows only with its length (an upscaled 1080 picture, tried, gives about twice as many edge pixels and fails); at 720p a keyed Overlay and a keyed, turning Shape match 2/3 of their 1080 places at 0.5 s and 1.5 s; a Blur Scene with a Slide Transition renders at 720p and 4K at their size, poster included. The existing render tests pass unchanged at 1080.

