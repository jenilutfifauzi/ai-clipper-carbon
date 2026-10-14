# 08: Timeline: trim, captions, hook

**Parent spec:** `spec.md` in this feature folder (user stories 22, 23, 25, 26).

**What to build:**
- `frontend/src/pages/job/editor/Timeline.tsx`:
  - a ruler, a playhead synced with the preview (click or drag to seek), and zoom;
  - the clip with 10 s of the Source on each side.
- **Tracks:**
  - **Clip:** start and end handles that snap to Word edges and save through `PATCH`.
  - **Captions:** a block per line; a click opens it in `CaptionTextEditor`.
  - **Hook:** a block dragged to move and resized to change its duration.

**Blocked by:** 04, 06, 07.

**Status:** ready-for-agent

- [ ] Trim follows the Transcript Picker's rules: the start before the end, at most 180 s, and an error shown from a 422.
- [ ] Handles and blocks work with the keyboard: arrow keys move by one Word or 0.1 s.
- [ ] Dragging previews live and saves on release.

## Comments
