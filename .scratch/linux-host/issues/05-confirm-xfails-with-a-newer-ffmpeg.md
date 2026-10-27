# 05: Confirm the xfails against a newer ffmpeg

**What to build:** run the xfail tests (tests/conftest.py's LINUX_KNOWN_DIFFERENCES) with an ffmpeg of the Mac's generation. Each either passes (drop its xfail) or is explained (a real Linux bug, or a tolerance to set).

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] each xfail is removed, or explained in a comment with its measured cause
