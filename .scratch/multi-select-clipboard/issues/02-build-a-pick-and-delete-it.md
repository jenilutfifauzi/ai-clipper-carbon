# 02: Build a Pick on the Timeline and delete it

**Parent spec:** `spec.md` in this feature folder (user stories 1–3, 10–15, 52).

**What to build:** on a desktop, the owner picks several items on the Timeline and deletes them at once.

- **Clicks on the Timeline:**
  - Shift-, Cmd- or Ctrl-click on a Segment, Text Layer, Music Clip or Overlay adds it to the Pick or removes it.
  - A plain click picks only that item.
  - Any click on the hook, the captions or a join replaces the Pick with it.
- **Every picked item is highlighted.**
- **Keys:**
  - Cmd/Ctrl+A picks every Segment, Text Layer, Music Clip and Overlay.
  - Esc empties the Pick.
- **Delete** (key and button) removes every picked item in one change, so one undo step. It never empties the Main Track: when every Segment is picked, the first stays, picked, with a notice.
- **A Pick of several items** shows a summary in the inspector ("5 items: 2 Segments, 2 Text Layers, 1 Music Clip") with Delete. Duplicate and Copy arrive in their own tickets.
- **Keys that act on one item** (Shift+arrows, trim) work only while one item is picked.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Seam D:
  - [ ] remove of mixed kinds is one change;
  - [ ] with every Segment picked, the first stays and a notice is given;
  - [ ] select all picks exactly the timed items.
- [ ] In the browser:
  - [ ] Shift- and Cmd-click build a Pick and highlight it;
  - [ ] a plain click resets it;
  - [ ] Esc and Cmd+A work;
  - [ ] Delete removes everything picked, and Cmd+Z restores it in one step.
- [ ] Typecheck, test, build.
