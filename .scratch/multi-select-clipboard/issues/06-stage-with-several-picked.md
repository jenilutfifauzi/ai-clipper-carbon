# 06: The preview with several items picked

**Parent spec:** `spec.md` in this feature folder (user stories 26–29).

**What to build:** the preview's stage shows and moves several picked items.

- **The stage takes a set of picked stage ids:** the hook, the captions, Text Layers and Overlays.
- **Every picked item that is on screen** gets its own dashed outline.
- **Shift-, Cmd- or Ctrl-click** on the stage adds an item to the Pick or removes it, with the same rules as the Timeline. The hook and the captions are always picked alone.
- **Dragging a picked item** moves every picked stage item on screen by the same offset, as one gesture group (one undo step). Snapping guides follow the dragged item.
- **The resize corner** shows only when one item is picked.
- **Arrow nudges on the stage** move every picked stage item.

**Blocked by:** 02.

**Status:** done

- [x] In the browser:
  - [x] two Text Layers and an Overlay picked are all outlined;
  - [x] dragging one moves all three, and one Cmd+Z undoes it;
  - [x] the resize corner shows only with one picked;
  - [x] Shift-click on the stage toggles.
- [x] Typecheck, test, build.

## Comments

**2026-10-15: done.** The stage's handles (hook, captions, Text Layers) and the Overlays share one list of what is picked. A move of one of several is saved as one change by the Pick's `nudge`, which moves every picked Text Layer and Overlay by the same offset and keeps each middle in the frame. Until the plan has them there, the others are drawn moved as far (a `Drift` from the item being moved, here or among the Overlays). Checked in the browser: two Text Layers, then a Text Layer with an Overlay, moved together and saved together; the resize corner shows only with one picked; Shift-click toggles on the stage. The clip editor passes its one stage item as a list and ignores toggling.
