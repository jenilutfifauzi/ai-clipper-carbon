# 07: Hardware encoding on Linux (VAAPI)

**What to build:** Clips encode on the host's GPU where there is one, falling back to software.

**Blocked by:** 05.

**Status:** needs-triage

- [ ] decide whether it is worth it: the host has /dev/dri, and software is slow on 4 cores
