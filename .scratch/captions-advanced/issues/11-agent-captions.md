# 11: The agent's captions tools

**Parent spec:** `../spec.md` (Agent (MCP)); user stories 49–52.

**What to build:** the agent can caption and fix captions as the owner does. The model fields were made reachable through `edit_candidate`, `merge_candidate_items` and `remove_candidate_items` in their own tickets. This one adds the views and tools.

**Dry run.** It returns:
- the Cues: times, lines, plain text, key, `edited`, `joinable`;
- the unused Cue Edits;
- each Segment's Words status.

**New tools:**
- `set_media_language(media_id, language | null)`.
- `get_media_words(media_id, job_id)`: it queues if needed, waits up to a timeout, and returns the Words or the status.
- `get_captions(job_id, candidate_id, format: "srt" | "vtt")`.

**`list_clips`** includes each Clip's caption file paths.

**Tool descriptions:**
- Fix the Word Edit key wording: any time within the Word on its timeline; the editor uses its middle.
- Explain Media Words, the Captions switch, Cues, Cue Edits (timing, place, size, `join`) and Word Edits with `media`.

**Blocked by:** 05, 06, 07, 08, 09, 10.

**Status:** ready-for-agent

- [ ] MCP: a dry run of a Candidate with a talking media Segment lists its Cues with keys, and each Segment's status.
- [ ] MCP: `merge_candidate_items` changes one field of a Cue Edit and keeps the rest. `remove_candidate_items` removes one by key.
- [ ] MCP: `set_media_language`, then `get_media_words`, return Words in the new language (fake transcriber).
- [ ] MCP: `get_captions` returns SRT and VTT matching the dry run's Cues. `list_clips` shows the paths after a render.
- [ ] The tool descriptions mention every new field and tool, and the corrected `at` wording.
