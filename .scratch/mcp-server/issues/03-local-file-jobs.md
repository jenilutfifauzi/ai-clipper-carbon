# 03: Jobs from a file on this Mac

**Parent spec:** `spec.md` in this feature folder (user story 2).

**What to build:**
- **Uploads:** stage a local file in the uploads folder: an APFS clone when it can, otherwise a copy after the free-space check. The file itself is left where it is.
- **Tool:** `create_job_from_file(path, options)` creates and submits the Job as the upload route does.
- **Glossary:** a Job is made from a URL, an upload or a file on this Mac.

**Blocked by:** 01.

**Status:** done

- [x] A Job from a local file reaches review, and the file is still there.
- [x] A missing path or a folder is a tool error, and nothing is left in the uploads folder.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_mcp.py`: a Job from a copy of the fixture video named `Episode 12.mp4` reaches review, shows that name as its source, the file is unchanged and the uploads folder is empty. A missing path and a folder are tool errors, and no Job is made.

**Changes from the plan:**
- `uploads.stage` checks for room for a whole copy (as an upload does) before `cp -c`, which clones on APFS and copies elsewhere, rather than trying a clone first.
