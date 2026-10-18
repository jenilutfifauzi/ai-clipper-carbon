# 07: Save frame as PNG

**Parent spec:** `../spec.md` (Solution "Save frame"; Implementation Decisions "API": frame, export file names, the Media Library; "MCP"; "Frontend"); GLOSSARY (Export file); docs/adr/0021-export-presets-and-a-plan-drawn-at-any-size.md.

**What to build:** I save the frame at the playhead as a PNG, exactly as the render would draw it.
- **`POST /jobs/{job}/candidates/{id}/frame`** takes `{at, draft?, export_preset_id?}`, where `at` is in Timeline time and `draft` has the same shape as the Preview Plan's.
  - It plans the draft as the Preview Plan does: cached analysis only, the same fallbacks.
  - It renders the one frame at `at` through the render's filter graph, at the Preset's resolution (the default Preset's when none is given).
  - It writes `<candidate>-<mm.ss.ff>.png` to the Job's `exports/`, overwriting the same name, and returns its path and a download URL.
  - It is synchronous, outside the render queue. The Job's status doesn't change.
  - Retimed copies are made when needed.
- **`exports/`** goes with the Job when it is deleted.
- **"Save frame"** is in the Advanced Edit (toolbar or menu) and in the clip editor's preview actions.
  - It posts the draft and the playhead, shows a spinner, and downloads the PNG named after the Candidate's title and the time.
  - "Save frame to Media Library" also adds it as an image, through the existing upload path.
- **MCP:** `save_frame(job_id, candidate_id, at, export_preset_id=None)` uses the saved Revision and returns `{path}`.

**Blocked by:** 02, 04

**Status:** ready-for-agent

- [ ] The PNG has the Preset's size (720×1280 with "Small"), and the default Preset's size without one.
- [ ] It shows a Text Layer of the draft that isn't saved, at its planned place.
- [ ] Its caption, hook and a Shape match a rendered Clip's frame at the same time, within a small pixel tolerance.
- [ ] The Job's status and its render queue are unchanged by it.
- [ ] Saving it to the Media Library makes an image item that can be added as an Overlay.
- [ ] `save_frame` returns a path to a PNG that exists on this Mac.
