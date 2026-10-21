# 06: Voice samples

**Parent spec:** `spec.md` in this feature folder (User Stories 19–20, 45; Implementation Decisions "HTTP API" (sample)); ADR 0019.

**What to build:** each Voice in the list has Play sample. `GET /api/voices/{engine}/{voice}/sample?lang=` reads a fixed sentence in the Job's language (Indonesian and English sentences in code) the first time, keeps it on this Mac per engine, Voice and language, and serves it from there afterwards. Samples go through the one-at-a-time runner, so a sample is refused as busy while a Narration is being made, and refused for an engine that isn't ready.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Seam A: the first sample calls the engine once; the second is served without calling it.
- [ ] Seam A: a different language or Voice makes a new sample.
- [ ] Seam A: a sample while a Narration runs is 409; for an engine that isn't ready, 422.
- [ ] Vitest: Play sample plays the returned sound, and shows busy when refused.
