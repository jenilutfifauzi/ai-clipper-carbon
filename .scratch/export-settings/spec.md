# Export settings at parity with Concat: Export Presets, a saved frame and the sound alone

Status: ready-for-agent
Created: 2026-10-18

## Problem Statement

Every Clip is encoded the same way: H.264 at 1080×1920, at the Source's frame rate, about 8 Mb/s, with its loudness normalized to −14 LUFS. I can't make a smaller file for a quick review, a sharper 1440p or 4K one, an HEVC one at half the size, or an archive copy left at its own loudness. I can't pick a frame rate, and nothing tells me how big the files will be or how long a render has left.

I also can't save a still of the frame I'm looking at (for a thumbnail, or to put back into the edit as an image), and I can't save a Clip's sound on its own (for a podcast feed or an audiogram).

Concat's export sheet does all of the encoding part. Concat keeps no presets, though, so the same choices have to be made again every time. That doesn't work when Selection hands me twenty Candidates per Job.

## Solution

- **Export Presets.** Export Settings (codec, resolution, frame rate, quality and loudness) live in named, global Export Presets.
  - Four are built in: "Shorts / TikTok / Reels" (the default), "Small", "High quality" and "Archive".
  - I can save my own, rename them, delete them and pick the default.
- **Choosing a Preset when rendering.** The Render button has a Preset menu, with the default picked, and the Preset applies to the whole batch.
  - The menu shows the batch's estimated size.
  - Its last item, "Export Presets…", opens a sheet where Presets are made and edited. Each quality tier there shows its size per minute.
- **One Clip per Candidate, as now.** Each Clip card shows what it was rendered with, such as "1080p · H.264 · Recommended · Shorts / TikTok / Reels".
  - "Render again" uses the same Preset.
  - Changing Export Settings never marks a Clip "Changed since this render".
- **Every size is sharp.** The edit is still composed on a 1080×1920 frame, but the render draws it at the chosen size. Captions, the hook, Text Layers and Shapes stay sharp at 1440p and 4K.
- **The frame rate changes the render.** A Preset can keep the Source's frame rate or choose 23.976–60. Cuts, Transitions and animations land on the output's frames.
- **Time remaining.** While a Clip renders, its progress line shows the time left.
- **Save frame.** In the clip editor and the Advanced Edit, this saves the frame at the playhead as a PNG, exactly as the render would draw it, at the default Preset's resolution. The browser downloads it, and I can also add it to the Media Library.
- **Save audio.** This saves a Candidate's mix on its own as WAV or M4A, at a Preset's loudness.
- **The agent can do all of it through MCP:** pick a Preset when rendering, manage Presets, save a frame and save the audio.

## User Stories

