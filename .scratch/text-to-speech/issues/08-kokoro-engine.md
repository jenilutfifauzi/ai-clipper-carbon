# 08: Kokoro reads on this Mac

**Parent spec:** `spec.md` in this feature folder (User Stories 14–16; Implementation Decisions "Engines" (Kokoro)); ADR 0019.

**What to build:** with Kokoro's model downloaded, the owner picks it ("On this Mac") for an English Job, and the Narration is read locally, words never leaving the Mac.

- **sherpa-onnx** becomes a backend dependency (check the Apple Silicon wheel installs into the shared `.venv`). Its Kokoro archive brings espeak-ng data and lexicons; no brew package.
- **English Voices only:** American and British, female and male, with names and detail lines ("Heart" · "American · female").
- **Speed** goes to the engine natively. Kokoro takes no Style.
- **The loaded engine** stays in memory until the model is removed. Removal unloads it.
- **Samples:** Kokoro's Play sample is off until the model is downloaded.
- **Default engine:** an English Job now defaults to Kokoro when it is ready.

**Blocked by:** 07.

**Status:** ready-for-agent

- [ ] Kokoro lists only English Voices, and is not ready without the model.
- [ ] Real synthesis (skipped unless the model is present): one English sentence reads to non-silent audio at the engine's rate; Speed 2 is shorter than Speed 1.
- [ ] Seam A: an English Job's default engine is Kokoro once ready.
- [ ] Vitest: Kokoro's samples are off until downloaded; no Style line for Kokoro.
