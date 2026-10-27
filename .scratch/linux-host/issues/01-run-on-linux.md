# 01: Run on a Linux host

**Parent spec:** `spec.md` in this feature folder.

**What to build:**
- uv environments for Linux; faster-whisper off the Mac, mlx-whisper on it.
- Platform defaults for ffmpeg, the Whisper model and the encoders; `make setup` and `make check-ffmpeg` on Linux.
- Tests that don't assume macOS (`say`, mlx, VideoToolbox).
- README: Linux prerequisites and setup.

**Blocked by:** none.

**Status:** ready-for-human
