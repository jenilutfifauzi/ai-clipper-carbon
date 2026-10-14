# 09: Audio-signal mode (conditional)

**Parent spec:** `spec.md` in this feature folder (user story 67; Selection module, audio-signal mode).

> **Condition:** do this ticket only if ticket 08 ended without passing the gate. If the gate passed, this ticket is `wontfix`.

**What to build:** A flag (off by default) that sends each shortlisted Window's audio to the Detail pass alongside the text, so laughter, tone, and energy count toward selection. Then re-run the evaluation and compare the result with the best text-only version.

**Blocked by:** 08 (Selection gate).

**Status:** ready-for-agent

- [x] With the flag off, behaviour is unchanged.
- [x] With the flag on, audio is extracted for the shortlisted Windows only and attached to the Detail request. Free-tier limits are respected through the existing backoff and `waiting_quota` handling.
- [x] Seam A test: with the flag on, the fake LLM receives audio parts for exactly the shortlisted Windows.
- [ ] An eval report is saved with the flag on, together with a comparison against the best text-only report.
- [ ] If the gate still fails: record the result, keep the better configuration as default, and proceed.

## Comments

**2026-10-14: built ahead of ticket 08's gate at the owner's request; off by default; not committed (awaiting owner review).** `make test`: 252 passed (243 + 9 new in `tests/test_audio_signal.py`), about 3 min on a loaded M1; the new module takes about 50 s, as it runs real ffmpeg Opus encodes. No real LLM call was made: Gemini is mocked at HTTP, DeepSeek can't take audio. The three ticked boxes are verified with fakes at the ports; the eval boxes wait for a real run.

Built:
- **Extraction** (`app/audio.py` `window_audio`). The configured ffmpeg cuts each shortlisted Window's range from the Source's first audio stream into mono Ogg Opus, 16 kb/s at 16 kHz, with no metadata (`audio/ogg`). Gemini hears audio at about 16 kb/s anyway. A 135 s Window comes to about 270 kB. Each range is cached in the Job's `window_audio/<start ms>-<end ms>.<bitrate>.<rate>.ogg` and written via a `.part` file, so a resumed or re-analyzed run doesn't encode it again. Encodes run 4 at a time (`SelectionTuning.audio_workers`), about 0.7 s of one core each. A Source with no audio stream fails `analyzing` with "ffmpeg couldn't extract the audio of …".
- **Request** (`app/llm.py`).
  - `LlmRequest` gains `audio: tuple[AudioPart, ...] = ()`, where `AudioPart` is `{window_id, label, data, mime_type}`.
  - `GeminiLlm` sends inline parts in one user turn: for each Window, the label text ("Audio of window w003 [4:10–6:25]:") and then `Part.from_bytes`. The prompt comes last.
  - google-genai 2.30.0 serializes these as `inlineData: {data: <URL-safe base64>, mime_type}`. The test pins that shape.
  - With no audio, `contents` is still the plain prompt string.
  - The OpenAI-compatible port still refuses the flag with its existing message, before any request and before any extraction (tested end to end through the pipeline).
- **Size cap** (`selection._audio`). Gemini's inline request limit is 20 MB, prompt and base64 included. That is `SelectionTuning.audio_request_max_bytes = 20_000_000`. Recordings are counted as base64, plus the prompt's JSON size and 64 kB of overhead, and taken best-scored first. Once one doesn't fit, it and every lower-scored one are left out.
  - The Job gets a warning: "Audio-signal mode: the audio of N of the M shortlisted Windows (w…, the lowest-scored) was left out, … They were judged on their transcript alone."
  - The test checks that the real HTTP body stays under the cap.
  - If nothing fits, the request is text-only and the version stays `v3`.
  - I chose dropping over a Files API fallback. Estimates: a 1-hour episode (14 Windows) is about 5 MB; a 3-hour one (about 40 Windows) about 14.5 MB, so the cap shouldn't bite in practice.
- **Prompt** (`app/prompts.py`). When audio is attached, an AUDIO section comes first in the steering block, before CHANNEL PROFILE, so just before TIME CONTRACT when there's no steering. It says:
  - use laughter, tone, energy and pacing as signals;
  - a Window without a recording is judged on its text alone;
  - take times from the transcript labels, never from a recording's own clock.

  A run with audio has the version `prompt_version(True)` = `v3-audio`, from `PROMPT_VERSION` + `AUDIO_SUFFIX`. The Score pass and its cache key are unchanged.
