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

**Status:** done

- [x] Seam D:
  - [x] remove of mixed kinds is one change;
  - [x] with every Segment picked, the first stays and a notice is given;
  - [x] select all picks exactly the timed items.
- [x] In the browser:
  - [x] Shift- and Cmd-click build a Pick and highlight it;
  - [x] a plain click resets it;
  - [x] Esc and Cmd+A work;
  - [x] Delete removes everything picked, and Cmd+Z restores it in one step.
- [x] Typecheck, test, build.

## Comments

**2026-10-15: done.** Checked in the browser on a Candidate of a review Job: Shift- and Cmd-click build and trim the Pick, Cmd+A picks every timed item, Esc empties it, Delete removes a mixed Pick (keeping the first Segment with a notice) and one Cmd+Z brings it back. A Segment's own Delete key now goes through the same rule, so it works when that Segment is the Main Track's only one and other items are picked.
