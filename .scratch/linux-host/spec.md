# Linux host

The app runs on a Linux x86-64 or arm64 host as well as on an Apple Silicon Mac, with no change to
what a Job, a Candidate or a Clip is.

## Decisions

- **Whisper:** faster-whisper (CTranslate2, int8, CPU) stands in for mlx-whisper off the Mac. Same
  worker process, same VAD and time mapping (`app/whisper_worker.py`).
- **Encoding:** software encoders only (libx264, libx265, SVT-AV1); VideoToolbox is tried on the Mac alone.
- **ffmpeg:** the first `ffmpeg` on PATH, or `FFMPEG_BIN`; it needs libass and scdet (`make check-ffmpeg`).
- **Matte:** onnxruntime on the CPU (the CoreML path already falls back to it).
- **Tests:** the `say` voice is espeak-ng off the Mac; the mlx-only Whisper tests are skipped.
