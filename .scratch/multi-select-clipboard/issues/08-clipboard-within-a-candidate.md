# 08: Copy, cut and paste within a Candidate

**Parent spec:** `spec.md` in this feature folder (user stories 30–39, 46, 47; Implementation Decisions "The Clipboard", "Paste rules").

**What to build:** the owner copies a group and pastes it elsewhere in the same Clip, keeping its shape.

- **The Clipboard** lives in module memory, outlives the Advanced Edit, and is lost on reload. It holds:
  - the Job id;
  - the copied Segments, in Main Track order, with the Transitions between copied neighbours;
  - the copied layer items, with their times relative to the group's start (Segments as played).
- **Copy (Cmd+C)** copies the timed items of the Pick. A hook, captions or join Pick copies nothing.
- **Cut (Cmd+X)** is copy and remove, in one change.
- **Paste (Cmd+V):**
  - Every item gets a new id.
  - Segments are inserted at the join nearest the playhead (the Clip's start and end included), with their Transitions remapped. The anchor is that join; with no Segments, it is the playhead.
  - Layer items start at the anchor plus their offset.
  - Against the Clip's end after the insert:
    - an item that starts at or past it is skipped;
    - an item that crosses it is trimmed, and kept only if it still lasts at least the shortest item length;
    - a notice counts what was trimmed and skipped.
  - Layer items already in the Clip don't move.
  - The pasted items become the Pick, and the paste is one undo step.
- **The Timeline's bar on a desktop** gains Copy and Paste. The multi-item summary in the inspector gains Copy. Paste is disabled while the Clipboard is empty.

**Blocked by:** 02.

**Status:** done

- [x] Seam D:
  - [x] copy then paste with no Segments keeps the offsets, gives new ids, and makes the pasted items the Pick;
  - [x] Segments are inserted at the nearest join, at the start, between two Segments and at the end;
  - [x] Transitions between copied neighbours are remapped, and one into an uncopied Segment is dropped;
  - [x] layers are placed from the join;
  - [x] items are trimmed or skipped at the end, and the notice counts them;
  - [x] cut equals copy plus remove in one change.
- [x] In the browser:
  - [x] copying a Segment with its title and pasting it near another join lands both together;
  - [x] one Cmd+Z removes the paste.
- [x] Typecheck, test, build.

## Comments

**2026-10-15: done.** The Clipboard is its own module: pure `copy`, `cut` and `paste` (tested at Seam D with the actions) and a store kept in module memory that the editor subscribes to. The Clip's length after an insert is estimated from the pasted Segments' ranges less their Transitions' overlaps (the planner's Word snapping can move it by a little). Checked in the browser: a Segment with its title copied and pasted near the end lands both at 27.5 s; Cmd+X and Cmd+V move a Text Layer to the playhead; each undoes in one step.
