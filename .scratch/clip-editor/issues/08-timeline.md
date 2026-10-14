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

**Status:** done

- [x] Trim follows the Transcript Picker's rules: the start before the end, at most 180 s, and an error shown from a 422.
- [x] Handles and blocks work with the keyboard: arrow keys move by one Word or 0.1 s.
- [x] Dragging previews live and saves on release.

## Comments

**2026-10-14: done.** `npm run typecheck` and `npm run build` pass. Checked in a browser on the scratch clone.

Built:
- **`editor/Timeline.tsx`:**
  - **Frame.** The clip with 10 s of the Source each side, at 1×–8× zoom with horizontal scroll and sticky track labels. The ruler's ticks are 1–60 s apart (whatever leaves room for labels), and clicking it seeks. The playhead follows `Playback`.
  - **Clip track:** two `role="slider"` handles.
    - Dragging snaps to the nearest Word start (start) or end (end) that keeps a clip: start before end, at most 180 s.
    - ←/→ move a handle one Word edge.
    - The trim is a live draft (the Preview Plan is asked with the draft's `start`/`end`) and is saved on release through `PATCH`. A 422 shows in Review's banner.
  - **Captions track:** a block per caption event. Clicking one seeks there and opens its Word in `CaptionTextEditor` (`focus`).
  - **Hook track:** a draggable block (moves `hook_start`) with a right-edge resize grip (`hook_secs`), kept in the Clip, 0.5–30 s, in 0.1 s steps. ←/→ move it and Shift+←/→ resize it.
  - **Scenes:** a `scenes` render prop, for ticket 09's track.
- **`editor/useDraftSave.ts`:** a draft shown at once and saved after 700 ms, or on leaving the Candidate. Hook timing now lives in `CandidateEditor` through it, so `HookEditor`'s sliders and the timeline's hook block edit one value.

**Bugs found in the browser and fixed:**
- **The view rescaled during a drag.** It was framed on the draft range, so a drag of 5 s landed 8 s away. It is now framed on the saved range.
- **A drag back to its draft position wasn't saved.** The release was compared with the draft, not with where the drag began.

**Browser check** (2f6cdf1b):
- Dragging the end 3 s right saved `end 1581.539` (the end of "tetap"), confirmed against the Transcript.
- Dragging the hook about 1 s saved `hook_start 1.8`.
- → on the start handle saved the next Word's start with its lead-in (1560.179).
- Clicking the "APA" caption block opened "Word at 26:06.1, heard as “apa”".
