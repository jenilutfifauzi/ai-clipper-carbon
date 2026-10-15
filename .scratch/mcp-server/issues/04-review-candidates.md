# 04: Reviewing Candidates

**Parent spec:** `spec.md` in this feature folder (user stories 5–9).

**What to build:**
- `get_transcript(job_id, start, end, words)`: the Transcript's lines in a time range (at most 10 minutes or 400 lines, with `next_start`), and their Words if asked.
- `get_candidate`: one Candidate, whole.
- `edit_candidate(job_id, candidate_id, changes: CandidateUpdate, dry_run)`: PATCH, or with `dry_run` the Preview Plan's summary (duration, scenes, captions, hook, Text Layers, Words with `at`), nothing saved.
- `add_candidate(job_id, start, end)`.

**Blocked by:** 01.

**Status:** done

- [x] The Transcript pages by time.
- [x] Hook text, Kicker, range and selection are saved; a bad range returns the API's 422 message.
- [x] Editing a Job that isn't in review returns the API's 409 message.
- [x] A dry run saves nothing.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_mcp.py`:
  - The Transcript to 2 s gives its first two lines and their Words, with `next_start` 2.6; the next page is the last line, with `next_start` None.
  - Hook text with Emphasis, Kicker and selection are saved, and the Job's summary shows them without descriptions.
  - A dry run gives the hook's lines and Words with `at`, and saves nothing.
  - A reversed range, a 40-character Kicker and an unknown Candidate come back with the API's messages.
  - A Candidate can't be added while the Job downloads (409).