1. As the owner, I want to render a batch of Candidates with an Export Preset I pick from the Render button, so that I don't set codec, resolution and quality one Clip at a time.
2. As the owner, I want the default Export Preset already picked in that menu, so that one click renders as usual.
3. As the owner, I want a built-in "Shorts / TikTok / Reels" Preset (H.264, 1080p, Same as Source, Recommended, −14 LUFS) as the default, so that new installs render as they did before.
4. As the owner, I want a built-in "Small" Preset (H.264, 720p, Smallest, −14 LUFS), so that I can send quick review copies over chat.
5. As the owner, I want a built-in "High quality" Preset (HEVC, 1440p, High, −14 LUFS), so that I can upload sharper versions where the platform keeps them.
6. As the owner, I want a built-in "Archive" Preset (HEVC, 4K, High, loudness off), so that I keep a master that I can edit again elsewhere.
7. As the owner, I want built-in Presets to be unchangeable and undeletable, so that I always have a known-good starting point.
8. As the owner, I want to save my own Export Preset, starting from any existing one, so that I can make a variant without retyping it.
9. As the owner, I want to rename and delete my own Presets, so that the menu stays tidy.
10. As the owner, I want to make any Preset the default, so that one-click renders use what I usually want.
11. As the owner, I want the default to go back to "Shorts / TikTok / Reels" when I delete my default Preset, so that there is always a default.
12. As the owner, I want to choose H.264, HEVC or AV1, so that I can trade compatibility for size.
13. As the owner, I want each codec described ("plays everywhere", "half the size", "smallest, slower"), so that I know what I'm trading.
14. As the owner, I want a codec this Mac's ffmpeg can't encode to be shown disabled, so that I don't pick one that will fail.
15. As the owner, I want H.264 and HEVC to use the Mac's hardware encoder when it works, and fall back to software when it doesn't, so that renders are fast and still succeed over SSH or in a VM.
16. As the owner, I want HEVC files to play in QuickTime and on iPhone, so that I can check them without other software.
17. As the owner, I want to choose 720p, 1080p, 1440p or 4K, so that I can trade size for sharpness.
18. As the owner, I want captions, the hook, Text Layers and Shapes to be sharp at 1440p and 4K, so that higher resolutions are worth choosing.
19. As the owner, I want every position and size in my edit to land in the same place at every resolution, so that a 720p Clip looks like a smaller 1080p one.
20. As the owner, I want a note when a resolution is larger than what the Source gives, so that I know the video itself won't get sharper.
21. As the owner, I want to keep the Source's frame rate ("Same as Source", the default) or choose 23.976, 24, 25, 29.97, 30, 50, 59.94 or 60, so that I can match a platform or a project.
22. As the owner, I want cuts, Transitions, Freeze frames and Text Layer or Shape animations to land on the output's frames at the chosen rate, so that a 60 fps Clip moves at 60 fps where it can.
23. As the owner, I want to choose High, Recommended or Smallest quality, so that I don't need to know about bitrates.
24. As the owner, I want each quality tier to show its estimated size per minute in the Preset sheet, so that I can choose with numbers.
25. As the owner, I want an Advanced section in a Preset with VBR or CBR and a bitrate in kb/s, so that I can meet a platform's exact upload rules.
26. As the owner, I want a Clip to record when CBR fell back to VBR on an encoder that can't do CBR, so that I'm not misled.
27. As the owner, I want to choose a loudness target of −14 LUFS, −16 LUFS or off, so that Clips fit social platforms, podcast apps, or are left as mixed.
28. As the owner, I want the Render menu to show the estimated total size of the batch with the picked Preset, so that I know what I'm about to fill my disk with.
29. As the owner, I want each Clip card to show the resolution, codec, quality and Preset it was rendered with, so that I can tell versions apart.
30. As the owner, I want a Clip rendered before Export Presets to show "1080p · H.264", so that old Clips don't look broken.
31. As the owner, I want "Render again" to use the Clip's Preset as it is now, so that improving a Preset improves the next render.
32. As the owner, I want "Render again" to use the default Preset when the Clip's Preset was deleted, so that it still works.
33. As the owner, I want changing or deleting a Preset never to mark Clips as changed, so that "Changed since this render" keeps meaning that my edit changed.
34. As the owner, I want a Candidate that is asked to render again with another Preset while queued to use the latest one, so that the last thing I asked for wins.
35. As the owner, I want to see the time left while a Clip renders, so that I know whether to wait.
36. As the owner, I want the time left to be rough ("almost done", "40s left", "2:10 left") and to appear only once there's enough progress to guess, so that it doesn't flicker wildly.
37. As the owner, I want to save the frame at the playhead as a PNG from the Advanced Edit, so that I can make a thumbnail.
38. As the owner, I want to save a frame from the clip editor too, so that I don't need to open the Advanced Edit for a still.
39. As the owner, I want the saved frame to show exactly what the render draws (captions, hook, Text Layers, Shapes, Overlays, Watermark), so that the thumbnail matches the Clip.
40. As the owner, I want the saved frame to show my unsaved draft as the preview shows it, so that I get what I'm looking at.
41. As the owner, I want the saved frame at the default Preset's resolution, so that a 4K default gives a 4K still.
42. As the owner, I want the PNG named after the Candidate's title and the time, so that saved stills are easy to find.
43. As the owner, I want to add the saved frame to the Media Library in the same step, so that I can use it as an image Overlay or an intro still.
44. As the owner, I want to save a Candidate's sound alone as WAV (48 kHz, 16-bit), so that I have a lossless mix.
45. As the owner, I want to save it as M4A (AAC 192k) too, so that I have a small file for a podcast feed.
46. As the owner, I want the sound alone to be the saved edit's mix (Clip sound, Music Clips, Overlay and media Segment sound, volumes, Keyframes and fades) at the chosen Preset's loudness, so that it matches the Clip's audio.
47. As the owner, I want saving a frame or the sound not to put the Job into rendering or wait behind other renders, so that a one-second still takes about a second.
48. As the owner, I want a saved frame or sound to use only analysis already done, falling back as the preview does, so that it never starts a long transcription.
49. As the owner, I want saved frames and sounds kept in the Job and removed with it, so that they don't pile up elsewhere.
50. As the agent, I want `render_clips` to take an `export_preset_id`, so that I can render with a Preset the owner asked for.
51. As the agent, I want `list_presets(kind="export")` to list Export Presets with their settings and which is the default, so that I can choose one.
52. As the agent, I want `save_preset(kind="export")` and `delete_preset(kind="export")` to manage the owner's Export Presets, and to make one the default, so that I can set up an export the owner describes.
53. As the agent, I want `save_frame(job_id, candidate_id, at, export_preset_id=None)` to return the path of a PNG on this Mac, so that I can make thumbnails.
54. As the agent, I want `export_audio(job_id, candidate_id, format, export_preset_id=None)` to return the path of a WAV or M4A on this Mac, so that I can hand off the sound.
55. As the agent, I want `list_clips` to show each Clip's Export Settings and Preset, so that I can report what was rendered.
56. As the agent, I want an Export Preset with impossible values (an unknown codec, a resolution off the list, a bitrate out of range) refused with a clear message, so that I can fix my call.
57. As the owner, I want an edit to an Export Preset refused when it targets a built-in one, so that the built-ins stay known-good.

