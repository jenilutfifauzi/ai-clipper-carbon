# 05: Explain the xfails

**What to build:** each test in tests/conftest.py's LINUX_KNOWN_DIFFERENCES either passes (drop its xfail) or is explained (a real Linux bug, or a tolerance to set).

**Blocked by:** 04.

**Status:** ready-for-agent

Checked with `--runxfail` and ffmpeg 7.0.2 (PyPI's imageio-ffmpeg static build, 4 filters needed present; ffprobe 6.1) against the distro's 6.1.1:

- Passes with 7.0.2, fails with 6.1.1: the cut-out segment's image Background (a PNG's colour range). Ffmpeg's.
- Fails with both, cause not found: a cut-out segment under a transition has 123 samples where 122 are expected; a retimed 4x copy is one frame off (63 for 64); a reversed split scene's frame spacing is uneven; a blend's colour is 4.02 levels off a bound of 4; a graded red half is 88.9 against a bound of 87.5. The first three are frame counts, not tolerances: a Linux difference in timestamps or rounding (libx264 or the container) is not ruled out.
- Probed: `setpts=PTS/4-0.001/30/TB,fps=30:round=up` on a numbered-frame source picks the same frames in ffmpeg 6.1.1 and 7.0.2, so the retimed copy's 63-for-64 is not that filter's tie-break. Suspects left: the rest of the render chain, or the lossy encode (libx264 at the tier's CRF) blurring neighbouring frames' lumas where the test picks a frame by nearest luma.
- The two resilience tests and the transitions budget are timing: they fail when the host is busy.
- Fixed instead (the test lacked a field the API has): the Cue Edit's `template`.

- [ ] find the cause of the three frame-count differences, on the Mac's ffmpeg if possible
- [ ] set or justify the two colour bounds
