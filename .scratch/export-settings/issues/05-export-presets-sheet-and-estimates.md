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

**Status:** ready-for-agent

- [ ] A built-in Preset can't be changed or deleted (409). Duplicating one makes an editable copy.
- [ ] Deleting the default makes "Shorts / TikTok / Reels" the default.
- [ ] An unknown codec, an off-list resolution or fps, or kbps out of range is refused (422, and an MCP tool error).
- [ ] The estimate endpoint matches 01's rules. The sheet's per-minute figures and the menu's total use it.
- [ ] A codec missing from ffmpeg is listed as unavailable and disabled in the sheet.
- [ ] `save_preset(kind="export", use_as_default=True)` makes the new Preset the default, and `render_clips` without an id uses it.
- [ ] Vitest: the sheet's form for a built-in is read-only, and "Larger than the Source" appears above the Source's height.
