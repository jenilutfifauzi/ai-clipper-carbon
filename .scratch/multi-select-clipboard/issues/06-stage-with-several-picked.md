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

**Status:** ready-for-agent

- [ ] In the browser:
  - [ ] two Text Layers and an Overlay picked are all outlined;
  - [ ] dragging one moves all three, and one Cmd+Z undoes it;
  - [ ] the resize corner shows only with one picked;
  - [ ] Shift-click on the stage toggles.
- [ ] Typecheck, test, build.
