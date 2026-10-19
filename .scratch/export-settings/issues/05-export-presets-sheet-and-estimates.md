# 05: The Export Presets sheet and size estimates

**Parent spec:** `../spec.md` (Solution "Choosing a Preset when rendering"; Implementation Decisions "API" and "Frontend": the sheet, the estimate; "MCP"); GLOSSARY (Export Preset).

**What to build:** I can make, edit, delete and choose the default Export Preset, and I see how big the files will be.
- **API:**
  - `POST /export-presets` (`{name, settings}`).
  - `PUT /export-presets/{id}` and `DELETE /export-presets/{id}`. Both are 409 for a built-in.
  - `PUT /export-presets/default` (`{preset_id}`).
  - Deleting the default makes "Shorts / TikTok / Reels" the default.
  - Settings off the lists are 422.
- **`POST /export-presets/estimate`** takes `{settings, secs, fps}` and returns bytes, from 01's rules. The formula lives only in the backend.
- **"Export Presets…"**, the Render menu's last item, opens a sheet: the Presets on the left, the picked one's form on the right.
  - **Name.**
  - **Codec:** "plays everywhere", "half the size", "smallest, slower". One this Mac can't encode is disabled, marked "not on this Mac".
  - **Resolution:** with "Larger than the Source" above the Source's effective height (shown when opened from a Job).
  - **Frame rate:** Same as Source, then the list.
  - **Quality tiers:** each with its MB per minute, at 30 fps for Same as Source.
  - **A collapsed Advanced section:** VBR or CBR, and kb/s.
  - **Loudness:** −14 LUFS, −16 LUFS or Off.
  - Built-ins are read-only, with "Duplicate". The owner's have Save, Delete and "Make default".
- **The Render menu** shows the batch's estimated total for the picked Preset, from the Candidates' durations.
- **MCP:**
  - `list_presets(kind="export")` gives settings, the default and the available codecs.
  - `save_preset(kind="export", preset={name, settings}, preset_id=None, use_as_default=False)`.
  - `delete_preset(preset_id, kind="export")`.
  - Refusals are clear tool errors.

**Blocked by:** 04

**Status:** done

- [x] A built-in Preset can't be changed or deleted (409). Duplicating one makes an editable copy.
- [x] Deleting the default makes "Shorts / TikTok / Reels" the default.
- [x] An unknown codec, an off-list resolution or fps, or kbps out of range is refused (422, and an MCP tool error).
- [x] The estimate endpoint matches 01's rules. The sheet's per-minute figures and the menu's total use it.
- [x] A codec missing from ffmpeg is listed as unavailable and disabled in the sheet.
- [x] `save_preset(kind="export", use_as_default=True)` makes the new Preset the default, and `render_clips` without an id uses it.
- [x] Vitest: the sheet's form for a built-in is read-only, and "Larger than the Source" appears above the Source's height.

## Comments

**2026-10-19, agent:** Built.
- **Store** (`app/export_presets.py`): `ExportPresetStore` gains `create`, `change` (name and settings, both given: PUT replaces), `delete` and `use_as_default`, as `TextPresetStore` does (a lock, `write_atomic`); `BuiltinExportPreset` for a built-in. No listeners: nothing follows the Presets live (the sheet reloads the list after each change).
- **API**: `POST /export-presets` (201) and `PUT /export-presets/{id}` take `ExportPresetBody {name, settings}` (extra fields refused; ExportSettings' own validation gives the 422s, and a settings field left out takes the "Shorts / TikTok / Reels" value); `DELETE` (204); all 409 for a built-in, 404 for an unknown one. `PUT /export-presets/default` takes `{preset_id}` (404 unknown). Each answers the Preset. `POST /export-presets/estimate` takes `{settings, secs (0..86400), fps (>0, the Source's)}` and answers `{bytes}` from `estimated_bytes`, at the settings' own fps when they have one.
- **MCP**: `list_presets(kind="export")` answers `GET /export-presets` as it is (presets with settings, `default`, `available`). `save_preset(kind="export", preset={name, settings}, preset_id, use_as_default)`: with a `preset_id`, the fields given change (settings merged per field) and the rest stay; a built-in's preset_id alone with use_as_default makes it the default. `delete_preset(kind="export")`. Refusals are the API's messages as tool errors. `TextPresetGiven` became `NamedPresetGiven` (name, style, settings) to keep the schema small. `_clip_view` now shows a queued Clip's `export_preset_id` too (the one asked for), so `render_clips` says which Preset it queued with. TOOLS_BUDGET_BYTES 69_250 -> 69_700 (69_612 now): 07 and 08 will need to raise it again.
- **Editor**: `pages/job/ExportPresetsSheet.tsx`, a `<dialog>` opened by the Render menu's last item "Export Presets…" (`RenderButton`'s `onManage`), owned by `JobView`. The Presets on the left (the default marked), the picked one's form on the right: Name; Codec, Resolution and Quality as radio rows with a note each (the codec's description or "not on this Mac", disabled; "Larger than the Source"; "N MB per minute"); Frame rate as a select (Same as Source, then the list); a collapsed Advanced `<details>` with Bitrate "From the quality" / VBR / CBR and kb/s (a bitrate of its own starts at the tier's target, read back from its estimate); Loudness −14 / −16 / Off. A built-in's form is a disabled `<fieldset>`, with Duplicate and Make default; the owner's add Save and Delete (confirmed). Duplicate saves "<name> copy" at once and shows it.
- **Decision: "the Source's effective height" is its short side** (`sourceHeight`: the 1080 of a 1080p video, landscape or portrait), compared with the resolution, which is the frame's short side. The note shows only when the sheet has a Job's Source.
- **Decision: "Make default" is offered on built-ins too** (the API allows it), so that the owner can go back to "Shorts / TikTok / Reels" without deleting their own.
- **The Render menu** says "About N MB with <Preset>" for the picked Preset, asked of the estimate endpoint while the menu is open: Review's "Render selected" for the selected Candidates, a Clip card's for its Candidate. The batch's length (`batchSecs`) is each Candidate's Main Track less its Transitions' overlaps; Same as Source is sized at the Source's fps.
- Tests: `backend/tests/test_export_presets.py` (made, changed, deleted, read after a restart; 409 built-in and the duplicate editable; the default chosen and back to Shorts once deleted; 422 for an unknown codec, off-list resolution/fps/loudness, kbps out of range, an empty name or an extra field; the estimate per 01's rules; a codec whose encoders ffmpeg lacks isn't `available`), `test_mcp.py` (list/save/default/delete, `render_clips` without an id uses the new default, the refusals), `frontend/src/pages/job/ExportPresetsSheet.test.tsx` (a built-in's form read-only with Duplicate and no Save/Delete; the owner's actions; "Larger than the Source" by 1440 and 4K over a 1080 Source, and not without one; AV1 disabled "not on this Mac"; "Export Presets…" last in the menu; the batch's length). The sheet was checked in markup, not in a browser.
