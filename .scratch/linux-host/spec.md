Status: ready-for-agent

## Problem Statement

The owner of a Linux machine can't use AI Clipper. It is built for an Apple Silicon Mac: Whisper runs on MLX, Clips are encoded by VideoToolbox, the install steps are Homebrew's, and the test suite speaks through macOS `say`. On Linux nothing installs, and what does install can't transcribe a Job's Source.

## Solution

The same app, with the same Jobs, Candidates and Clips, runs on a Linux x86-64 or arm64 host. A Job is transcribed locally by a CPU Whisper, Clips are encoded in software, and the setup, the docs and the tests know the host. Nothing changes on the Mac.

## User Stories

1. As a Linux owner, I want `make setup` to say what is missing and how to get it, so that I can install without guessing.
2. As a Linux owner, I want `make dev` to start the backend and the frontend, on another port when 8000 is taken, so that it runs beside my other services.
3. As a Linux owner, I want a Job's Source to be transcribed on my CPU, so that no Mac or cloud transcription is needed.
4. As a Linux owner, I want a lighter Whisper model I can choose, so that a 4-core, 8 GB machine stays usable.
5. As a Linux owner, I want Clips to be encoded in software with the Export Settings' codecs, so that every Export Preset still renders.
6. As a Linux owner, I want the server to stay small while idle, so that it can run all day.
7. As a Linux owner, I want an uploaded file by path to be staged without a macOS-only command, so that a Job from a file works.
8. As a Linux owner, I want a Narration to be startable as soon as the last one is done, so that I never see a false "busy".
9. As a Mac owner, I want nothing to change, so that my install and Clips are as before.
10. As an agent over MCP, I want the endpoint to answer on the Linux host, so that Claude Code can drive it.
11. As a contributor on Linux, I want the test suite to run and say which tests differ with the host's ffmpeg, so that a failure means something.

## Implementation Decisions

- Whisper: off the Mac, faster-whisper (CTranslate2, int8, CPU) replaces mlx-whisper inside the same worker process, keeping the VAD, the chunking and the mapping of times back onto the Source's timeline. The model is a setting; the default is the accurate one, a lighter one is documented.
- Encoding: the encoders tried for a codec are platform defaults; VideoToolbox is tried on the Mac alone, so Linux goes straight to libx264, libx265 and SVT-AV1. The Export Settings, Presets and Render Plan are unchanged (docs/adr/0021).
- ffmpeg: the first on PATH, or the configured one; it needs libass and scdet, which `make check-ffmpeg` verifies.
- Background removal: the Matte already falls back to the CPU; no change (docs/adr/0015).
- Dependencies: the lock resolves for the Mac and for Linux; mlx-whisper is Mac-only, faster-whisper Linux-only.
- Fixes this found, with effect on both hosts: staging a file by path clones with the host's `cp`; a Narration frees its slot before its end is announced; a preview copy ends its progress at 100%.
- `make dev` takes a backend port, passed to the backend and to the frontend's proxy.
- Not decided here: hardware encoding on Linux (VAAPI).

## Testing Decisions

- A good test drives the app through its API with the real ffmpeg and checks what a person sees: the files, the status, the pixels, not the code's steps.
- Seam: the existing one, the API with the real ffmpeg (tests/conftest.py's client, speech and fixture videos). No new seam. The speech fixture uses `say` on the Mac and espeak-ng elsewhere.
- Tests that pin the Mac's encoder, the Mac's Whisper or a number measured with the Mac's ffmpeg follow the platform; those whose pixel values, frame counts or time budgets differ with the distro's ffmpeg are xfail off the Mac, each with its reason, until checked against a newer ffmpeg (ticket 05).
- Prior art: tests/test_export_settings.py, test_render.py, test_whisper.py (Mac only), test_narration.py.

## Out of Scope

- Hardware encoding on Linux, Windows, and GPU Whisper.
- Packaging (a container image, a distro package).
- Changing how Selection, Layouts or the Clip editor behave.

## Further Notes

Measured on 4 CPU cores and 11 GB, ffmpeg 6.1: the server idles at about 260 MB; large-v3-turbo reads 10 s of speech in 36 s and uses 2.1 GB; the small model takes 8 s and 1.1 GB, with more mistakes.
