# 05: Media caption controls: the Captions switch, the item's language, failures

**Parent spec:** `../spec.md` (Domain and model: `MediaItem.language`, `Segment.captions`; Media Words: renders wait; Advanced Edit: media Segment inspector, Main Track, Media Library item menu); user stories 6, 8, 9, 45.

**What to build:** the owner controls which media Segments are captioned and in what language, and recovers from a failed transcription.

**The Captions switch:**
- `Segment.captions` (media Segments only; empty means on) is a switch in the media Segment's inspector.
- Off, the Segment has no Cues, its status is `off`, and nothing is queued for it.
- It is refused on a Source Segment.

**The item's language:**
- `MediaItem.language` (the Job language's pattern; empty means the Job's) is set through the Media Library API.
- It is edited from the media Segment's inspector (a select whose first entry is "Job's language (xx)", noting it applies to the item in every Job) and from the Media Library's item menu for videos.
- Changing it queues a transcription in the new language and keeps the old file.

**Failures:**
- A failed transcription is remembered. The status is `failed` with its error, the Main Track badge turns red, and the inspector offers Retry.
- When ready, "Transcribe again" re-runs it.
- A render with a failed or failing transcription fails that Clip with a message naming the item.

**Captions off:** a Job with captions off queues no Media Words, the status is `none`, and the Captions Track says captions are off for this Job.

**Blocked by:** 04.

**Status:** done

- [x] HTTP: a media Segment with `captions: false` has no Cues and causes no transcription. `captions` on a Source Segment is refused.
- [x] HTTP: setting an item's language to `en` transcribes it in `en` for every Job that shows it. Clearing it goes back to each Job's language, reusing the earlier file.
- [x] HTTP: a transcription that raises makes the status `failed` with the error. Retry clears it and runs again. "Transcribe again" replaces a ready file.
- [x] Render: a failed transcription fails that Clip's render with the item's name. Turning the switch off lets it render.
- [x] A Job with captions off queues nothing for its media Segments.
- [x] The MCP accepts `segments[].captions` in `edit_candidate` and `merge_candidate_items`.
- [x] Browser walkthrough: the switch, the language select (inspector and Media Library), the red badge and Retry.

## Comments

**2026-10-19, agent:** Built. The seam:
- **Model.** `Segment.captions: bool | None` (None = on; any value on a Source Segment is refused, 422 "…has no Captions switch"). `MediaItem.language: Language | None` (`app/transcript.py`'s `Language`, the pattern `JobOptions.language` now uses too). `Job.transcribing: list[media id]`: videos queued for a Retry or Transcribe again, run by the render queue before preparations.
- **Hooks from 04.** `media_language` = `item.language or job.options.language`; `captioned_media` also needs `segment.captions is not False`.
- **MediaWordsStore** (`app/media_words.py`): status `ready` / `pending` / `failed` / `none` (pending wins, then failed, then saved). `error(id, lang)`; `queue` skips a failed one; `retry(id, lang, again=False)` forgets the failure and queues (with `again`, or when a re-run is what failed, even when saved); `transcribe(..., interrupted=(RenderStopped,))` raises `MediaWordsFailed` and remembers the error (in memory, until Retry or restart), re-runs while `again` is set, replaces the file.
- **Renders.** `transcribe_media(job_id, media_id, again)` (JobConflict unless review/rendering and captions on; MediaNotFound unless a video with sound); `missing_media_words` leaves out failed items, so prepare doesn't loop on them; a render with a failed (or newly failing) item fails that Clip: "The video <name> couldn't be transcribed for its captions (<error>): retry it in the editor, or turn its Segment's captions off". A preparation leaves that Segment uncaptioned and the status shows the failure (no Job warning).
- **API.** `PATCH /api/media/{id}` `{language: str | null}` (422 for a non-video or a bad code). `GET /api/jobs/{job}/media/{id}/words` gives `MediaWordsView` `{media_id, language, status, error, words}`. `POST` on the same path, optional body `{again: bool}`: Retry, or Transcribe again; 202 with the view; 409 when the Job's captions are off or it isn't in review/rendering. Ticket 11's `set_media_language` and `get_media_words` can sit on these.
- **Preview Plan.** `words_status` adds `failed` and `off`; new `words_errors: {segment id: error}`. Pending also covers an item in `job.transcribing`. While "Transcribe again" runs, the Segment shows `pending` and keeps its earlier Cues.
- **Watchdog budget.** I made it wider: a whole Media Library item now gets `media_budget_secs + media_budget_factor × length` = 120 + 2.5 × length (`TranscriptionTuning`), so 495 s for 150 s and 570 s for 180 s. The old shared formula gave 60 + 1.5 × length (285 s for 150 s, 330 s for 180 s), and 04 saw a cold-load run on a busy machine take about 280 s. `Watchdog.transcribe` takes an optional `budget`.
- **MCP.** `segments[].captions` gets through `edit_candidate` and `merge_candidate_items` (patch schema from `Segment`), with one line in the instructions. TOOLS_BUDGET_BYTES went from 69,000 to 69,500 for the added schema field.
- **Editor.** `MediaCaptionFields` in the media Segment's inspector (not for a Freeze frame, Reverse or a silent video) has the Captions switch, the language select (first entry "Job's language (xx)", hint "applies to this video in every Job"), and the status with Retry when failed, Transcribe when not queued, and Transcribe again when ready. When the Job's captions are off it says so instead. The Media tab's video cards have a compact language select. Changing the language from either place PATCHes it, then prepares the Candidate. The Main Track shows a red "Captions failed" badge, and the Captions Track says "Captions are off for this Job". Prepare also runs again when a video's switch is turned back on. `LANGUAGES` moved to `src/languages.ts`.

Tests: `tests/test_media_caption_controls.py` (switch off: no Cues, no transcription in prepare or render, and back on; refused on a Source Segment; item language `en` for two Jobs, clearing it reuses the `id` file; language validation; failed → remembered → Retry → ready → Transcribe again replaces the file; a failed render names the item, and the switch off lets it render; a Job with captions off queues nothing and refuses Retry). `tests/test_mcp.py` (switch via merge and edit, refused on the episode's). `mediaCaptions.test.ts` (switch, language choices, status → action, `failedSegments`).

Browser walkthrough: a copy of one Job and the Media Library in a scratch dir, with the app on port 8765 and a scripted transcriber (fails while a flag file exists, else gives fixed Words). Checked: the red badge and the inspector's "Transcribing failed: …" with Retry; Retry (flag removed) → "Transcribed" with Transcribe again and the badge gone; the inspector's language select to English → the item's language `en`, Words re-transcribed in `en`; the switch off → `off` and no media Cues; the Media tab card's select back to "Job's language" → language null. Real Whisper wasn't run, so the new budget hasn't been tried on a 150 s item. Also: on a short Segment at the default zoom, the badge is clipped to a red sliver, as "Transcribing…" already was.
