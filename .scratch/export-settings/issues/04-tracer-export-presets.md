# 04: Tracer: Export Presets from the Render menu to the Clip card

**Parent spec:** `../spec.md` (Solution; Implementation Decisions "Model", "API", "MCP", "Frontend": the Render button, the Clip card); GLOSSARY (Export Preset, Export Settings, Clip); docs/adr/0021-export-presets-and-a-plan-drawn-at-any-size.md.

**What to build:** I pick an Export Preset on the Render button, the batch renders with it, and each Clip card says what it was made with.
- **Export Presets** are `{id, name, builtin, settings}`.
  - The built-ins are data files shipped with the app, following the Text Presets' pattern:
    - "Shorts / TikTok / Reels": H.264, 1080, Same as Source, Recommended, −14. The default.
    - "Small": H.264, 720, Smallest, −14.
    - "High quality": HEVC, 1440, High, −14.
    - "Archive": HEVC, 2160, High, loudness off.
  - The owner's Presets and the default's id live in one JSON file in the data directory. It is empty at first, with the default "Shorts / TikTok / Reels".
- **`GET /export-presets`** lists them, with `default` and the `available` codecs.
- **`POST /jobs/{id}/render`** takes an optional `export_preset_id` (the default when left out; 422 for an unknown one).
  - The Clip keeps the Preset of its latest request, and the latest request wins.
  - The worker renders with that Preset's settings as they are when the render starts.
- **`RenderedClip`** records `export_preset_id`, `export` (a copy of the settings, for display) and `bitrate_fallback`.
- **Staleness is unchanged:** Export Settings are never compared.
- **The Render button** (Review, Clips, Advanced Edit) becomes a split button.
  - Its menu lists the Presets, with the default marked and picked.
  - The pick is kept for the page's session.
- **"Render again"** on a Clip uses that Clip's Preset, or the default once it is deleted. Its menu can pick another.
- **The Clip card** shows a settings line: "1080p · H.264 · Recommended · −14 LUFS · Shorts / TikTok / Reels", plus "CBR fell back to VBR" when relevant.
  - A Clip rendered before Presets shows "1080p · H.264".
- **MCP:**
  - `render_clips(job_id, candidate_ids=None, export_preset_id=None)`.
  - `list_clips` shows each Clip's `export` and `export_preset_id`.
  - Tool descriptions say Export Settings never make a Clip stale.

**Blocked by:** 02, 03

**Status:** done

- [x] Rendering with "Small" gives a 720×1280 Clip with "Small" on its card. Rendering again with the default gives 1080×1920 and replaces it.
- [x] A Candidate queued with one Preset and asked again with another renders with the latest.
- [x] A Clip rendered before Presets reads, shows "1080p · H.264", and renders again with the default.
- [x] Rendering with a different Preset never makes any Clip "Changed since this render".
- [x] `render_clips` with `export_preset_id` records it on the Clip, and `list_clips` shows it. An unknown id is a clear tool error.
- [x] Vitest:
  - the Render menu picks the default;
  - "Render again" picks the Clip's Preset, or the default once it's gone;
  - the card's settings line, including the legacy one.

## Comments

**2026-10-19, agent:** Built.
- **Store** (`app/export_presets.py`, new): `ExportPreset(id, name, settings, order, builtin)`, read through pydantic (so `ExportSettings`' 422s apply). The built-ins are `backend/assets/export-presets/*.json` (`EXPORT_PRESETS_DIR` in config): `shorts` (the default, `DEFAULT_EXPORT_PRESET`), `small`, `high-quality`, `archive`, each giving every setting (a file that leaves one out, or has an unknown field, is refused). `ExportPresetStore(DATA_DIR/export-presets.json)` reads `{default, presets}` (the `_Saved` shape Text Presets use): `all()`, `get()`, `default()` (the chosen one, or `shorts` once it is gone) and `get_or_default(id)` (what a Clip asked for is rendered with). It has no writes yet: 05 adds `create`/`change`/`delete`/`use_as_default` as `TextPresetStore` does (lock, `write_atomic`, and listeners if the sheet wants live updates). `Renders.export_presets` is the one store; `app.state.export_presets` is the same object.
- **API**: `GET /export-presets` → `{presets: [{id, name, settings, order, builtin}], default, available}` (`available` from `available_codecs`, in Codec order). `POST /jobs/{id}/render` takes `export_preset_id` (default when left out; 422 "No Export Preset <id>"), resolved when queued.
- **Model**: `Clip.export_preset_id` is the Preset of the latest request: a queued Clip asked again takes the new one; a rendering one keeps it for the render after (`finish` carries `now.export_preset_id`). The worker reads the Preset as it is when the render starts, the default once deleted. `RenderedClip` gains `export_preset_id` (as asked; the default's id for a Clip queued before Presets), `export` and `bitrate_fallback`. Stored Clips read without a migration. Staleness is untouched.
- **MCP**: `render_clips(..., export_preset_id=None)`; `list_clips` adds `export_preset_id` and `export`; descriptions say Export Settings never make a Clip stale. TOOLS_BUDGET_BYTES raised 69_000 → 69_250 (the new parameter was about 90 bytes over): 05, 07 and 08 will need to raise it again.
- **Editor**: `RenderButton` (`pages/job/RenderButton.tsx`) is a split button: the main part renders with the picked Preset; the chevron opens a popover menu (the pattern of TextPresets' menu) with the Presets as `menuitemradio`, the default marked "Default", and choosing one renders with it. Without the list (loading or failed) it is a plain button that renders with the default. `exportPresets.ts`: `pickedPreset`, `againPreset` and `settingsLine`. The list and the session pick live in `JobView` (Review remounts on a Job reload); "Render selected" sets the pick, a card's menu doesn't. The Clip card shows the settings line ("4K" for 2160, "N fps" when chosen, "VBR/CBR N kb/s" for a bitrate of its own, "Loudness off", the Preset's name only while it exists) and " · CBR fell back to VBR".
- **Decision: "Render again" is shown on every Clip that isn't queued or rendering**, not only a changed or failed one, so that a Clip can be rendered with another Preset from its menu.
- **Not done: the Advanced Edit has no render action today** (nor CandidateList), so only Review's "Render selected" and the Clip cards' buttons became split buttons. The menu's batch estimate and "Export Presets…" item are 05's.
- Tests: `backend/tests/test_export_presets.py` (the built-ins and default; Small gives 720×1280 and the default replaces it with 1080×1920; an unknown id is 422 with nothing queued; a queued Candidate asked again renders with the latest, and its Revision is unchanged; a Preset as it is when the render starts, and the default once deleted; a Clip from before Presets reads and renders again with the default), `test_mcp.py` (render_clips' `export_preset_id`, list_clips, an unknown id's tool error) and `frontend/src/pages/job/exportPresets.test.tsx` (the menu's default pick and markup, Render again's Preset and fallback, the settings line including the legacy one). The menu was checked in markup, not in a browser.


**2026-10-19, agent:** Review fixes.
- A rendered Clip's `RenderedClip.export_preset_id` is now the Preset it was actually made with (`get_or_default`'s), so the default's id once the asked-for one was deleted, not the deleted id (`test_export_presets.py` asserts "shorts").
- `api.py` has one `_export_preset(store, id)` (the default for None, 422 "No Export Preset <id>"), used by the render, frame and audio routes; the render route resolves it before queueing.
- `render_clips`' and `save_preset`'s descriptions say Export Settings never make a Clip stale (within the existing TOOLS_BUDGET_BYTES).