## Implementation Decisions

**Model**

- **Export Settings** is a value type with these fields:
  - `codec`: `h264`, `hevc` or `av1`.
  - `resolution`: `720`, `1080`, `1440` or `2160`, the short side. The frame is 9:16, so these give 720×1280, 1080×1920, 1440×2560 and 2160×3840.
  - `fps`: `null` for Same as Source, or one of 23.976, 24, 25, 29.97, 30, 50, 59.94 and 60.
  - `quality`: `high`, `recommended` or `smallest`.
  - `bitrate`: optional, `{mode: vbr|cbr, kbps: 100–200000}`. It replaces the quality tier when given.
  - `loudness`: `-14`, `-16` or `null` for off.
- **Export Preset** is `{id, name, builtin, settings}`.
  - Built-ins are data files shipped with the app, one per Preset with a stable id, following the Text Presets' pattern.
  - The owner's Presets and the default's id are kept in one JSON file in the data directory, written atomically.
  - The default falls back to "Shorts / TikTok / Reels" when the chosen one is deleted.
- **RenderedClip gains:**
  - `export_preset_id`, the Preset it was rendered with (the default, when the one asked for was deleted before the render).
  - `export`, a copy of the Export Settings used, for display.
  - `bitrate_fallback`, true when CBR was asked for but the encoder did VBR.
  - Clips rendered before have none of these. They show "1080p · H.264" from the recorded encoder.
