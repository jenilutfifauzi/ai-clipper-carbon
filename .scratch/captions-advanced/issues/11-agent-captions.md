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

**Status:** done

- [x] MCP: a dry run of a Candidate with a talking media Segment lists its Cues with keys, and each Segment's status.
- [x] MCP: `merge_candidate_items` changes one field of a Cue Edit and keeps the rest. `remove_candidate_items` removes one by key.
- [x] MCP: `set_media_language`, then `get_media_words`, return Words in the new language (fake transcriber).
- [x] MCP: `get_captions` returns SRT and VTT matching the dry run's Cues. `list_clips` shows the paths after a render.
- [x] The tool descriptions mention every new field and tool, and the corrected `at` wording.

## Comments

**2026-10-19, agent:** Built (backend/app/mcp_server.py, tests in backend/tests/test_mcp.py).

- **Dry run.** Each Segment gives `words_status` (the Preview Plan's: clip, transcript, media, pending, failed, off, none) and a failed one's `words_error`. Cues (with key, `edited`, `joinable`, centre, size) and `unused_cue_edits` were there from 07/08.
- **`set_media_language(media_id, language | null)`** goes through `PATCH /api/media/{id}`.
- **`get_media_words(media_id, job_id, again=false, timeout_secs=120)`** reads `GET /api/jobs/{job}/media/{id}/words`. When the status is none or failed it posts to the same path, which queues the Words (a Retry for a failed one); `again` posts `{again: true}` (Transcribe again). It then polls every 0.25 s while pending, up to the timeout, and returns `{media_id, language, status, error?, words?}`.
- **`get_captions(job_id, candidate_id, format)`** returns `{format, text}` from the captions route. The route's 409s (captions off, pending) come back as tool errors. `api()` gained a `text` flag for a body that isn't JSON.
- **`list_clips`** (and `get_job`/`render_clips`, through `_clip_view`) gives `srt_path` and `vtt_path` when the Clip has them.
- **Instructions.** The Word Edit `at` wording now says: any time within the Word on its own timeline, the editor uses its middle. Cue Edits are keyed on their timeline, not "Source time". The instructions add a paragraph on the dry run's Cues, plus `join` and how to merge two Cues. Media Words, the Captions switch, `words_status`, get_media_words, set_media_language and get_captions are covered, and the workflow mentions the caption files.
- TOOLS_BUDGET_BYTES raised by 2_000 for the three tools (see below).

Merged with 09 (`join`, `needs_join`). 09's instructions on split and merge are kept as they are. The dry run's Cues paragraph names `needs_join`. With 09's 73_700 as the base, TOOLS_BUDGET_BYTES is now 75_700, and the tools come to about 75_470.

Tests (test_mcp.py):
- A talking video Segment's dry run says `none`, then `media` after get_media_words, with its Cue keyed `{at, media}`.
- A failed transcription gives `failed` with its error, in both the tool and the dry run, and asking again retries.
- After the language is set, the Words come back in `en`. Clearing it gives the Job's Words back without transcribing again. A still is refused.
- get_captions SRT and VTT match the dry run's Cues, and the rendered Clip's srt_path and vtt_path files equal get_captions. With captions off, get_captions is refused.
- The instructions name the new fields and tools.
- `test_sped_media_segments.py`'s exact dry-run Segment dicts now include `words_status`.
- Full backend suite: 883 passed before that fix, which was the only failure.
- The merge-one-field and remove-by-key checkbox is covered by 07's `test_cue_edits_are_set_merged_field_by_field_and_removed_by_their_key`.

**2026-10-19, agent (review cleanups):** Behaviour kept; one deliberate change to the sort order.
- One timeline key. In the frontend, `editor/timelineKey.ts` holds `sameKey`, `sameTimeline`/`timelineOf`, `keyText` ("<media>@<at>" to the millisecond), `byKey` and `segmentHolds`. `cueStageId`, merge.ts's list keys, the Tracks/CuePlaceFields/CaptionTextEditor React keys and groups, cueEdits.ts and clipboard.ts all use it. `pick.ts`'s `sameCue` is gone, and a Cue Edit Collision's item is now `"@103.100"`. In the backend, mcp_server.py's `TimelineKey` is gone: remove_candidate_items takes planner.py's `CueKey`, which takes no other field (`__pydantic_config__`).
- One sort order. Word Edits are now kept like Cue Edits and the MCP merge: the Source's first, then each item's, each in time order. That is review.py's `_timeline_key` for `_merged` and `_keyed`, and the frontend's `byKey` in `withWordEdit`, `withCueEdit` and paste. Saved data still loads, because the order is only applied on save. test_media_words checks the new order.
- Duplicates folded into one: cueEdits.ts exports `bare` (cuePlace.ts uses it), `captionsLocked` and `editablePlan` (the locked-or-no-plan guard). clipboard.ts has one `segmentHolds` predicate. rendering.py's `has_media_words(item)` is the "video with sound" check, used by `captioned_media`, `transcribe_media` and api.py's Media Words view. `transcribe_media` reads `media_language` once.
- Statuses: `MediaWordsStatus` (what the store has of an item's Media Words: ready/pending/failed/none) and `WordsStatus` (where a Segment's caption Words come from: clip/transcript/media/…) are two concepts. The values are unchanged, and each now says how it differs from the other (backend and api.ts).
- Phrase and Sentence: `LINE_LIMITS` in styles.py is the source of truth. The MCP instructions' sentence is generated from it (`_line_limits`). The frontend's `editor/lineLimits.ts` keeps its copy, and lineLimits.test.ts and test_styles.py both check it against `backend/tests/fixtures/line_limits.json`. test_styles.py also checks that Phrase is CaptionStyle's defaults.
- GLOSSARY names: `lineWords` is now `cueWordsOf(cue, words)`. In ClipPreview.tsx, Cues are `cue` (with index `index`) in the stage items, `Captions`, `captionGrab` and `CaptionLines`/`CaptionLine`.
