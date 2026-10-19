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

**Status:** done

- [x] The PNG has the Preset's size (720×1280 with "Small"), and the default Preset's size without one.
- [x] It shows a Text Layer of the draft that isn't saved, at its planned place.
- [x] Its caption, hook and a Shape match a rendered Clip's frame at the same time, within a small pixel tolerance.
- [x] The Job's status and its render queue are unchanged by it.
- [x] Saving it to the Media Library makes an image item that can be added as an Overlay.
- [x] `save_frame` returns a path to a PNG that exists on this Mac.

## Comments

**2026-10-19, agent:** Built.
- **Renderer** (`app/renderer.py`): `Renderer.frame(source, plan, at, still, logo, files, pictures, export)` writes one PNG through the render's own graph (`_command(..., still_at=)`): the same inputs, Scenes, Overlays, Logo, ASS script and picture layers, drawn at `scaled_plan(plan, output_size(export))`, ending `format=yuv420p,select=...,trim=end_frame=1` into a PNG instead of the encode and poster; no sound, no loudness pass. What both draw with (the scaled plan, the scripts and Faces, the keyed items) moved into a `_drawing` context manager that `render` uses too. `shown_frame(at, fps, duration)` is the frame shown at the playhead (the last that starts by then, inside the Clip); the select is half a frame before it, so a rounded timestamp still picks it.
- **Inputs** (`app/rendering.py`): `drawing_inputs(plan, export, job_dir, source, settings, media, logos, progress)` gives the plan reading Retimed copies (made when needed), the Logo, the media files and the picture layers' pictures at the export's size (`picture_layouts` first). `Renders._render` uses it unchanged in behaviour.
- **Export files** (`app/export_files.py`, new): `EXPORTS_DIR = "exports"`, `frame_name` (`<candidate>-<mm.ss.ff>.png`, ff the frame within its second at the plan's fps) and `save_frame`, which draws with a `Renderer` of its own (synchronous, outside the render queue; the Job's status and Clips aren't touched). exports/ is in the Job's directory, so it goes with the Job.
- **API**: `POST /jobs/{job}/candidates/{id}/frame` `{at, draft?, export_preset_id?}` → `{file: "exports/<name>.png", url: "/media/<job>/exports/<name>.png"}` (the existing media route serves it). The draft is planned by the Preview Plan's code (`_draft_plan`, shared with the preview-plan route: cached analysis only, the same fallbacks, the same 404/409/422s), at the Preset's frame rate (`preview_plan(..., fps=)`; the Preview Plan itself still passes none). 422 "No Export Preset <id>" for an unknown Preset.
- **MCP**: `save_frame(job_id, candidate_id, at, export_preset_id=None)` posts without a draft (the saved Revision) and returns `{path}`, absolute. TOOLS_BUDGET_BYTES 69_250 → 69_850.
- **Editor**: `SaveFrameButton` (`pages/job/editor/SaveFrameButton.tsx`): a menu ("Save frame", "Save frame to Media Library") in the Advanced Edit's top bar (icon) and under the clip editor's preview. It posts the draft and the playhead, spins while it works, downloads the PNG as `<title>-<mm.ss.ff>.png` (`saveFrame.ts`: `frameFileName`, `shownFrame` as the backend's), and for the Media Library uploads that file through the image upload path (the Advanced Edit's own `library.upload`, so it appears in its Media tab with progress; the clip editor's `uploadMedia`). Checked by typecheck and unit tests, not in a browser.
- **Decision:** the frame is planned at the Preset's frame rate (as its render would be), not the Source's as the Preview Plan is; with "Same as Source" they are the same.
- Tests: `backend/tests/test_save_frame.py` (Small gives 720×1280 and the default 1080×1920, overwriting the same name; served at its URL; Job stays in review with no Clips; unknown Preset 422, unknown Candidate 404; exports/ removed with the Job; an unsaved draft's Text Layer changes only pixels inside its planned bounds, and green, the Candidate unchanged; with a hook, captions and a Shape, frames at 0.4 s and 1.2 s match the rendered Clip's frames within encoding noise; the PNG uploaded to the Media Library is a 1080×1920 image an Overlay can use), `test_mcp.py` (`save_frame`'s path exists, its name, the Job's status, an unknown Preset), `frontend/src/pages/job/editor/saveFrame.test.ts` (file names, fractional rates, clamping, unsafe characters).

**2026-10-19, agent:** Review fixes.
- One Export file shape: `POST .../frame` now returns `SavedExport` `{path (absolute), name, url (?v=<mtime>, since the name is reused)}`, as `.../audio` does; `save_frame` returns the Path. The MCP's `save_frame` returns `{"path": saved["path"]}`.
- `app/saved_audio.py` merged into `app/export_files.py`: one EXPORTS_DIR, `SavedExport`/`saved_export`, and one `_written` tail (the exports/ folder and a Renderer of its own) for both.
- The frame's download name comes from the backend (ADR 0001): `saveFrame.ts` no longer has `shownFrame` or the mm.ss.ff maths; `frameFileName(title, candidateId, saved)` puts the title in place of the id in the backend's `name`. This fixes the clip editor naming the frame at the Source's fps while the backend drew it at the default Preset's. `SaveFrameButton` lost its `fps` and `duration` props.
- One filename sanitiser: `fileTitle` in `format.ts` (also strips control characters), used by `downloadName` (MP4, audio) and the frame's name; an empty title falls back to `clip-<id>` as the other downloads do.
