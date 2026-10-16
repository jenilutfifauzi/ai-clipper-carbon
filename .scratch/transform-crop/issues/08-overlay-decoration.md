# 08: Rounded corners, border and shadow on Overlays

**Parent spec:** `spec.md` (user stories 18–21; Implementation Decisions "Model", "Renderer", "Preview"); ADR 0007.

**What to build:** an Overlay can have rounded corners, a border and a drop shadow.
- The radius is 0..0.5 of the drawn picture's shorter side.
- The border is 1..40 px with a colour.
- The shadow has a blur, an x and y offset, a colour and an opacity.
- The border and shadow are in output pixels and keep their size when the Overlay scales.

- **Model.** `Overlay.radius`, `border: Border | None` and `shadow: Shadow | None`.
- **Planner.** `Picture.radius` is in pixels, and `border` and `shadow` are resolved.
- **Renderer.** Corners and border are drawn by an alpha mask before `rotate`. Choose `geq` or a per-size mask frame with `alphamerge`, by timing on a 3-minute render, and note the choice. The shadow is a branch after `rotate`: the alpha is coloured, blurred, offset, and laid under the picture.
- **Preview.** `border-radius` and `border` go on the wrapper, and `filter: drop-shadow()` on an outer wrapper, so the shadow falls in screen space.
- **Inspector.** Corners, Border and Shadow for Overlays. `_plan_view` lists them.

**Blocked by:** 01

**Status:** done

- [x] Seam A:
  - [x] `radius` 0.5 leaves the box's corners showing the Segment;
  - [x] a shadow offset of (20, 20) darkens the pixels below and right;
  - [x] a border of 10 px shows its colour along an edge.
- [x] Seam H: `Picture` to CSS gives the radius in %.
- [x] Note the render time of a 3-minute Clip with one decorated Overlay against an undecorated one.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified, at each seam test first, on top of 01 and 02 (rebased onto 02's merge).

- **Model.** `Border` (`width` 1..40 px, `colour`) and `Shadow` (`blur` 0..100, `x`, `y` −100..100, `colour`, `opacity`) are in `backend/app/candidates.py`, every field with a default (a white 8 px border; a black shadow 12 px down, blur 24, at 0.5), so that one field turns either on. `Overlay` gained `radius` (0..0.5), `border: Border | None` and `shadow: Shadow | None`, after `volume`.
- **Planner.** `Picture` gained `radius` (output pixels: `radius` × the drawn shorter side, so it scales with the picture), `border` and `shadow` (as given: output pixels, the same at any scale), defaulting to none. `_overlay_event` sets them on the `picture_of` result, so `picture_of` is untouched for media Segments and Manual.
- **Renderer.** `_picture` adds `format=rgba` and `_corners` after the flips, and `_shadow` after `rotate`; each is left out when off.
  - Corners and border: a mask frame per size, made once. `_corners` makes one frame of the picture's size with a `geq` of a rounded box's signed distance (`_edge_distance`, antialiased over a pixel): the border's colour on a ring within its width of the edge, laid over the picture (`overlay`), then a mask of the rounded box, multiplied into the alpha (`blend=c3_mode=multiply`, so an image's own transparency stays, which `alphamerge` would replace). The filters that take a one-frame input repeat it. Their planar RGB is turned back into `rgba` before `rotate`, which otherwise took twice as long on it.
  - Shadow: `split`, then one branch of the picture's alpha (`alphaextract`, `lut` for the opacity, `pad`ded with room for 3σ of blur and the offset on every side, moved by the offset, `gblur` σ = blur/2 as a CSS shadow's) `alphamerge`d onto the picture tinted to the shadow's colour (`lutrgb`, padded the same way). The picture is laid over that at the room's offset, so its centre doesn't move.
- **Timing** (h264_videotoolbox at 8 Mb/s, 1080×1920 at 30 fps, 3 minutes, one 640×360 video Overlay at 540×304, the renderer's own `_overlay` graph; measured on this Mac, so not exact):
  - mask choice, prototype graphs with a 10 px border and radius 60: plain 28.2 s; mask frame 26.2 s; `geq` on every frame 586.9 s. Mask chosen.
  - shadow choice: blurring the whole RGBA frame took 69.4 s against 40.6 s for blurring only the alpha. Alpha chosen.
  - final graph: plain 26.3 s; radius 0.15, 8 px border and default shadow 28.9 s; the same turned 8° 34.2 s (turned alone 27.3 s). Before the `rgba` fix it was 49.9 s.
- **Preview.** `pictureStyle` gives `radius` (`"<r/width>% / <r/height>%"`, so the corners are round on a box of any shape), `border` and `shadow` (a `drop-shadow()`), with output pixels as `calc(Npx * var(--scale))`. `PicturePanel` puts the radius on the overflow-hidden media layer (02 keeps the wrapper unclipped for the grips), the border on a layer over the media inside it (at the picture's opacity, as the renderer draws the border before the opacity), and the shadow on an unturned outer layer the size of the stage (`pointer-events-none`, its picture box `pointer-events-auto`). The `children` (the handle) are now in a second box after it, so the shadow isn't cast by the handle and its corner grip.
- **Inspector.** `advanced/DecorationFields.tsx`, under the Transform section of `OverlayFields`: Corners (a Rounded slider from Square to Round), Border (a switch, then width and colour) and Shadow (a switch, then blur, across, down, colour, opacity). Each field is one history group, `overlay:<id>:radius`, `…:border.width`, `…:shadow.blur` and so on.
- **MCP.** `_patch_model` unwraps a `Dataclass | None` field into the dataclass's patch, so `{"border": {"width": 6}}` turns a border on with the other fields at their defaults, a later `{"border": {"colour": …}}` keeps the width, and `{"border": null}` turns it off. `_plan_view` lists each Overlay's `radius` (pixels), `border` and `shadow`, only when set. The instructions get two lines on the units.

Choices: the border is drawn inside the picture's edge (it covers the picture's outer pixels, the box keeps its size), as CSS `border` inside a `border-box`. The shadow's blur is a CSS blur radius (σ = blur/2), which is how browsers draw `drop-shadow()` as far as I know; not checked against a browser. The Overlay's shadow offset is on the frame (screen space) however it is turned, as the spec says.

Not tried: no browser walkthrough (the inspector's Corners, Border and Shadow fields, a rounded, bordered and shadowed Overlay in the preview against a rendered frame, the handle and grip on a shadowed Overlay).
