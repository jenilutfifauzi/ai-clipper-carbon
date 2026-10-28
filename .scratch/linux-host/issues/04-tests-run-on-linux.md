# 04: The test suite runs on Linux

**What to build:** `make test` on Linux runs the suite, with the speech fixture on espeak-ng, and a failure means something.

**Blocked by:** 03.

**Status:** done

- [x] Mac-only tests skipped, encoder and bitrate assertions follow the platform, stale expectations fixed
- [x] numeric differences with the distro's ffmpeg are xfail with a reason
