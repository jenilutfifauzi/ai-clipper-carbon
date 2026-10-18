# 02: Tracer: a white rectangle from the Stickers tab to the render

**Parent spec:** `../spec.md` (Solution; Implementation Decisions "Domain and model", "Drawing", "Planning and rendering", "Advanced Edit"); GLOSSARY (Shape, Shape Style, Shape Kind, Stickers tab, Track); docs/adr/0011-shapes-are-pictures-like-text-layers.md.

**What to build:** the thinnest Shape that works end to end.
- **The Stickers tab** is a new asset tab with one shelf, Shapes, and one tile for now: rectangle, shown as a square.
- **Clicking the tile** adds a Shape at the playhead for a new Text Layer's length (or to the Clip's end), centred, 400×400, white fill, and picks it.
- **It is stored** in the Candidate's `shapes`:
  - its id, start, secs and Transform (stretch and flips refused);
  - a Shape Style with kind (rectangle only), width, height and fill;
  - `animation_in`, `animation_out`, `animation_ms` and `keys` in the model, with their defaults.
- **It is drawn as a `\p1` picture** on the picture-layer path from 01, over the captions and under the Text Layers. It shows in the preview and in the rendered Clip.
- **It sits on a new Shape Track** under Text, where it can be picked, moved, trimmed and deleted with undo. Corner Grips scale it and the top handle turns it.
- **The inspector** shows its Transform, timing, width, height and fill.

**Blocked by:** 01

**Status:** done

- [x] Clicking the rectangle tile adds a picked 400×400 white Shape at the playhead, as one undo step.
- [x] The preview and a rendered frame show it at its planned bounds; where it overlaps a caption the Shape shows, and where it overlaps a Text Layer the Text Layer shows.
- [x] Its picture has clean alpha and the planned size at the largest scale it reaches (capped).
- [x] A Shape with stretch or a flip is refused with a clear message.
- [x] A stored Candidate without `shapes` reads and renders as before.
- [x] Moving, trimming and deleting it on the Shape Track work with undo and redo.

## Comments

**2026-10-18, agent:** Built.
- **Model** (`app/candidates.py`): `ShapeKind` (rectangle only), `ShapeStyle` (`kind`, `width` and `height` as whole pixels 2–4096, `fill: Colour | None`), `Shape` (id, start, secs, Transform, style, `animation_in/out/ms`, `keys` with PICTURE_KEYS) and `Candidate.shapes` (empty by default, so stored Candidates read without a migration). Stretch and flips are refused by `_check_unstretched`, shared with Text Layers (their message is unchanged); a Shape with no fill is refused as having nothing to draw (03 widens that to "no fill and no stroke").
- **API and Revisions**: `CandidateUpdate.shapes` and `CandidateChange.shapes` (ids checked, a new or changed one past the Clip's end refused, `_look` and the Revision part "Shapes"); `RenderedClip.shapes`. Its schema is a one-line `WithJsonSchema`, because edit_candidate's input is this model and the tools' budget (TOOLS_BUDGET_BYTES) had about 70 bytes to spare: 08 has to describe Shapes to the agent within it (or raise it). Revision merge is the browser's (`merge.ts`): `shapes` merges item by item by id, as `text_layers`.
- **Planner** (`app/planner.py`): `ShapeLayout` (the style, the picture's size with SHAPE_ROOM = 2 px round the figure, scale; named by a hash with SHAPE_PICTURE_FORMAT), `ShapeEvent`, `shape_event` (area = width × height about the Transform's centre; picture scale from `picture_scale`, so keyed maximum and the 4096 cap), `RenderPlan.shapes`, and `picture_layers` = Shapes then Text Layers.
- **Drawing** (`app/text_pictures.py`): `shape_script` registered for `ShapeLayout` (one `\p1` drawing, `YCbCr Matrix: None`), `figure_drawing(style)` by kind (a `match` 04 extends), and `pictures_used` sweeps Shapes' pictures. The renderer took Shapes with no change but `_Motion`.
- **Dry run**: `shapes` (id, times, bounds, picture URL, Keyframes) in `_plan_view`.
- **Editor**: `ItemKind`/`TrackKind` `"shape"` (Shape Track under Text, hides and locks), `KINDS.shape` in actions.ts (so remove, move, nudge, duplicate, split and the Clipboard take Shapes already), `KeyedRef` `"shape"` in keying.ts (the stage's Grips write through `writeItemTransform`, so a keyed Shape is auto-keyed), Stickers tab (lucide `Sticker`, `ShapeAssets`), `shapeStyle.ts` (`newShape`, `addShape`; `newTiming` in edits.ts now shared with `newTextLayer`), `ShapeFields` (width, height, fill, `ShapeTransformFields`, timing), Shape lanes in Tracks.tsx (trims re-anchor Keyframes), the stage's `shapes` controls (corners and rotate handle) and `drawnPlan`/`layersAt`/`pictureLayers` (`shape:<id>`), and `shownPlan` hiding them.
- Not done here, for later tickets: Ripple delete and the Magnetic timeline (`ripple.ts` LAYER_KINDS), `pickAll` and Split all (`under`), Edit Points (`timelineView.ts`), Smart Guides targets (`picturesAt`), dropping a tile on the Timeline or the preview — 06; stroke, radius, shadow — 03; Keyframes pane and animations UI — 07.
- Tests: `backend/tests/test_shapes.py` (planner, model and API refusals, stored Candidate without `shapes`, picture alpha and size, sweep, a rendered frame over a caption and under a Text Layer's plate, the dry run) and `frontend/src/pages/job/advanced/shapes.test.ts`. The preview was checked through its pure parts (picture layers, stage Grips, hidden Track), not in a browser.
