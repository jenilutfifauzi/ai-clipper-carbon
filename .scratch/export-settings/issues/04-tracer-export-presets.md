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

**Status:** ready-for-agent

- [ ] Rendering with "Small" gives a 720×1280 Clip with "Small" on its card. Rendering again with the default gives 1080×1920 and replaces it.
- [ ] A Candidate queued with one Preset and asked again with another renders with the latest.
- [ ] A Clip rendered before Presets reads, shows "1080p · H.264", and renders again with the default.
- [ ] Rendering with a different Preset never makes any Clip "Changed since this render".
- [ ] `render_clips` with `export_preset_id` records it on the Clip, and `list_clips` shows it. An unknown id is a clear tool error.
- [ ] Vitest:
  - the Render menu picks the default;
  - "Render again" picks the Clip's Preset, or the default once it's gone;
  - the card's settings line, including the legacy one.
