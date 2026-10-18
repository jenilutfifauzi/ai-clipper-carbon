# 0021: Export Presets, and a plan drawn at any size

Status: accepted
Date: 2026-10-18

Builds on 0001 (the backend plans, the frontend draws) and 0003 (a Clip is stale once its Candidate's Revision differs).

## Context

The `export-settings` feature (roadmap #19, `.scratch/advanced-edit-v2/roadmap.md`) brings Concat's export sheet to ai-clipper: codec, resolution, frame rate, quality, size estimate and time remaining, plus a saved frame (PNG) and audio alone.

Until now every Clip was encoded one way. `RenderTuning` held H.264 at 8 Mb/s (12 above 30 fps) on VideoToolbox, libx264 at CRF 20 as the fallback, 1080×1920 at the Source's frame rate, AAC 192k, and loudnorm at −14 LUFS.

The planner works in 1080×1920 output pixels throughout. Transforms, caption and hook boxes, the safe area and the picture layers' rasterised layouts are all in those pixels. The preview and the MCP tools speak them too.

Concat keeps its export settings in memory for the session only, with no named presets. It offers 720p to 4K but only enables the project's own size, so it never scales. Its quality tiers are CRF values, and its size estimate is a separate bitrate model.

Each choice had genuine alternatives:
- **Where the settings live:** the Candidate (a model field, saved with each Revision), each render request only, or named global presets.
- **How other sizes are made:** plan in the target's pixels; draw at 1080×1920 and scale the finished frame; or keep the plan at 1080×1920 and draw it at the target size.
- **What a quality tier means:** a constant quality (CRF, `q:v`) or a target bitrate.

## Decision

- **Export Settings live in global, named Export Presets, never on a Candidate.**
  - Built-in Presets can't be changed or deleted: "Shorts / TikTok / Reels" (the default), "Small", "High quality" and "Archive".
  - The owner's Presets can be saved, renamed, deleted and made the default.
  - A render takes one Preset for its batch, or the default.
  - A Clip records its Preset's id and a copy of the settings it was made with. The copy is only for display.
  - "Render again" uses that Preset as it is now, or the default once it has been deleted.
- **There is still one Clip per Candidate.** A render with another Preset replaces it. A frame or the audio alone is an export file in the Job's `exports/`, not a Clip.
- **Export Settings never make a Clip stale.** Staleness stays what 0003 says: another Revision, or another resolved style. Nothing on the Candidate says how it ought to be encoded, so there is nothing to compare against.
- **The Render Plan stays in 1080×1920 output pixels at every resolution.**
  - The renderer draws it at the export's size, every coordinate and size multiplied by height / 1920.
  - Captions and the hook are rendered by libass at that size, and the picture layers' pictures are rasterised at it, so text stays sharp at 1440p and 4K. Source video above its own resolution is upscaled.
  - The preview, the Preview Plan and every saved position are unchanged.
- **The frame rate is the one Export Setting the plan depends on.**
  - The plan for a Clip is made at the export's rate ("Same as Source" by default), so that cuts, Transitions, Freeze frames and the picture layers' motion land on the output's frames.
  - The Preview Plan keeps the Source's rate.
- **A quality tier is a target bitrate.**
  - High is 16 Mb/s, Recommended 8 and Smallest 4, at 1080p and 30 fps. Each is scaled by pixels over 1080p's, by the frame rate over 30, and by the codec: H.264 1, HEVC 0.6, AV1 0.5.
  - VideoToolbox encodes at that average.
  - Software encoders use CRF 16, 20 or 26, capped at 1.5× the target.
  - A Preset may instead give its own bitrate, VBR or CBR. CBR falls back to VBR where the encoder can't do it, and the Clip records that.
  - The size estimate is the target bitrate times the duration, so it matches what the encoders aim for.
- **Loudness is part of the Export Settings:** −14 LUFS (the default), −16 LUFS, or off. The true peak (−1.5 dB) and the loudness range (11) are fixed.
- **A saved frame and the audio alone are made on request, outside the render queue.**
  - Each is one synchronous request, and the Job's status doesn't change.
  - Like the Preview Plan, they use slow analysis only when it is cached, with the same fallbacks.
  - The frame shows the editor's draft at the playhead, through the render's filter graph, at the default Preset's resolution.
  - The audio is the saved Revision's mix as WAV or M4A, at the chosen Preset's loudness.

## Consequences

- `RenderTuning` keeps only what isn't a choice: encoder order, keyframe interval, audio rate, Blur's parameters and the poster time.
- Every size and coordinate the renderer writes into the filter graph, the ASS script and the picture rasteriser goes through one scale factor. A forgotten one shows at 720p or 4K, so the render is tested at a size other than 1080×1920.
- The plan file beside a Clip is made at the export's frame rate and can differ from the Preview Plan in its frame-snapped times.
- AV1 has no hardware encoder on any Mac, so it is software only (SVT-AV1) and slower. A codec whose encoders ffmpeg lacks is offered disabled.
- Changing a Preset re-encodes nothing. The owner sees each Clip's settings on its card and renders it again when wanted.
- Canvas aspect (roadmap #20) will change the frame's shape. This ADR keeps the frame's pixel space independent of the export's size, so #20 decides its own space without touching Export Settings.
