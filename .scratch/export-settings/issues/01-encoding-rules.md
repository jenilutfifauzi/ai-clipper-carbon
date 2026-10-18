# 01: Encoding rules: codec, quality and loudness in the renderer

**Parent spec:** `../spec.md` (Implementation Decisions "Model", "Encoding rules", "Planner and renderer": loudness); GLOSSARY (Export Settings); docs/adr/0021-export-presets-and-a-plan-drawn-at-any-size.md.

**What to build:** the renderer encodes a Clip as a given set of Export Settings says, and with the default settings encodes exactly as it does today.
- **Export Settings** is a value type: `codec` (h264, hevc, av1), `resolution` (720, 1080, 1440, 2160), `fps` (null for Same as Source, or one of 23.976, 24, 25, 29.97, 30, 50, 59.94, 60), `quality` (high, recommended, smallest), an optional `bitrate` ({mode: vbr|cbr, kbps: 100–200000}) and `loudness` (-14, -16 or null). Values off those lists are refused.
- **The encoding rules are a pure module.** From Export Settings and a frame rate, they give:
  - the output's pixel size;
  - the target video bitrate: 16, 8 or 4 Mb/s at 1080p and 30 fps, scaled by pixels over 1080×1920's, fps over 30, and codec (H.264 1, HEVC 0.6, AV1 0.5), or the given bitrate;
  - the estimated bytes for a duration: (target + 192 kb/s) × secs / 8;
  - per encoder, its codec arguments:
    - VideoToolbox: the target as its average.
    - libx264 and libx265: CRF 16, 20 or 26, capped at 1.5× the target. SVT-AV1: its CRF equivalent, with the same cap.
    - CBR: bitrate = minrate = maxrate, bufsize = bitrate, on the software encoders. VideoToolbox falls back to VBR, and says so.
- **Encoder order per codec:**
  - H.264: h264_videotoolbox, then libx264.
  - HEVC: hevc_videotoolbox, then libx265, tagged `hvc1`.
  - AV1: libsvtav1 only.
- **Which codecs this ffmpeg can encode** is read once per process from its encoder list and cached.
- **The renderer takes Export Settings** for codec, quality, bitrate and loudness. Resolution and frame rate come in 02 and 03; until then, only 1080 and Same as Source are rendered.
  - Loudness runs the two-pass loudnorm at the target. With null, no loudnorm runs (the mix is still resampled to 48 kHz).
  - It reports the encoder used, and whether CBR fell back to VBR.
- **The render worker** passes the default settings (H.264, 1080, Same as Source, Recommended, −14) until 04 adds Presets.
- **`RenderTuning`** keeps only what isn't a choice: encoder order per codec, keyframe interval, audio rate, true peak, loudness range, Blur's parameters and the poster time.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Pure tests cover:
  - the output size per resolution;
  - the target bitrate per tier, codec, resolution and fps;
  - a given bitrate replacing the tier;
  - CBR's fallback flag on VideoToolbox;
  - the estimated bytes.
- [ ] Settings off the lists (codec, resolution, fps, kbps out of range) are refused.
- [ ] With the default settings, a render is H.264 at about 8 Mb/s and −14 LUFS, as before. The existing render tests pass unchanged.
- [ ] An HEVC render gives an HEVC stream tagged `hvc1`.
- [ ] An AV1 render gives AV1. This test is skipped when libsvtav1 is missing.
- [ ] A CBR bitrate on libx264 measures within tolerance of it. A tier's bitrate measures within tolerance of its target.
- [ ] Loudness −16 measures near −16, and off leaves a quiet test tone quiet.
- [ ] With VideoToolbox made to fail, H.264 falls back to libx264 and reports it.
