# 08: Hold to see the original, and Compare render

**Parent spec:** `../spec.md` ("Compare render", "Preview"); GLOSSARY "Compare render".

**What to build:** two checks for the owner, on the Advanced Edit's player.

**Hold to see the original:** a button that drops every Grade filter (and, once 04 and 07 are in, the Candidate's and the Adjustment Layers') while it is held.

**Compare render:** while the preview is paused, a button asks the server for one frame. The server renders it at the playhead through the render path, for the saved Candidate or the unsaved draft, as the Preview Plan endpoint takes one, and returns a PNG. The frame is not kept as an Export file; the endpoint reuses `save_frame`'s drawing path.
- The PNG is shown over the player under a draggable split line: preview on the left, render on the right.
- It is cleared on any playhead move or edit.
- It is desktop only.

**Blocked by:** 01.

**Status:** done

- [x] **Endpoint:** it returns a full 1080×1920 PNG matching the rendered frame at that time, for a saved Candidate and for a draft, and keeps nothing in the Job.
- [x] **Editor (vitest):**
  - The compare frame clears on a playhead move and on an edit.
  - Holding the original button removes the Grade filters, and releasing restores them.

## Notes

Backend: `POST /api/jobs/{job}/candidates/{candidate}/compare-frame` (`CompareRequest`: `at`, optional
`draft` as the Preview Plan takes it) returns `image/png` (`Cache-Control: no-store`), drawn at
1080x1920 at the frame rate its Clip renders at (the Clip's Export Preset as it is now, else the
default's, `get_or_default`; review fix: it was always the Source's) by `draw_frame` (export_files.py), the
drawing `save_frame` now calls too, into a system temp folder deleted before answering: nothing in
the Job's folder changes. No MCP tool. Tests: backend/tests/test_compare_render.py (matches the
rendered Clip's frame, Candidate Grade, hook and Shape included; the Job's files unchanged; a draft's
Grade drawn as save_frame draws it, unsaved).

Frontend: one flag, `ShowOriginal` / `useOriginal` / `useGradeFilter` (GradeFilters.tsx), read by
`DecksGraded`, `GradeVignette`, `PicturePanel`, the media and copied Segments and `AdjustedStack`;
the Advanced Edit wraps its player in it. `CompareRender` (editor/compareRender.ts) is an external
store: requested while paused at the playhead, cleared (aborted, blob URL revoked) on a playhead
move, skim or play (`watch`) and on a draft change (`edited`, the draft's JSON). `holdHandlers`
holds on pointer down (captured) and Space/Enter (repeats ignored, stopped so Space doesn't play),
lets go on up, cancel, lost capture or blur. advanced/PlayerChecks.tsx: `HoldOriginalButton` (in
the player bar on desktop and phone), `CompareButton` (desktop only, off while playing, spinner
while loading, toggles), `CompareSplit` laid over the stage through ClipPreview's new `over` prop
(render right of a draggable, arrow-key-movable split line; notes for loading and failure; close).
Tests: editor/compareRender.test.tsx.
