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

**Status:** ready-for-agent

- [ ] Seam D:
  - [ ] copy then paste with no Segments keeps the offsets, gives new ids, and makes the pasted items the Pick;
  - [ ] Segments are inserted at the nearest join, at the start, between two Segments and at the end;
  - [ ] Transitions between copied neighbours are remapped, and one into an uncopied Segment is dropped;
  - [ ] layers are placed from the join;
  - [ ] items are trimmed or skipped at the end, and the notice counts them;
  - [ ] cut equals copy plus remove in one change.
- [ ] In the browser:
  - [ ] copying a Segment with its title and pasting it near another join lands both together;
  - [ ] one Cmd+Z removes the paste.
- [ ] Typecheck, test, build.
