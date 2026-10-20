# 03: An Overlay's Grade, keyed pictures included

**Parent spec:** `../spec.md` ("Model", "Renderer", "Preview", "Advanced Edit UI", "MCP").

**What to build:** a picked Overlay (video or image) has the Color section in its Inspector, as a Segment does. Several picked Segments and Overlays edit their shared dials together.

**What the Grade touches:**
- In the render, it applies to the Overlay's picture after scale and flip, before alpha, corners, border, shadow and opacity. So its border and shadow keep their colours.
- In the preview, the Overlay's element carries its filter, and its border and shadow are drawn outside the filtered picture.

**Keyed pictures,** which are drawn by frame processes, get their Grade there:
- a keyed video Overlay, in its decoder's filters;
- a keyed media Segment, likewise (closing the gap left by 01);
- a keyed image Overlay, graded once before its frames are drawn.

Duplicate and paste keep the Grade. The agent sets `grade` on Overlays through `edit_candidate` and `merge_candidate_items`. The dry run's overlay view shows it.

**Blocked by:** 01.

**Status:** done

- [x] **Render:**
  - An Overlay's Grade changes its picture's pixels.
  - The Grade leaves its border colour unchanged.
  - The Grade leaves the Segment under it unchanged.
- [x] **Keyed items:** each of these, with a Grade, renders graded like its unkeyed form:
  - a keyed video Overlay;
  - a keyed image Overlay;
  - a keyed media Segment.
- [x] **Planner:** Overlay events carry their Grade.
- [x] **MCP:** merge sets one dial of an Overlay's Grade, and the dry run lists it.
- [x] **Editor (vitest):** a mixed Segment + Overlay Pick changes both in one undo step, and duplicate and paste keep the Grade.

**Notes (done):** a keyed media Segment was already graded once, with its whole frame at the end of
its Segment's chain (`_segmented`, from 01), its keyed picture included; grading it again in its
decoder would grade it twice, so its decoder is left alone and a test pins it graded like its
unkeyed form. An Overlay's Grade keeps the picture's alpha (`grade_filters(..., alpha=...)`): its
vignette, which ffmpeg draws only on opaque pictures, is drawn with the alpha split off and merged
back.
