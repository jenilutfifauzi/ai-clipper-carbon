# 03: An OpenAI-compatible engine and the engine picker

**Parent spec:** `spec.md` in this feature folder (User Stories 14–17, 47, 53; Implementation Decisions "Engines" (OpenAI-compatible, configuration, default engine), "Frontend"); ADR 0019.

**What to build:** the owner can choose among the engines that are set up, each labelled with where the words go, and the right one is usually already chosen.

- **OpenAI-compatible speech.** Offered when `TTS_BASE_URL`, `TTS_API_KEY` and `TTS_MODEL` are all set. Its Voices are the service's standard list, overridable by `TTS_VOICES`. It calls `/audio/speech` and decodes the returned audio. These settings are read beside the LLM settings, and none of the LLM code paths change.
- **The engine picker.** Each engine labelled "<service> · cloud" (or "On this Mac" for local ones, used later by Kokoro). Choosing one swaps the Voice list.
- **The default engine** follows the Job's language: Indonesian gets the first ready cloud engine (Gemini, then OpenAI-compatible); English gets a ready local engine, else the first cloud one. The browser then remembers the last engine and Voice (localStorage, wrapped in try/catch).
- **No ready engine.** The tab shows a hint naming the `.env` settings, and Generate is off.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Settings: the OpenAI-compatible engine is offered only when all three `TTS_*` settings are set; `TTS_VOICES` replaces its Voice list.
- [ ] Seam A: `GET /api/voices` gives the default engine for an Indonesian and an English Job.
- [ ] OpenAI adapter through `httpx.MockTransport`: the request carries the model, Voice and text; the audio decodes to PCM; 429/5xx are transient; 401/403 name the key.
- [ ] Vitest: the default engine follows the Job's language; a remembered choice wins; storage that throws falls back to the default.
- [ ] Vitest: the labels read "<service> · cloud"; switching engine swaps the Voices.
- [ ] Vitest: with no ready engine, the hint shows and Generate is off.
