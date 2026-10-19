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

**Status:** done

- [x] Pure tests cover:
  - the output size per resolution;
  - the target bitrate per tier, codec, resolution and fps;
  - a given bitrate replacing the tier;
  - CBR's fallback flag on VideoToolbox;
  - the estimated bytes.
- [x] Settings off the lists (codec, resolution, fps, kbps out of range) are refused.
- [x] With the default settings, a render is H.264 at about 8 Mb/s and −14 LUFS, as before. The existing render tests pass unchanged.
- [x] An HEVC render gives an HEVC stream tagged `hvc1`.
- [x] An AV1 render gives AV1. This test is skipped when libsvtav1 is missing.
- [x] A CBR bitrate on libx264 measures within tolerance of it. A tier's bitrate measures within tolerance of its target.
- [x] Loudness −16 measures near −16, and off leaves a quiet test tone quiet.
- [x] With VideoToolbox made to fail, H.264 falls back to libx264 and reports it.

## Comments

**2026-10-18, agent:** Built.
- **Model and rules** (`app/encoding.py`, new): `ExportSettings` (frozen dataclass read through pydantic like the styles: `Codec`, `Resolution` = Literal 720/1080/1440/2160, `fps: FrameRate | None` checked against FRAME_RATES, `Quality`, `bitrate: Bitrate | None` with `RateMode` and `kbps` 100–200000, `loudness: Literal[-14, -16] | None`). Its defaults are the "Shorts / TikTok / Reels" settings, so `ExportSettings()` is the default Preset's. The pure rules: `output_size`, `target_kbps(settings, fps)`, `estimated_bytes(settings, fps, secs)` (with AUDIO_KBPS = 192) and `encoder_args(settings, fps, encoder) -> EncoderArgs(args, bitrate_fallback)`.
- **Encoder arguments**: VideoToolbox (and any encoder unknown there) gets the target as `-b:v`; libx264/libx265 get CRF 16/20/26 with `-maxrate`/`-bufsize` 1.5× the target, preset `fast`; SVT-AV1 gets CRF + 8 (Concat's equivalence) with the same cap, preset 8. CBR on libx264/libx265 is bitrate = minrate = maxrate = bufsize, plus `nal-hrd=cbr` / `strict-cbr=1`, without which x264 undershoots calm content. H.264 adds `-profile:v high`, HEVC `-tag:v hvc1`; x265 runs with `log-level=error` so a failure's last lines are ffmpeg's. Bitrates are spelled in M when whole (`8M`, `12M`), so the default encode's command is byte for byte the one before (the `unkeyed_command.json` fixture is unchanged).
- **Decision: SVT-AV1 falls back to VBR for CBR too** (as VideoToolbox does, and reported the same way). SVT-AV1 4.2 refuses CBR outside low-delay streams ("CBR Rate control is currently not supported for RANDOM_ACCESS"), so it gets its VBR at the bitrate instead.
- **Decision: a VBR bitrate of the settings' own replaces the target**, so the software encoders keep their tier's CRF capped at 1.5× it (VideoToolbox averages it), as the spec's rules read.
- **Note on "renders exactly as today"**: it holds up to 30 fps. After review (2026-10-18), a frame rate under 30 counts as 30 (`max(fps, 30) / 30`), so 24 and 25 fps Sources keep 8 Mb/s; a 60 fps one gets 16 Mb/s (it got 12).
- **`RenderTuning`** (`app/config.py`) keeps `encoders` (H.264's, so tests that swap it are unchanged), `hevc_encoders`, `av1_encoders`, `codec_encoders(codec)`, the keyframe interval, true peak, loudness range, audio rate, poster time and Blur's parameters. The bitrates, CRF, x264 preset and integrated loudness are gone.
- **Renderer** (`app/renderer.py`): `render(..., export=ExportSettings())` tries `codec_encoders(export.codec)` and returns `Encoded(encoder, bitrate_fallback)`. Loudness `None` skips the measuring pass and loudnorm (still `aresample` to 48 kHz). `available_codecs(ffmpeg, tuning)` reads `ffmpeg -encoders` once per process (`functools.cache` on the path), and a codec counts when any of its encoders is listed. Resolution and fps aren't applied yet: the Clip is the plan's 1080×1920 at the plan's rate, and the rules are given `plan.fps`.
- **Render worker** (`app/rendering.py`) passes `ExportSettings()` explicitly and ignores `bitrate_fallback` for now.
- **For later tickets**: 02 makes the renderer draw at `output_size(export)`. 03 plans at `export.fps` and passes it, since the rules already take the plan's fps. 04 records `Encoded.bitrate_fallback` and a copy of the settings on `RenderedClip`, passes the Preset's settings from the worker, and can reuse `TypeAdapter(ExportSettings)` for 422s and `available_codecs` for `GET /export-presets`. 05's estimate endpoint is `estimated_bytes`.
- Tests: `backend/tests/test_export_settings.py`. Seam B covers sizes, tiers × codec × resolution × fps, a settings' own bitrate, the estimate, CBR's fallback per encoder, and reading and refusing settings. Seam A uses the real ffmpeg on a grainy 1080×1920 30 fps Source: default H.264 High at 8 Mb/s ±20% and −14 LUFS on VideoToolbox; HEVC `hvc1`; HEVC Smallest at 2.4 Mb/s; CBR 3000k on libx264 within 10% and VBR on VideoToolbox with the flag; failed hardware falling back to libx264/libx265; AV1 (skipped without libsvtav1); −16 LUFS, and loudness off leaving a −30 dB tone at its own level; codec availability. Bitrate renders are 5 s long, because over 2 s the encoders overshoot by about a quarter. `test_keyframes.py`'s `keyed_render` now takes `.encoder`. `test_render.py` is unchanged.
