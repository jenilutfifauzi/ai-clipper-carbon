# 04: Drop shadow, plate shapes, line height and tracking

**Parent spec:** `spec.md` (Implementation Decisions "Domain and model" (Text Style), "Planner (layout)", "Rasteriser").

**What to build:** the rest of the Text Style's look, in the inspector and the agent's tools.

- **The drop shadow:** a value type of its own (`colour`, `opacity`, `blur` px, `distance` px, `angle` degrees), shared later by the Hook and Caption Styles (ticket 14). Off when its opacity is 0, or when its distance and blur are both 0.
  - The rasteriser draws it as its own event below the text: the text in the shadow's colour and opacity, offset by distance and angle, and `\blur`red. libass's `\blur` acts on the outline, so it can't be a `\shad`.
  - The picture grows to hold the shadow.
- **The plate:** `shape` gains `strips`, a rounded rectangle behind each line (the Hook Shape's values). Radius and padding become editable.
- **Line height and tracking:**
  - `line_height` sets the anchors' pitch.
  - `tracking` (px, may be negative) is added after every character but a line's last. Line breaking measures it, and the rasteriser sets it as `\fsp`.
- **Inspector:** Shadow, Plate and Spacing sections, laid out as the existing fields are.
- **MCP:** every field can be set and merged, the shadow and the plate by their own fields.

**Blocked by:** 02.

**Status:** done

- [x] A rendered frame shows a shadow offset in the direction of its angle by its distance, softened by its blur. A zero-distance shadow with blur makes a halo.
- [x] Strips draws one rounded plate per line, each as wide as its line plus padding. Block draws one plate.
- [x] Planner: tracking widens a line by (n−1)×tracking, and ~~the wrapped lines~~ the size an over-wide layer is set at accounts for it (wrapping is ticket 03's: see Comments). Line height sets the gap between anchors.
- [x] `merge_candidate_items` changing `style.shadow.angle` keeps the shadow's other fields.
- [x] Out-of-range values (negative blur, opacity over 1) are refused.

## Comments

**2026-10-17 (agent):** Built.

**What was built:**
- **The drop shadow** is its own value type, `DropShadow` in `backend/app/styles.py` (so that ticket 14 can put it on the Hook and Caption Styles): `colour`, `opacity` (0..1, default 0.6), `blur` (0..100 px), `distance` (0..100 px), `angle` (−360..360°, default 45). It is off by default (no distance, no blur). Its properties: `on` (opacity > 0 and a distance or a blur), `offset` (right and down, px) and `reach` (1.5 × blur + distance: how far past the text it can fall). `TextStyle.shadow` holds one.
- **Angle convention:** degrees clockwise from the right on the frame (y down): 0 right, 45 down and to the right, 90 down. This is what ticket 14's "45° … down and to the right" needs.
- **Blur convention:** px as a CSS shadow's blur radius (sigma = blur / 2), as the Overlay's `Shadow`. libass's `\blur N` is a Gaussian of sigma N × 2/√ln 256 (measured: 0.84–0.85), so the tag is `blur / 2 / LIBASS_BLUR_SIGMA` (`renderer.py`).
- **Planner** (`backend/app/planner.py`):
  - `TextLayout.box` became `plates: list[Box]` (the Block, or one Strip per non-blank line, in the picture's pixels). It also gained `shadow`, the offset, or None when the shadow is off.
  - `_plates` works out the rectangles. A Strip is its tracked line plus padding wide, and from the capitals less padding to the descenders plus padding tall. It follows the line's alignment and stays inside the area. The radius is capped at half a strip's height.
  - `_text_layout` grows the picture's room on every side by the shadow's reach, so the area stays in the picture's middle (the Transform turns it about that).
  - Line widths use `FontMetrics.width(…, tracking)`. Shrinking an over-wide layer finds the largest size each line fits at with its tracking staying as wide, as the hook does (`MIN_SIZE` floor).
  - `TextEvent.box` is still the area for a Block only (None for Strips), so the stored-layer fixtures compare as before.
- **Rasteriser** (`backend/app/text_pictures.py`):
  - The plate is one `\p1` drawing of all its rectangles (`_moved` shifts each `_rounded_box`). libass fills the union once, so Strips that overlap at a small line height don't double their opacity.
  - Then the shadow is one event per line, below all the lines, built with `renderer._shadow_tags`. Then the lines, with `\fsp` and the `_tracked` half-tracking shift from ticket 13.
  - **Shadow with a stroke:** libass shows a seam where a translucent fill meets a translucent border (alpha up to 158 where 127 was asked). So a stroked shadow draws only its border (`\1a&HFF&`), which covers the letters too: measured flat at the asked alpha. An unstroked shadow is its fill, `\bord0`.
  - After merging ticket 10 (CJK runs), each run is its own event. Tracking is set per run with `\fsp`, and each run is placed with the `_tracked` shift: libass centres the spacing after a run's last letter too. `placed_runs`/`runs_width` take the tracking. A run after a space starts past the space and the tracking after both. The shadow is one event per run. Tested in `tests/test_cjk_text.py`: a tracked Latin + Japanese line's ink lands where its runs are planned.
  - The shadow sits over the plate and under the words (as CSS `text-shadow` over a background). It is part of the picture, so it turns and scales with the layer.
- **Refusals:** `_check_drawn` no longer refuses tracking or Strips (it still refuses scale, rotation and opacity, for ticket 05, and wrap_width and fixed_height, for ticket 03). Out-of-range shadow, plate and spacing values are refused by their field constraints.
- **MCP:** the shadow merges field by field through the existing generic patch models. The server instructions describe shadow, Strips and tracking. The tool list grew to about 66.7 KB, so `TOOLS_BUDGET_BYTES` went from 65,000 to 67,500. The shadow's details are a field comment, not a docstring, to keep the schemas short.
- **Frontend:**
  - `api.ts` has `DropShadow` and `TextStyle.shadow`.
  - `advanced/textStyle.ts` has `NO_SHADOW`, `shadowOn` and `withShadow`. Turning a shadow on gives it 6 px distance and 8 px blur if it had neither. Turning it off sets its opacity to 0 and keeps the rest.
  - `advanced/TextStyleGroups.tsx` has the Shadow, Plate (None/Block/Strips, colour, opacity, corner radius, padding across and down) and Spacing (line height, tracking) groups. They work through a `StyleAccess` (`layerStyle` for one layer, `layersStyle` for several, with Mixed), so both inspectors in `TextLayers.tsx` share them. The old "Box behind the text" switch is now the Plate group. Undo groups keep their names (`plate.*`, `shadow.*`, `style.line_height`/`style.tracking`).

**Tests:**
- `tests/test_text_layers.py` (Seam B):
  - tracking widens by (n−1)×tracking (and negative), the tracked shrink, and a left line's middle;
  - line height pitch;
  - Strips per line for each alignment, and Block as one plate;
  - the shadow's offset at 0/45/90/180/−90°, the picture's growth, the halo, and off;
  - refusals.
- `tests/test_text_pictures.py` (Seam A):
  - a picture's ink is wider by 3×tracking and stays centred;
  - one real render with a hard 45° shadow (21 px right and down, none above or left, hard-edged), a blurred one (reaches further and mostly fades) and a halo (about the same reach on all four sides);
  - Strips: two blue plates, each at its planned x extent, with video between them.
- `tests/test_mcp.py`: merging `style.shadow.angle` keeps the shadow's other fields and the plate. Strips, tracking and line height merge, and a bad blur or opacity is refused.
- Frontend: `advanced/textStyleGroups.test.tsx` covers turning the shadow on and off, each group's fields and their undo groups, and Mixed with several layers.

**Left / for the parallel tickets:**
- **Wrapping (ticket 03):** there is none on main yet, so "the wrapped lines account for it" can't be tested here. Ticket 03's line breaking should measure with `metrics.width(line, size, style.tracking)`. It should keep `_plates` (Strips follow whatever lines it makes) and the shadow's reach in `_text_layout`'s room.
- **Ticket 14** should reuse `DropShadow`, `renderer._shadow_tags` and `LIBASS_BLUR_SIGMA` for the hook and captions. The Caption Style's `shadow: int` (a `\shad` distance) maps to distance = shadow × √2, angle 45, blur 0, opacity 1.
- The Text tab's look buttons (CSS) don't draw shadows. None of the 4 looks has one; ticket 09's Presets may want `text-shadow` there.
