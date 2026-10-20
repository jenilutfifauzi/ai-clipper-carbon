# 08: Hold to see the original, and Compare render

**Parent spec:** `../spec.md` ("Compare render", "Preview"); GLOSSARY "Compare render".

**What to build:** two checks for the owner, on the Advanced Edit's player.

**Hold to see the original:** a button that drops every Grade filter (and, once 04 and 07 are in, the Candidate's and the Adjustment Layers') while it is held.

**Compare render:** while the preview is paused, a button asks the server for one frame. The server renders it at the playhead through the render path, for the saved Candidate or the unsaved draft, as the Preview Plan endpoint takes one, and returns a PNG. The frame is not kept as an Export file; the endpoint reuses `save_frame`'s drawing path.
- The PNG is shown over the player under a draggable split line: preview on the left, render on the right.
- It is cleared on any playhead move or edit.
- It is desktop only.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] **Endpoint:** it returns a full 1080×1920 PNG matching the rendered frame at that time, for a saved Candidate and for a draft, and keeps nothing in the Job.
- [ ] **Editor (vitest):**
  - The compare frame clears on a playhead move and on an edit.
  - Holding the original button removes the Grade filters, and releasing restores them.
