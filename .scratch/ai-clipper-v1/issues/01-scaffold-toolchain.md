# 01: Scaffold & toolchain

**Parent spec:** `spec.md` in this feature folder (Milestone M0).

**What to build:** A fresh checkout can be bootstrapped with one setup command into a working project. The result:
- a Python 3.12 backend environment managed by uv, without torch;
- the system prerequisites (`ffmpeg-full`, `deno`);
- the downloaded assets (BlazeFace short-range model, Silero VAD ONNX model, Montserrat ExtraBold font);
- an environment template and a third-party notice for openshorts (MIT);
- a command to update the YouTube downloader;
- a test runner that runs green.

This is the prefactor every later ticket builds on.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] The project is under git, with ignores for the data directory, the env file, downloaded models, and caches. The `.scratch/` tracker stays committed.
- [x] One setup command installs backend dependencies with uv on Python 3.12 and downloads the BlazeFace short-range model, the Silero VAD ONNX model, and Montserrat ExtraBold.
- [x] torch is not present in the environment (excluded through a uv dependency override). mlx-whisper imports and transcribes a short sample audio file with word timestamps without it.
- [x] Setup checks for Homebrew `ffmpeg-full` and `deno` and fails with a clear message if either is missing. The owner must approve the Homebrew install before it runs.
- [x] The configured ffmpeg binary reports the ASS subtitles filter, the scene-change filter, and the `h264_videotoolbox` encoder.
- [x] One update command upgrades yt-dlp in place.
- [x] The environment template lists every config key from the spec: Gemini API key and model, Whisper model, ffmpeg path, data directory, optional cookies-from-browser, and audio-signal flag.
- [x] A third-party notice includes the openshorts MIT licence text.
- [x] faster-whisper, PySceneDetect, and opencv-python-headless are absent. The only OpenCV package is the one MediaPipe brings.
- [x] The test runner executes green.

## Comments

**2026-10-13: implemented, not committed (awaiting owner review).**

Built:
- `git init` on `main`. `.gitignore` covers `.env`, `/data/`, `backend/models/`, `backend/assets/fonts/`, `.venv`, Python caches, `node_modules`, `frontend/dist` and `.DS_Store`.
- `backend/`: a uv project on Python 3.12, packaged as `app` with `uv_build`. It contains:
  - `app/config.py`: `load_settings()`. Environment variables win over the repo-root `.env`, and the module also holds the asset paths.
  - `app/main.py`: a FastAPI placeholder with `GET /api/health`.
  - `scripts/download_assets.py`: idempotent. It fetches BlazeFace short-range, Silero VAD `silero_vad.onnx` (tag v6.2.3), and Montserrat ExtraBold with its OFL (tag v9.000). It pre-caches the Whisper model with `snapshot_download`.
  - `scripts/check_ffmpeg.py` and `tests/`.
- At the repo root: a `Makefile` (`setup`, `check-ffmpeg`, `dev`, `test`, `test-whisper`, `update-ytdlp`), `.env.example` and `THIRD_PARTY_NOTICES.md`.

How torch is excluded: uv 0.9.6 has no `exclude-dependencies`, so the project sets `[tool.uv] override-dependencies = ["torch; sys_platform == 'never'"]`. Together with `environments` limited to macOS arm64, torch is missing from both the environment and `uv.lock`. numba 0.68.0 and scipy 1.18.1 are still installed. `import torch` fails. `make test-whisper` transcribes speech generated with macOS `say`, with word timestamps.

Notes:
- `huggingface-hub` is declared directly because the setup script imports it. mlx-whisper already pulled it in.
- When given a file path, mlx-whisper decodes audio by running whatever `ffmpeg` is on PATH, not `FFMPEG_BIN`. On this machine, brew linked ffmpeg-full into `/opt/homebrew/bin` even though the formula is keg-only, but that isn't guaranteed. The Transcriber (ticket 03) should decode with the configured ffmpeg and pass samples as an array.
- The two ffmpeg/Homebrew criteria are left for the owner to tick. Results from this run:
  - with ffmpeg-full and deno installed, `make setup` passed;
  - `make check-ffmpeg` reported PASS for ffprobe, `ass`, `scdet` and `h264_videotoolbox`;
  - with both packages simulated as missing, setup printed `Missing Homebrew packages: ffmpeg-full deno` and `Install them with: brew install ffmpeg-full deno`.

**2026-10-13: verified by the owner's session.** The owner approved the Homebrew install. `brew install ffmpeg-full deno` installed ffmpeg 9.0.2 and deno 2.9.7. `make check-ffmpeg` passes all items, `make test` passes (11 passed), and `import torch` fails as intended. A runtime check also confirmed that `crop@c x` changes through `sendcmd` at the scheduled timestamps (tested on a still image), which supports the single-process crop design for tickets 12–13.
