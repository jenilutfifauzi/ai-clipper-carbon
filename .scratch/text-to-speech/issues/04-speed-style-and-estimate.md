# 04: Speed, Style and the estimate

**Parent spec:** `spec.md` in this feature folder (User Stories 21–26; Implementation Decisions "Engines" (Speed and Style per engine), "Frontend"); ADR 0019.

**What to build:** the owner shapes the read and knows its length before generating.

- **Speed, 0.5–2×.** The OpenAI-compatible engine gets it through the service's `speed` field. Gemini has none, so the read is retimed afterwards with a pitch-keeping tempo change, the same treatment Music Clip Speed uses.
- **Style.** A one-line instruction ("warm, unhurried"), shown only for engines that take one: Gemini always, OpenAI-compatible when `TTS_STYLE` is on (on by default for instruction-taking models).
- **The estimate.** "About m:ss · N characters" from a characters-per-second constant per language, scaled by Speed. Past 5,000 characters the count turns into the limit message and Generate is off.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Seam A: Speed 2 with the fake engine (no native speed) gives a Narration about half as long, pitch kept (the tone's frequency unchanged).
- [ ] Adapters: OpenAI sends `speed` and, when allowed, the instructions; Gemini sends the Style and no speed.
- [ ] Seam A: a Style sent to an engine that doesn't take one is refused (422).
- [ ] Vitest: the Style line shows only for engines that take one.
- [ ] Vitest: the estimate follows the script, language and Speed; past 5,000 characters Generate is off with the message.
