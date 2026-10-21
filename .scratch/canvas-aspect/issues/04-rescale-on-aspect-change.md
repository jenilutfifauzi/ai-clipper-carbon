# 04: Rescale a Candidate's positions when its aspect changes

**Parent spec:** `../spec.md` (Implementation Decisions "Rescale on an aspect change"); docs/adr/0022-a-canvas-aspect-per-candidate-in-its-own-pixels.md.

**What to build:** changing a Candidate's aspect, from the API or `edit_candidate`, keeps its edit looking the same on the new shape.

A pure function takes the draft, the old and new aspects, and the pictures' sizes that fitting needs. It returns the rescaled draft:
- **Centres** of every Candidate-owned Transform, position Keyframe and Cue Edit keep their place as a fraction of the Canvas.
- **Framings** (media Segments, the Source in Manual, Layout Overrides) keep their scale relative to the cover scale. A filled Segment still fills the frame, and 1.5× cover stays 1.5× cover.
- **Overlays, Text Layers and Shapes** keep their drawn size in pixels: new scale = old scale × old fitted size ÷ new fitted size.
- **Scale Keyframes** follow their item's rule.
- **Every result** is clamped to the new Canvas.

The backend runs it when an edit changes `aspect`. Positions sent in the same edit are taken as already on the new Canvas and are left as sent.

The rescaled state is the new Revision, and restoring the earlier Revision undoes it.

**Blocked by:** 03.

**Status:** done

- [x] Seam B tests:
  - (270, 480) on 9:16 lands at (480, 270) on 16:9;
  - a filled media Segment stays at the cover scale, and a 1.5× cover Framing stays 1.5× cover;
  - an Overlay's and a Text Layer's drawn size is unchanged;
  - position and scale Keyframes follow;
  - Cue Edits move;
  - values are clamped;
  - positions sent with the aspect are left as sent;
  - 9:16 to 16:9 and back is within rounding for interior items.
- [x] API/MCP test: `edit_candidate` with only `aspect` returns rescaled positions, and `dry_run` shows them without saving.
- [x] Restoring the earlier Revision gives back the old aspect and positions.

## Comments

**2026-10-21 (implementation):** `app/rescale.py` holds the pure `rescaled(candidate, aspect, sizes, source)`. It takes the Media Library's picture sizes and the Source's size, and gives the Candidate on the new Canvas.
- **Centres** of every Transform it owns (its Framing, media Segments' Framings, Layout Overrides, Overlays, Text Layers, Shapes), their X/Y Keyframes and its Cue Edits are multiplied by new ÷ old width and height. They are clamped to the new Canvas and rounded to a hundredth of a pixel; a Cue Edit's are rounded to whole pixels.
- **Framings** multiply their scale (and their scale Keyframes) by new cover ÷ old cover, of what their Crop keeps. The Source's size serves the Candidate's Framing and the Layout Overrides.
- **Overlays** multiply theirs by old fitted ÷ new fitted.
- **Text Layers and Shapes** are drawn at their own size (style size times scale), which no Canvas fits. So their scale is the same, and only their centres move. The test checks their drawn picture size is unchanged.
- Scales are clamped to 0.05–8. A picture whose size is unknown (an item gone from the Media Library) keeps its scale, and its centre still moves.

`review.update` runs it when the edit changes `aspect`. The fields the change sends (`segments`, `overlays`, `text_layers`, `shapes`, `layout_overrides`, `framing`, `cue_edits`) are taken as sent, each list as a whole. The rest come from the rescaled Candidate. `Episode` gains `source` and `sizes`. `api._episode` builds it with the Source's size, and the PATCH and a draft's Preview Plan add `library.sizes()` only when the body has `aspect`. So the PATCH, `dry_run` and `edit_candidate` share it. A Restore sends every position along with the old aspect, so it brings back the earlier Revision exactly. The MCP instructions' Canvas section now describes the rescale (still within the tool budget).

Tests: new `tests/test_rescale.py` (Seam B) covers every case in the first box, plus the Source's Framings and Layout Override keys, and a missing size. `tests/test_aspects.py` gains an API test (an aspect change alone rescales a Text Layer, an Overlay and a Cue Edit, a Restore undoes it, and an Overlay sent with the aspect stays as sent) and an MCP test (`dry_run` shows the rescaled Overlay's bounds without saving, then `edit_candidate` saves them). Ran: test_rescale, test_aspects, test_canvas, test_review, test_revisions, test_mcp, test_manual_layout, test_overlays, all passing.

Not done:
- **A Transform sent without x/y still defaults to the 9:16 centre (540, 960).** The parsed Transform can't tell a default from a sent 540/960, so fixing it would mean making x/y optional across the planner. It doesn't fit this ticket. The editor always sends x/y; an MCP agent leaving them out on 16:9 gets (540, 960).
- As the spec asks, a Framing fitted (not covering) on 9:16 keeps its share of the cover scale. A 16:9 video at scale 1 on 9:16 (a third of cover) is therefore a third of the 16:9 frame after the change, not filling it.
