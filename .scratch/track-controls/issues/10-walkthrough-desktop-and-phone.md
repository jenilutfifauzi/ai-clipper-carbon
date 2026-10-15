# 10: Walkthrough on a desktop and a phone

**Parent spec:** `spec.md` in this feature folder (Testing Decisions: the browser walkthrough).

**What to build:** the owner and the agent walk through the whole feature on a real Job and confirm it matches the spec.

- **Desktop:**
  - Hide and mute each Track in the preview. Then render one Clip with a Track hidden and another muted, and see that it is complete.
  - Lock each Track against clicks, the rubber band, Cmd+A, drags, drops, pastes and the stage handles. A ripple still moves a locked Text Layer.
  - The Magnetic switch:
    - delete, trim (live while dragging), insert, duplicate and paste Segments with it on and off;
    - its notice when layers inside a cut are deleted;
    - one undo of each.
  - Reordering Segments and changing a Transition move no layer.
  - Shift+Delete on Segments with the switch off, on a Text Layer, and on a mixed Pick.
  - Split all from Cmd+B and from the bar, with the hook left whole and a locked Track skipped.
  - The clip editor's trim with the switch on, and the switch shared with the Advanced Edit across a reload.
- **Phone:** the Tracks sheet, Ripple delete in the picked items' bar, and Split with nothing picked.
- **Fixes:** anything found is fixed here, or filed as a new ticket in this folder.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09.

**Status:** ready-for-agent

- [ ] Each step above is checked by the owner.
- [ ] `npm run typecheck`, `npm test`, `npm run build` pass.
