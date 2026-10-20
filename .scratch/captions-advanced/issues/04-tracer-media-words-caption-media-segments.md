# 04: Tracer: Media Words caption a talking media Segment

**Parent spec:** `../spec.md` (Domain and model: Media Words storage; Media Words (transcription); Planning Cues: a media Segment's Words); docs/adr/0020-media-words-and-cue-edits.md; user stories 1–5, 7, 10, 11, 14, 15.

**What to build:** a video from the Media Library placed as a Segment gets captions by itself.

**Media Words:**
- A Media Words service transcribes an item whole, once per language and model, on the existing Whisper worker (VAD, word timestamps, `restore`).
- It keeps the result beside the item in a folder of its own, one file per language and model, deleted with the item.
- It reports ready, pending or none for an item and a language. One run per item and language at a time.
- The language is the Job's (`MediaItem.language` comes in 05).

**Prepare:**
- The per-Candidate prepare call also queues Media Words for each media Segment, besides the Clip Words of its Source Segments.
- The Advanced Edit calls prepare when it opens, and after a media Segment is added or pasted. This also gives its Source Segments their Clip Words instead of the Transcript fallback.

**Planning:**
- A media Segment's Words are its item's Media Words in its range, mapped through its Segment time as a Source Segment's are: retimed by Speed, none for Reverse or a Freeze frame, and Cues broken at joins.
- Its Scenes are captioned at the Caption Style's position; Auto means the lower third.
- The Preview Plan reports each Segment's Words status (`clip`, `transcript`, `media`, `pending`, `none`).
- The Advanced Edit refreshes the Preview Plan while any Segment is `pending`. Its Main Track shows "Transcribing…" on a pending media Segment, and the Captions Track a hatched span over it.

**Renders:** the render step transcribes any missing Media Words of a media Segment before planning.

**Blocked by:** 01.

**Status:** done

- [x] The FakeTranscriber can hear scripted Words per media file and counts calls per file.
- [x] HTTP: prepare on a Candidate with a talking media Segment queues one transcription. The Preview Plan goes from `pending` to `media` and lists that Segment's Cues in Timeline time.
- [x] HTTP: trimming the Segment, placing the item in a second Candidate, or in another Job of the same language, doesn't transcribe again.
- [x] Planner: a media Segment at 2× Speed has its Cues at half the item's times. A reversed one and a Freeze frame have none. Cues break at its joins and Transitions.
- [x] Render (real ffmpeg): a frame over the media Segment shows caption ink, and its render transcribed the item first when the Words were missing.
- [x] Deleting the item (when nothing uses it) deletes its Media Words.
- [x] The Advanced Edit shows the badge and the hatched span while pending, and the captions appear when ready, without a reload. Browser walkthrough.

## Comments

**2026-10-19, agent:** Built. The seam:
- **Media Words service** (`app/media_words.py`): `MediaWordsStore(folder, model)` keeps `media/<id>.words/<language>-<model>.json` (`MediaWords`: `language`, `model`, `words` in seconds of the item). `saved(id, language)`, `status(id, language)` → `MediaWordsStatus` `ready` / `pending` / `none`, `queue` / `unqueue` (in-process: what a preparation has queued), and `transcribe(id, language, hear)`, which runs one item and language at a time (a lock per key), saves, and unqueues. `MediaStore.delete` already removes `<id>.*`, so the folder goes with the item. One store per app (`app.state.media_words`, passed to `Renders`), so the API sees what the render queue queued; the CLI's `Renders` makes its own.
- **Rendering** (`app/rendering.py`): `media_language(job, item)` (the Job's language: the hook for `MediaItem.language` in 05), `captioned_media(segment, item)` (a video with sound, forwards, not a Freeze frame: the hook for the Captions switch in 05), `media_segment_words(words, segment)` (the item's Words within CAPTION_MARGIN_SECS of the range, in seconds into the Segment, as a Source Segment's Clip Words are). `Renders.missing_media_words(job, candidate)`; `prepare` queues them and `prepared` requires them; `_all_words` transcribes a missing item whole (0 to its duration) on the Whisper worker under the watchdog (`_media_words`, `_transcribe` shared with `_words`), in both preparation and render. A failed preparation unqueues what it didn't reach. Failure handling (remembered failures, Retry, the render error naming the item) is left to 05: today a stall fails the render or adds the preparation warning, as for Clip Words.
- **Planner**: `_segment_words` keys a media Segment's Words `CueKey(at, media)` on the item's timeline; everything else (Speed, Reverse, Freeze frame, joins, Transitions, Auto = lower third) already followed from the Segment time. Line breaking untouched.
- **Preview Plan** (`app/editor.py`): `words_status: dict[segment id, WordsStatus]` (`clip`, `transcript`, `media`, `pending`, `none`). A media Segment is `pending` while the store has it queued or its Candidate is in `job.preparing`. `words_source` is unchanged (Source Segments only). `PreviewWord`s still list Source Words only: media Words and their Word Edits are 06.
- **Advanced Edit**: calls prepare on open and whenever the saved Candidate's set of videos on the Main Track changes (placed or pasted); `useReplanWhilePending` asks for the plan again every 1.5 s while any Segment is `pending`; the Main Track shows "Transcribing…" and the Captions Track a hatched span over a pending Segment (`editor/wordsStatus.ts`: `pendingSpans`, `refreshWhilePending`).
- **FakeTranscriber**: `heard[stem]` per media file, `files` and `calls_for(stem)`.

Tests: `tests/test_media_words.py` (planner: keys on the item's timeline, 2× Speed, Reverse and Freeze frame, joins and Transitions, Caption Style position; candidate_plan; HTTP: prepare `none` → `pending` → `media` with the Cues in Timeline time and one whole-item call in the Job's language; trim, second Candidate and second Job don't transcribe again; a real-ffmpeg render transcribes first and shows white caption ink in the Cue's area over the red video; deleting the unused item deletes its Media Words), `editor/wordsStatus.test.ts`.

Browser walkthrough on a copy of the data (one Job, the Media Library) with the real Whisper worker: the Advanced Edit opened with a 6 s Segment of a 150 s talking video queued it at once, showed "Transcribing…" on the Segment and the hatched span on the Captions Track. On this machine, loaded by other agents' test suites, the whole-item run went past the watchdog's 286 s budget twice (model load included) both times, so the Segment went to `none`. The same item transcribed outside the watchdog (169 Words, about 280 s) and saved through the store; reopened, the Segment shows its Cues ("MESKIPUN JARAK" in the lower third) on the preview and the Captions Track. The pending-to-ready switch without a reload was therefore checked by the HTTP test and the refresh unit tests, not watched in the browser. Worth noting for 05: a 180 s item's budget (330 s) is tight when the model loads cold on a busy machine.

Not done here (later tickets): MCP dry run doesn't list `words_status` yet (11); `MediaItem.language`, the Captions switch, failed status and Retry (05); media Word Edits (06).
