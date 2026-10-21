# 01: A Narration read by a Gemini Voice

**Parent spec:** `spec.md` in this feature folder (Solution; Implementation Decisions "Model", "Engines" (interface, Gemini TTS), "The Narration runner", "HTTP API", "Frontend"); ADR 0019.

**What to build:** the tracer bullet. With `GEMINI_API_KEY` set, the owner opens the new Narrate tab in the asset panel (or the phone bottom sheet), picks a Gemini Voice, types a script and presses Generate. A Narration named "Narration <voice> <date time>" appears in the Media tab and lands as a Music Clip marked Speech at the playhead, on a free lane, Picked, as one undo step. Songs with a duck turn down under it as under a Take.

- **The engine interface.** Each engine has an id, label, service, cloud or local, readiness, its Voices and whether it takes a Style. It reads one sentence to mono PCM. Gemini TTS is the first adapter: offered whenever `GEMINI_API_KEY` is set (whatever `LLM_PROVIDER` says), with its model in `TTS_GEMINI_MODEL` (default pinned after checking the current name) and its prebuilt Voices as a fixed list.
- **The runner.** A module of its own, not the Job Worker, one Narration at a time app-wide (409 when busy). It refuses an empty script, one over 5,000 characters, an unknown Voice or an engine that isn't ready (422). It splits at `.` `!` `?` `…` and newlines, reads each sentence, resamples to 48 kHz mono, joins with `pauses` seconds of silence (0–1.5, 0.3 by default; none before the first or after the last), levels with `loudnorm` to −16 LUFS / −1.5 dBTP, and adds the WAV through the Media Library's normal add.
- **HTTP.** `GET /api/voices` (engines and Voices, default engine for a Job language); `POST /api/narrations` returns an id; `GET /api/narrations/{id}/events` streams `done` with the Media item or `failed` with a message.
- **The tab.** Voice list (name, detail line), pause slider (None / Natural / Long / Longer), script, Generate. On `done` it lands `{media, start: playhead, secs: duration, speech: true}` through the same action that lands a Take.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Seam A (`FakeVoiceEngine`, one second of tone per sentence): a three-sentence script becomes one audio item named "Narration …" with Peaks, three seconds plus two pauses long.
- [x] Seam A: the pause setting changes the silence between tones, with none before the first or after the last.
- [x] Seam A: splitting at `.` `!` `?` `…` and newlines, blank lines collapsed, a sentence with no letters or digits dropped; the engine is called once per sentence, mark kept.
- [x] Seam A: two engines with tones at different levels come out at the same integrated loudness within 1 LU.
- [x] Seam A: empty, 5,001 characters, unknown Voice and not-ready engine are 422; a second request while one runs is 409.
- [x] Seam A: the events stream ends in `done` with the item; a Music Clip laid from it with `speech: true` makes a ducked song's `dry_run` list speech spans from it.
- [x] Settings: Gemini TTS is offered with `GEMINI_API_KEY` set and `LLM_PROVIDER=openai`, and not without the key.
- [x] Gemini adapter through `httpx.MockTransport`: the request carries the Voice and text; the returned audio decodes to PCM at the stated rate; 401/403 give a message naming the key.
- [x] Vitest: Generate lands a Speech Music Clip at the playhead on a free lane, Picked, one undo step; Undo keeps the Media item.
- [x] Vitest: the tab shows in the phone bottom sheet.
- [x] GLOSSARY Narration/Voice and ADR 0019 match what was built.
