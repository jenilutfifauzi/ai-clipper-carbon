# 03: Duplicate and split a Pick

**Parent spec:** `spec.md` in this feature folder (user stories 16–20).

**What to build:** Cmd+D and Cmd+B, and their buttons in the Timeline's bar, act on the whole Pick.

- **Duplicate:**
  - Picked Text Layers, Music Clips and Overlays are copied, shifted by the group's span, when that fits before the Clip's end. Otherwise each copy is placed aside, as a single duplicate is today.
  - Picked Segments are copied as a block, in Main Track order, right after the last picked Segment.
  - The copies become the Pick.
- **Split:**
  - Every picked item that the playhead is inside is cut by its kind's rule. A Source Segment is cut in the silence between Words. Items the playhead isn't inside are left alone.
  - The right-hand parts become the Pick.
  - The Split button is enabled while the playhead is inside any picked item.
- **One undo step each.** Duplicate and Split are each one change.
- **The multi-item summary in the inspector** gains Duplicate.

**Blocked by:** 02.

**Status:** done

- [x] Seam D:
  - [x] a layer group is shifted by its span when it fits, and placed aside when it doesn't;
  - [x] Segments are copied as a block after the last picked one, in order;
  - [x] split cuts only the items under the playhead;
  - [x] the copies and the tails are the new Pick.
- [x] In the browser, Cmd+D and Cmd+B on a mixed Pick each undo in one step.
- [x] Typecheck, test, build.

## Comments

**2026-10-15: done.** Copies and parts are made and picked in one order: the Segments in Main Track order, then the Text Layers, Music Clips and Overlays in their lists' order. Checked in the browser: Cmd+D on a Segment and a Text Layer copies both, Cmd+B at 1.5 s cuts both, and each undoes in one step.