- **Recorded.**
  - `selection.json` gains `audio_signal` and `audio_windows` (the ids heard). `llm` already gives the provider. `Job.prompt_version` shows `v3-audio`.
  - `report.json` gains `audio_signal`, plus per episode `shortlisted` and `audio_windows`.
  - Audio reports are saved under `eval/reports/v3-audio/`. Their `report.md` has an "Audio signal: on" line, "audio for N of M shortlisted Windows" per episode, and a "Compared with text-only selection" section.
  - That section picks the best text-only report on the same Reference Set: highest recall, then most postable, then newest. It shows the recall and, per episode, the references found and the postable counts on both sides.
  - The terminal summary and `make gate` print the same comparison. `make gate` also shows the audio report's own postable counts.
  - Text-only reports are unchanged.
- **Flag off is byte-identical.** I ran `select()` through the real `GeminiLlm` against a mock transport, from a worktree of HEAD and from this tree: 12 Score and Detail request bodies, with and without a profile and Brief, had identical sha256 hashes.

Tests (`test_audio_signal.py`; `FakeGeminiApi` now reads the prompt from the last part and takes scripted scores):
- flag on: audio parts for exactly the shortlisted Windows, in order, labelled, each an Opus mono file as long as its Window; the AUDIO section only in the Detail prompt; no audio in Score requests; `v3-audio` recorded;
- flag off: the same Score requests, and a Detail request equal to the audio one with only the AUDIO section removed; no audio and no `window_audio/`;
- the real Gemini port's inline serialization, byte for byte against the cached files;
- the size cap: the best-scored are kept, the lowest-scored dropped, the warning is checked, and the body stays ≤ the cap; with no room at all, the request is text-only;
- a quota error on the Detail pass: `waiting_quota`, then the same audio is sent again, with each Window encoded once;
- the cache, and a Source without audio;
- openai plus the flag: the clear error and zero requests;
- an audio eval compared with the better of two text-only reports, in `report.md` and in the gate summary.

Mutation-checked: dropping the best-scored instead of the lowest-scored, adding the AUDIO section with no audio attached, and changing the flag-off prompt each fail a test.

**How to run the comparison once Gemini billing is on** (needs ticket 08's `eval/references.yaml`):
1. Text-only baseline, unless a judged text-only report on the same Reference Set already exists. In `.env`:
   ```
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=<a key on a billed project>
   GEMINI_MODEL=gemini-3.6-flash
   SELECTION_AUDIO_SIGNAL=false
   LLM_REQUEST_INTERVAL_SECS=1
   ```
   (The interval line is optional on a paid tier; leave it empty to keep the free tier's 13 s.) Run `make eval`, write the counts in that report's `postable.yaml`, then `make gate REPORT=eval/reports/v3/<time>`.
2. Audio run: set `SELECTION_AUDIO_SIGNAL=true` in `.env`, or run `SELECTION_AUDIO_SIGNAL=true make eval` (environment variables override `.env`). The report lands in `eval/reports/v3-audio/<time>/`. Its `report.md` has the comparison after the episode table.
3. Judge its `postable.yaml`, then run `make gate REPORT=eval/reports/v3-audio/<time>`. That prints the gate and the side-by-side with the best text-only report.
4. Keep whichever configuration is better as the default (`SELECTION_AUDIO_SIGNAL` in `.env` / `.env.example`) and record it here.

Cost: Gemini counts audio at about 32 tokens a second. That is about 60k extra input tokens per 1-hour episode, and about 170k for a 3-hour one, on the single Detail request. The free tier's per-minute token limit may not take that.

**The real eval is pending:** no audio report exists yet, and the last two boxes stay open.

Open issues:
- **Untested against the real API:** that Gemini accepts `audio/ogg` Opus inline with these labels, and that it keeps to transcript-label times (the prompt warns against using a recording's clock).
- **No Files API path.** Past the cap, audio is dropped, not uploaded.
- **`window_audio/` is never cleaned up.** It holds about 4 MB per 1-hour Job.
- **The best text-only report can be from another LLM** (e.g. DeepSeek). The comparison line names it.
