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

**Status:** ready-for-agent

- [ ] Split all, Ripple delete, a Magnetic trim of the Main Track, and copy then paste each leave a Shape where they leave a Text Layer.
- [ ] Hiding the Shape Track hides Shapes in the preview; locking it refuses hand edits; neither changes the render.
- [ ] ↑/↓ stop at a Shape's edges, and dragging a Shape snaps to another picture's edges.
- [ ] A tile dropped on the Timeline lands at the drop time on the Shape Track; dropped on the preview, at the drop point.
- [ ] Another editor's new Shape survives a merge with unsaved local edits.

## Comments
