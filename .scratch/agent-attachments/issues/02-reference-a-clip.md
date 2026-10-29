# 02: Reference another Candidate as a style reference

**Parent spec:** `spec.md`

**What to build:** in the + menu, **Reference a clip** lists the Job's other Candidates (by hook and time, the open one left out). Picking one adds a chip; on send the backend reads that Candidate and puts a JSON summary of its edit (the `get_candidate` shape) before the prompt as `<context kind="candidate" name="…">`. The Agent still edits only the open Candidate.

**Blocked by:** 01

**Status:** done

- [x] The request accepts `{kind: "candidate", candidate_id}`; an unknown id → 404, the open Candidate's id → 400, the same Candidate twice → 400
- [x] The driver's prompt carries the referenced Candidate's summary; the Scoped MCP server's rules are unchanged
- [x] Menu item with lucide `Clapperboard` opens the list of the Job's other Candidates; a picked Candidate can't be picked again while attached; chip shows its hook (truncated)
- [x] Bubble chip after send and after reload names the Candidate
- [x] Tests: `/turns` fake-driver test for the summary and the errors; composer test for the picker
