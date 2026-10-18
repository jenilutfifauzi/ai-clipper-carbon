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

**Status:** ready-for-agent

- [ ] The FakeTranscriber can hear scripted Words per media file and counts calls per file.
- [ ] HTTP: prepare on a Candidate with a talking media Segment queues one transcription. The Preview Plan goes from `pending` to `media` and lists that Segment's Cues in Timeline time.
- [ ] HTTP: trimming the Segment, placing the item in a second Candidate, or in another Job of the same language, doesn't transcribe again.
- [ ] Planner: a media Segment at 2× Speed has its Cues at half the item's times. A reversed one and a Freeze frame have none. Cues break at its joins and Transitions.
- [ ] Render (real ffmpeg): a frame over the media Segment shows caption ink, and its render transcribed the item first when the Words were missing.
- [ ] Deleting the item (when nothing uses it) deletes its Media Words.
- [ ] The Advanced Edit shows the badge and the hatched span while pending, and the captions appear when ready, without a reload. Browser walkthrough.
