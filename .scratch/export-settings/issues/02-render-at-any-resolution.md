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

**Status:** ready-for-agent

- [ ] At 720p, a caption, a Text Layer, a Shape, an Overlay and the Watermark land at their 1080 positions × 2/3. Checked by sampling pixels of a rendered frame.
- [ ] At 1440p, a Text Layer's edge is about as many pixels wide as at 1080. The picture is rasterised at 1440, not scaled up.
- [ ] A keyed Overlay and a rotated Shape are where their scaled Keyframes say at given frames, at 720p.
- [ ] A Blur Scene and a Transition render at 720p and 4K without error, at the right size.
- [ ] At 1080, renders are unchanged: the existing render tests pass.
- [ ] The Preview Plan is the same for any Export Settings.
