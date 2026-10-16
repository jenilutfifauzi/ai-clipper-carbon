# 06: Diamonds in the inspector, and auto-key

**Parent spec:** `spec.md` (user stories 16–20, 22–24; Solution "Editing", "Only one item"; Implementation Decisions "One sampling module, twice", "Editor actions").

**What to build:** the owner can key a picture or a sound where they already edit it.
- **The diamonds.** A ‹ ◆ › cluster sits beside X, Y, Scale, Rotation, Opacity and Volume in the Advanced Edit's inspector, for every keyable item that exists by then: Overlays and Music Clips, plus media Segments and Manual Scenes if 04 and 05 are in.
  - The diamond is filled when there is a Keyframe at the playhead, outlined when there are Keyframes elsewhere, and grey when the property is constant.
  - Clicking it adds a Keyframe with the value shown, so nothing moves, or removes the one there.
  - ‹ and › move the playhead between that property's Keyframes.
- **Auto-key.** Once a property is keyed, every change writes a Keyframe at the playhead: a field, a Grips drag, Fit and Fill.
- **Reset** clears the Transform's Keyframes.
- **Removing the last Keyframe** leaves the constant at the value at the playhead.
- **When the controls are off.** They are off outside the item. In a multi-item Pick, a field keyed on any picked item is disabled, with a note.

- **The frontend's Keyframe actions** (pure): set, remove and toggle at a time, with the half-frame replace and the inherited Ease; clear a property, or all.
- **Every Keyframe edit is one change of the edits:** one step of undo, saved and merged like any other. A locked Track refuses them.

**Blocked by:** 01, 03

**Status:** ready-for-agent

- [ ] Seam D:
  - [ ] toggle adds a Keyframe with the value at the playhead and the Ease of the one before; again removes it;
  - [ ] removing the last Keyframe sets the constant to the value at the playhead;
  - [ ] on a keyed property a Transform change writes a Keyframe at the playhead, and on an unkeyed one it changes the constant;
  - [ ] a Keyframe set within half a frame of another replaces it;
  - [ ] Reset clears the Transform's Keyframes;
  - [ ] a locked Track refuses a Keyframe edit.
- [ ] By hand: keying a slide-in of an Overlay by moving the playhead and dragging the picture, and undoing it step by step.
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.
