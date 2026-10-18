# 06: Shapes everywhere a Text Layer goes on the Timeline

**Parent spec:** `../spec.md` (Solution "Everywhere a Text Layer goes"; Implementation Decisions generic actions, Track); GLOSSARY (Pick, Track, Magnetic timeline, Ripple delete, Split all, Clipboard, Edit Point, Smart Guide, Revision).

**What to build:** a Shape behaves as a Text Layer does in every Advanced Edit action:
- Split and Split all;
- Ripple delete and the Magnetic timeline;
- duplicate, and the Clipboard (into this Candidate or another);
- multi-select, with an inspector that edits shared Shape Style fields of several Shapes at once;
- Edit Points and Smart Guides;
- Zoom to fit;
- hiding and locking the Shape Track.

**Also:**
- Dragging a Stickers tile onto the Timeline or the preview adds the Shape where and when it is dropped.
- A Revision merge takes another editor's Shapes item by item.
- The clip editor's preview shows Shapes.

**Blocked by:** 02

**Status:** done

- [x] Split all, Ripple delete, a Magnetic trim of the Main Track, and copy then paste each leave a Shape where they leave a Text Layer.
- [x] Hiding the Shape Track hides Shapes in the preview; locking it refuses hand edits; neither changes the render.
- [x] ↑/↓ stop at a Shape's edges, and dragging a Shape snaps to another picture's edges.
- [x] A tile dropped on the Timeline lands at the drop time on the Shape Track; dropped on the preview, at the drop point.
- [x] Another editor's new Shape survives a merge with unsaved local edits.

## Comments

**2026-10-18, agent:** Built.
- **Magnetic timeline and Ripple delete** (`ripple.ts`): `LAYER_KINDS` and `Layers` take `shapes`, and `layersOf` (`actions.ts`) carries them, so a Segment removed, trimmed or put in (and the clip editor's trim, `clipTrimmed`) moves, cuts or removes Shapes as Text Layers, with their Keyframes re-anchored; the notice counts them ("1 Text Layer, 2 Shapes and 1 Music Clip inside the cut were removed."). Ripple delete of a Shape closes the Shape Track behind it (it already went by `KINDS`).
- **Select all and Split all**: `pickAll` picks Shapes, so `under` (Split all) cuts them, but on a locked Shape Track.
- **Edit Points and Zoom to fit** (`timelineView.ts`): `edgesOf` has the Shapes' edges (also what the Timeline's items snap to), skipped while the Shape Track is hidden. Zoom to fit already went by `LISTS`; now tested.
- **Smart Guides** (`smartGuides.ts`): `picturesAt` lists the Shapes showing at the playhead (`shape:<id>`, by their area as `layerStagePicture(layerEventAt(...))` has it), so a dragged picture snaps to a Shape's edges and centre; a hidden Shape Track's aren't targets (the preview's plan is `shownPlan`'s). Text is still no target.
- **Several Shapes picked**: `ShapesFields` (`Shapes.tsx`, "Editing N shapes") sets width, height and fill on all of them, Mixed where they differ, through `reshape` (`actions.ts`, the Shapes' `restyle`); `shared` is generic now. 03's stroke, radius and shadow and 07's animation fields aren't in it yet: they can go in its `READ` and Look group as TextLayersFields has them.
- **Dropping a tile**: `DRAG_SHAPE` (`drag.ts`); the Stickers tiles are draggable; the Shape Track's rows take it (`TrackHandlers.onDropShape`, at the drop time), and so does the preview's stage (`StageControls.drop`, its point by `framePoint` in `pictureGestures.ts`; the Shape centred there, at the playhead, `addShape`'s new `place`, kept in the frame). A locked Shape Track refuses both, with a notice. `addShape` takes `{ id, place }` now.
- **Also**: the `move-back` shortcut's label and comments name Shapes; `RenderedClip.shapes` in `api.ts` and `shapes` in Clips.tsx's list of edits that make a Clip out of date.
- Already done by 02 and unchanged: split, duplicate, the Clipboard, move, nudge (now with tests), hide and lock, the Revision merge (`shapes.test.ts`), and the clip editor's preview, which draws every picture layer of the plan (`pictureLayers`), Shapes included. The backend has no ripple of its own (ADR 0004), so nothing changed there.
- Tests: `frontend/src/pages/job/advanced/shapeTimeline.test.ts` (22). The drops were checked through their pure parts (`addShape` with a place, `framePoint`), not in a browser.