- **Clip** gains the Preset of its latest request, so the worker knows what to render. The latest request wins, as `requested_at` already does.
- **Clip** gains `started_at` while it renders, so that the time left can be worked out.
- **Staleness is unchanged:** another Revision, or another resolved style. Export Settings are never compared (ADR 0021).
- **`RenderTuning`** keeps only what isn't a choice: encoder order per codec, keyframe interval, audio rate, true peak, loudness range, Blur's parameters and the poster time. The bitrates, CRF and loudness move into the encoding rules below.

**Encoding rules (a pure module)**

- From Export Settings and a frame rate, it gives:
  - the output's pixel size;
  - the target video bitrate;
  - per encoder, the ffmpeg codec arguments;
  - the estimated bytes for a duration.
- **Target bitrate** is 16, 8 or 4 Mb/s for High, Recommended or Smallest, at 1080p and 30 fps. It is scaled by the output's pixels over 1080×1920's, by the fps over 30 (a slower rate counts as 30, so 24 and 25 fps keep today's 8 Mb/s), and by the codec: H.264 1, HEVC 0.6, AV1 0.5. A given `bitrate` replaces it.
- **Encoder order and arguments:**
  - H.264: `h264_videotoolbox`, then `libx264`.
  - HEVC: `hevc_videotoolbox`, then `libx265`, tagged `hvc1`.
  - AV1: `libsvtav1` only.
  - VideoToolbox encodes at the target as its average bitrate.
  - libx264 and libx265 use CRF 16, 20 or 26 with a maxrate of 1.5× the target. SVT-AV1 uses its CRF equivalent and the same cap.
  - CBR sets bitrate, minrate and maxrate equal (bufsize the bitrate) on the software encoders. VideoToolbox falls back to VBR, and that is recorded.
- **Estimated bytes** = (target video bitrate + 192 kb/s audio) × duration / 8.
- **Which encoders exist** is checked once per process from ffmpeg's encoder list and cached. A codec with none is reported as unavailable.

**Planner and renderer**

- **The Render Plan stays in 1080×1920 output pixels** (ADR 0021).
- **The planner takes the frame rate to plan at.** The render passes the export's rate, or the Source's for Same as Source. The Preview Plan always passes the Source's. Everything that snaps to frames uses it.
- **The renderer takes the output size** and draws the plan at it, with every coordinate and size it writes multiplied by one factor (height / 1920):
  - Scene panels, crops and Blur's background;
  - Overlays, media Segments and Manual Framings with their Keyframes;
  - Transitions' geometry;
  - the ASS script for captions and the hook, made at the output size so libass draws it sharp;
  - the Watermark and its Logo;
  - picture layers, rasterised at the output size, and their placement.
- **Pictures cached by hash** (Text Layers, Shapes) include the scale in their key, so a 4K picture and a 1080 one don't collide.
- **Loudness:** the two-pass loudnorm runs at the Preset's target. With `null`, no loudnorm runs and the mix is kept as it is (still resampled to 48 kHz).
- **The poster** stays a JPEG of the Clip's frame, at the Clip's size.

**API**

- **Export Presets:**
  - `GET /export-presets` lists the built-ins, then the owner's, each with its settings, `default` set on one, and `available` codecs.
  - `POST /export-presets` creates one; its body is `{name, settings}`.
  - `PUT /export-presets/{id}` replaces one; this is 409 for a built-in.
  - `DELETE /export-presets/{id}` deletes one; this is 409 for a built-in.
  - `PUT /export-presets/default` sets the default; its body is `{preset_id}`.
- **`POST /export-presets/estimate`** takes `{settings, secs, fps}` and returns bytes. It serves both the sheet's per-minute figures and the Render menu's total, so the formula lives only in the backend.
- **`POST /jobs/{id}/render`** takes an optional `export_preset_id`, which defaults to the default Preset. An unknown id is 422.
- **`POST /jobs/{job}/candidates/{id}/frame`** takes `{at, draft?, export_preset_id?}`, where `at` is in Timeline time and `draft` has the same shape as the preview-plan draft.
  - It plans the draft as the Preview Plan does: cached analysis only, the same fallbacks.
  - It renders the one frame at `at` through the render's filter graph, at the Preset's resolution (the default Preset's when none is given).
  - It writes the PNG to the Job's `exports/` and returns its path and a download URL.
  - It is synchronous, and the Job's status doesn't change.
- **`POST /jobs/{job}/candidates/{id}/audio`** takes `{format: wav|m4a, export_preset_id?}`.
  - It renders the saved Revision's audio graph alone, at the Preset's loudness, and writes it to `exports/`.
  - It is synchronous, and Retimed copies are made when needed.
- **Export file names:**
  - A frame is `<candidate>-<mm.ss.ff>.png`.
  - The sound is `<candidate>.wav` or `<candidate>.m4a`.
  - The same name is overwritten.
  - The browser download is named after the Candidate's title.
- **Adding a frame to the Media Library** reuses the image upload path with the PNG in `exports/`. No new kind of media item is needed.

**MCP**

- `render_clips(job_id, candidate_ids=None, export_preset_id=None)`.
- `list_presets(kind="export")` returns the Presets with their settings, the default, and the available codecs.
- `save_preset(kind="export", preset={name, settings}, preset_id=None, use_as_default=False)`.
- `delete_preset(preset_id, kind="export")`.
- `save_frame(job_id, candidate_id, at, export_preset_id=None)` uses the saved Revision and returns `{path}`.
- `export_audio(job_id, candidate_id, format="wav", export_preset_id=None)` returns `{path}`.
- `list_clips` adds each Clip's `export` settings and `export_preset_id`.
- Tool descriptions state that Export Settings never make a Clip stale.

**Frontend**

- **The Render button** (Review, Clips and the Advanced Edit's render action) becomes a split button.
  - The main part renders with the picked Preset.
  - The menu lists the Presets, marking the default, and shows the batch's estimated total, with "Export Presets…" as the last item.
  - The pick is kept for the page's session. A new page starts at the default.
- **"Render again"** on a Clip uses that Clip's Preset, or the default once it's gone. Its menu can pick another.
- **The Export Presets sheet** lists the Presets on the left and shows the picked one's form:
  - name;
  - codec, with descriptions and disabled ones marked "not on this Mac";
  - resolution, with "Larger than the Source" when above the Source's effective height;
  - frame rate;
  - quality tiers, each with its MB per minute (at 30 fps for Same as Source);
  - a collapsed Advanced section with VBR/CBR and kb/s;
  - loudness.
  - Built-ins are read-only, with "Duplicate". The owner's have Save, Delete and "Make default".
- **The Clip card** shows its settings line, such as "1440p · HEVC · High · −14 LUFS · High quality", and a "CBR fell back to VBR" note when relevant.
- **The progress line** of a rendering Clip shows the time left once progress passes 2%: elapsed / progress × (1 − progress), worded "almost done", "Ns left" or "M:SS left".
- **"Save frame"** in the Advanced Edit's toolbar or menu and in the clip editor's preview actions posts the draft and the playhead, then downloads the PNG. A checkbox or second action, "Save frame to Media Library", also uploads it.
- **"Save audio"** (WAV or M4A, with the picked Preset) is in the Clip and Candidate actions.

## Testing Decisions

Good tests here check what comes out: the files' codec, size, frame rate, bitrate and loudness as ffprobe and loudnorm measure them; pixels in rendered frames; what the API and MCP accept and refuse; and what the editor shows. They don't check how ffmpeg arguments are spelled.

- **Seam A: HTTP and real ffmpeg** (prior art: `test_render.py`, `test_text_layers.py`, `test_shapes.py`, `test_music.py`):
  - **Codec and size:** a render with an HEVC 720p Preset gives an `hvc1` HEVC stream of 720×1280. An AV1 one (skipped when `libsvtav1` is missing) gives AV1.
  - **Frame rate:** a 60 fps Preset on a 30 fps Source gives 60 fps, and Same as Source keeps the Source's rate.
  - **Bitrate:** the measured average bitrate is within a tolerance of the target, for a tier and for a given CBR bitrate on libx264.
  - **Loudness:** −14 and −16 measure near their targets, and off leaves a quiet test tone quiet.
  - **Scaling:** at 720p, a caption, a Text Layer, a Shape and an Overlay land at their 1080 positions × 2/3 (sampled pixels). At 1440p, a Text Layer's edge is as crisp as at 1080, judged by edge width in pixels.
  - **Saved frame:** the PNG has the Preset's size and shows a Text Layer of the draft that isn't saved. The Job's status stays as it was.
  - **Saved audio:** the WAV is 48 kHz 16-bit with the mix's duration, and the M4A is AAC.
  - **Fallback:** with VideoToolbox made to fail (tests already swap encoders), H.264 falls back to libx264 and records it.
- **Seam B: pure functions:**
  - **Encoding rules:** the output size per resolution; the target bitrate per tier, codec, resolution and fps; a given bitrate replacing the tier; CBR's fallback flag on VideoToolbox; the estimated bytes.
  - **Planner:** a plan made at 60 fps snaps a Freeze frame and a Transition to 60 fps frames, and the Preview Plan of the same Candidate stays at the Source's rate.
- **Model, API and MCP** (prior art: `test_text_presets.py`, `test_mcp.py`):
  - A built-in Preset can't be changed or deleted (409).
  - Deleting the default makes "Shorts / TikTok / Reels" the default.
  - An unknown codec, an off-list resolution or fps, or a bitrate out of range is refused (422).
  - `render_clips` with `export_preset_id` records it on the Clip.
  - A queued Candidate asked again with another Preset renders with the latest.
  - Export Settings changes never make a Clip stale.
  - `list_clips` shows each Clip's settings.
- **Editor (vitest; prior art: the Clips and Advanced Edit action tests):**
  - The Render menu picks the default.
  - "Render again" picks the Clip's Preset, or the default once it's deleted.
  - The Clip card's settings line, including a Clip rendered before Presets.
  - The wording of the time left.

## Out of Scope

- **Several Clips per Candidate** (one per Preset). A render replaces the Clip, and the card shows what it was made with.
- **Export Settings on a Candidate,** or a Preset per Candidate or per Job. A batch takes one Preset.
- **Containers other than MP4.** No ProRes or MOV.
- **10-bit, HDR and colour range.** Clips are 8-bit SDR, limited range.
- **Audio codec, bitrate and sample rate choices in a Preset.** AAC 192k at 48 kHz stays.
- **A free LUFS value or true peak.** It is −14, −16 or off.
- **Canvas aspect ratios other than 9:16.** That is roadmap #20 `canvas-aspect`, which builds on this.
- **Upscaling the Source video** with AI. Above the Source's resolution, it is scaled by ffmpeg.
- **Export files as Clips:** a saved frame or sound is never stale, never queued, and not on the Clips page.
- **Choosing a folder on disk.** Files go to the Job, and the browser downloads them.

## Further Notes

- ADR 0021 records the decisions: global Export Presets, never stale, the plan drawn at any size, the frame rate as the one exception, tiers as target bitrates, and loudness in the settings.
- This feature overturns no Out of Scope item of the Advanced Edit spec, which never mentioned export settings.
- Concat was used for behaviour only:
  - its tiers and size model (16/8/4 Mb/s at 1080p30 with codec factors);
  - its resolution and frame-rate lists;
  - its time-left wording.
- It differs from Concat in four ways:
  - Concat keeps no presets.
  - Concat never scales, and enables only the project's size.
  - Concat's tiers are CRF values.
  - Concat has no loudness normalization and no audio-only export.
- "Recommended" at 1080p30 H.264 is 8 Mb/s, the same as today's VideoToolbox bitrate, so the default Preset renders as before.
