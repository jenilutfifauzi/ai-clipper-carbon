# 04: Selection: Transcript → Candidates

**Parent spec:** `spec.md` in this feature folder (Milestone M2; user stories 21–30; Selection and LLM modules).

**What to build:** Once the Transcript exists, the Job analyzes it with Gemini:
1. a Score pass over Windows;
2. a shortlist;
3. a Detail pass that sees the full Transcript.

The Job then stops in `review` with ranked Candidates. Each Candidate carries:
- its score and reasoning fields;
- hook text and title;
- TikTok, Instagram, and Shorts descriptions with hashtags.

Candidates are visible through the API and the CLI. This ticket introduces the LLM port: a real Gemini 3.8 Flash implementation and a fake that replays recorded responses.

**Blocked by:** 02 (Tracer: URL → Job → YouTube Transcript).

**Status:** done

- [x] Windows are max(90 s, 1.5× the maximum clip length) long, overlap by 30 s, and have edges snapped to Words.
- [x] The Score pass sends Windows in batches of 8 at temperature 0.2. It returns schema-validated 0–100 scores, using the "2-second hook test" rule from the adapted prompt.
- [x] The target count is max(3, round(episode minutes ÷ 9)). The shortlist is about twice the target.
- [x] The Detail pass receives:
  - the full Transcript in a compact `[mm:ss] text` form;
  - the shortlisted Windows.

  It returns schema-validated Candidates with:
  - start and end;
  - predicted score, hook strength, emotion, retention notes, and reason;
  - hook text (at most 2 lines, about 40 characters);
  - title;
  - TikTok, Instagram, and Shorts descriptions and hashtags, in the transcript's language.
- [x] Post-processing:
  - snaps each Candidate to Words (±1.5 s search, 0.35 s lead-in, 0.45 s tail);
  - removes overlapping Candidates;
  - enforces the Job's duration range (default 20–90 s).
- [x] Candidates are ranked by predicted score, and the Job's status becomes `review`.
- [x] Prompts are adapted from openshorts' Score and Detail templates with attribution. A prompt version identifier is recorded on the Job.
- [x] Transient LLM errors are retried with exponential backoff.
- [x] Seam A tests with recorded fake LLM responses cover:
  - off-word times getting snapped;
  - overlap removal;
  - out-of-range durations getting handled;
  - the target count;
  - the ranking.
- [x] The CLI prints the Candidates: rank, time range, score, title, and hook.
- [ ] Manual smoke check: a real episode yields plausible Candidates.

## Comments

**2026-10-13: implemented, not committed (awaiting owner review).** `make test`: 52 passed (24 new), about 12 s. The manual smoke check is left open: it needs the owner's Gemini API key.

Built (in `backend/app/`):
- `llm.py`: the LLM port and `GeminiLlm`.
- `prompts.py`: the Score and Detail templates, adapted from openshorts, and `PROMPT_VERSION`.
- `selection.py`: `select()`, which runs Windows → Score pass → shortlist → Detail pass → post-processing.
- `candidates.py`: `Candidate` and `Descriptions`.
- `config.py`: `SelectionTuning`, held in `Settings.selection`. Every Selection number lives there, and tests shrink the retry delay.
- `jobs.py`, `pipeline.py`, `api.py`, `cli.py`: the `analyzing` stage, `review` as the end state, the artifacts, `candidates` on `GET /api/jobs/{id}`, and the CLI printout.
- In the `Makefile`: `make reanalyze JOB=<id>`.
- `THIRD_PARTY_NOTICES.md` now names the files adapted from openshorts.

Design notes for tickets 05–09:
- **The LLM port** (`app/llm.py`).
  - `Llm` has two calls: `score(LlmRequest) -> ScoreResponse` and `detail(LlmRequest) -> DetailResponse`.
  - `LlmRequest` is `(prompt, temperature)`. Prompts are built by Selection, so a fake sees exactly what Gemini would see.
  - The responses are pydantic models:
    - `ScoreResponse.windows`: `{id, reason, score 0–100}`;
    - `DetailResponse.clips`: `ClipProposal {window_id, start, end, reason, emotion, hook_strength, retention_notes, predicted_score, viral_hook_text, title, tiktok/instagram/shorts_description, hashtags}`, with `start`/`end` as strings such as `"12:34"`, `"1:02:03"` or `"12:36.5"`.
  - Errors:
    - `TransientLlmError` is retried by Selection: 5 attempts, waiting 2, 4, 8 and 16 s;
    - `QuotaExceeded` is not retried;
    - `LlmError` fails the Job.
  - `GeminiLlm` calls google-genai 2.30.0's `models.generate_content` with `response_mime_type="application/json"` and `response_json_schema=Model.model_json_schema()`, then validates the answer with `model_validate_json`.
    - The SDK's own retries are off, and requests time out after 10 min.
    - The client is created on the first call. A missing key fails `analyzing` with a clear message, and the app still starts.
    - Errors are classified like this:
      - HTTP 429 or `RESOURCE_EXHAUSTED` → `QuotaExceeded`;
      - 408, 5xx, an httpx connect/timeout error, or an answer that doesn't fit the schema → transient;
      - any other 4xx, or a blocked prompt or answer → `LlmError`.
  - `FakeLlm` (in `tests/fakes.py`) works like this:
    - Score: each Window in the prompt gets `score_window(text)`; it reads the Windows with `windows_in()`;
    - Detail: it returns `clips`, hand-written dicts in the schema's shape;
    - `fail_with(error, times)` makes the next calls raise;
    - it records `score_requests` and `detail_requests`. Ticket 06 can assert on `llm.detail_requests[0].prompt`.
  - **Ticket 09:** add an `audio` field (default empty) to `LlmRequest`, and have `GeminiLlm._generate` send it as `types.Part.from_bytes(...)` parts before the prompt. `select()` already has the shortlisted Windows' time ranges for extracting the audio.
- **Prompts and the version.**
  - Both templates and their fill functions (`score_prompt`, `detail_prompt`) are in `app/prompts.py`.
  - Bump `PROMPT_VERSION` (now `"v1"`) whenever any of these change: a template, how it's filled, the response schemas, or a temperature in `SelectionTuning`.
  - The version is stored as `Job.prompt_version` and in `selection.json`.
  - The Score prompt shows each Window as `<window id="w001" start="0:00" end="2:15">text</window>`.
  - The Detail prompt is laid out with the full Transcript first and the instructions last, the usual layout for long-context prompts. In order:
    - `TRANSCRIPT_LANGUAGE`, `EPISODE_DURATION`, `CLIP_DURATION` and `CLIP_COUNT` header lines;
    - `FULL TRANSCRIPT:`, one `[m:ss] text` line per Segment, using `h:mm:ss` from 1 h on and rounding down to the second;
    - the shortlist, as `- w003 [4:10–6:25] score 82: reason`;
    - the rules.
  - Copy (hook, title, descriptions, hashtags) is asked for in the transcript's language, with Indonesian hook examples in the speakers' register. The assessment fields (`reason`, `emotion`, `retention_notes`) are asked for in English, for the reviewer; that's one line to change.
  - **Ticket 06:** add CHANNEL_PROFILE, BRIEF and EXAMPLES sections to `DETAIL_TEMPLATE` (before TIME CONTRACT), as parameters of `detail_prompt()` and `select()`. Consider giving the Brief to the Score pass too: otherwise a Brief such as "find the funny moments" can't change the shortlist.
- **Windows and the Score pass.**
  - Windows hold whole Words, at most `max(90, 1.5 × max_secs)` long, and each starts at the first Word less than 30 s before the previous Window ends.
  - The last Window reaches back a full length from the Transcript's end, instead of being a short leftover.
  - Batches are near-equal and hold at most 8 Windows: 9 Windows go 5 + 4, not 8 + 1, so no Window is scored alone (openshorts' `score_batches` lesson). There are `ceil(n / 8)` requests.
  - A Window the answer leaves out gets no score and is shortlisted last.
- **Shortlist.**
  - It holds the `round(2 × target)` best-scoring Windows, ties going to the earlier.
  - A Window that overlaps one already picked by more than 50% of the shorter one is skipped. In practice that only affects the full-length last Window.
  - The target is `max(3, floor(minutes / 9 + 0.5))`.
- **Post-processing order** (documented in `selection._candidates`):
  1. **Snap.** Detail times are read as Transcript labels.
     - A start that is exactly a line's label means that line's first Word.
     - An end that is exactly a label means the last Word before that line: the prompt asks for the label of the first line after the clip.
     - Otherwise the start snaps to the nearest Word start within ±1.5 s and the end to the nearest Word end; past that, to the first Word after or the last Word before.
     - Then the lead-in (0.35 s) and tail (0.45 s) are added, cut short so they never reach into the neighbouring Word, and kept within the Source.
     - Inside a YouTube caption line the Words touch (end = next start), so a mid-line edge gets no lead-in or tail.
     - Why the label rule: labels are rounded down, so plain nearest-Word snapping kept starting clips with the previous line's last Word and ending them one Word early. A test with lines 0.9 s after their labels covers this.
  2. **Overlaps.** Proposals are sorted by predicted score, then hook strength, then the earlier start. One that shares a Word with a better one is dropped. Sharing only silence is fine.
  3. **Duration range (the rule).** A Candidate outside the Job's range is fitted at Word boundaries:
     - one that is too long loses Words from the end, which keeps the hook;
     - one that is too short gains Words after the end, then before the start, but never into a neighbour;
     - this is done only if the edges move by at most 15 s in all (`duration_fix_secs`); further out it is dropped, since it's no longer the moment that was proposed.
  4. **Target count.** Only the best `target` are kept.
  5. **Rank.** By predicted score. Each Candidate gets a random 8-hex `id`, set once when Selection creates it.
- **Artifacts.**
  - `candidates.json` is the working list. Ticket 11's edits go there, addressed by `id`.
  - `selection.json` is the run:
    - `prompt_version` and `target_count`;
    - every Window's time range, score and reason;
    - the shortlist ids;
    - the raw Detail `proposals` before post-processing;
    - the Candidates as produced.
  - For ticket 05, a missed reference can be traced either to the Score pass (its Window scored low, or wasn't shortlisted) or to the Detail pass (no proposal near it).
- **Re-running selection on an existing Job.**
  - `make reanalyze JOB=<id>` (CLI `reanalyze <job-id>`) calls `Pipeline.run(job_id, start=JobStatus.ANALYZING)`.
  - It uses the stored Transcript, with no download, replaces `candidates.json` and `selection.json`, records the new prompt version, and prints the Candidates.
  - `run()` now clears `error` when a stage starts, so ticket 07's retry and resume can build on `start=`.
  - Ticket 05 can either call `select()` directly on a cached Transcript or run the pipeline from `analyzing`.
- **Lifecycle.**
  - The states are `queued` → `downloading` → `transcribing` → `analyzing` → `review`. `transcribed` is gone.
  - Jobs saved under it (the three smoke Jobs in `data/jobs/`) now read as `error` at stage `analyzing`, with the hint "Not analyzed yet: run `make reanalyze JOB=<id>`". The listing still works.
  - Progress during `analyzing`:
    - the percent moves after each Score request;
    - messages: "Scoring 35 Windows (request 2 of 5)", "Choosing 7 Candidates from 14 shortlisted Windows", "Retrying in 4 s: …".
- **Quota (ticket 07).**
  - `QuotaExceeded` propagates out of `select()` uncaught, and `Pipeline.run` records it as `error` for now ("Gemini's quota is used up; try again later. 429 RESOURCE_EXHAUSTED: …").
  - Ticket 07 can catch it in the pipeline and move the Job to `waiting_quota`.
  - Score results finished before the quota error are not cached, so the whole stage reruns.
- **Tests.**
  - `test_selection.py` (13 tests) uses `FakeLlm` and a synthetic 62-minute episode with known Word timings. The fixtures are in `tests/conftest.py`:
    - `episode` and `from_episode`;
    - `caption_track()`;
    - a realistic Detail answer in `tests/fixtures/detail_response.json`.
  - `test_gemini.py` (10 tests) runs the real `GeminiLlm` against an httpx `MockTransport` that stands in for `generateContent`. It covers:
    - the request shape (model URL, key header, temperatures 0.2 and 0.9, JSON schema);
    - retries on 503, 500, connect errors, timeouts and off-schema answers;
    - no retries on quota, bad-key and blocked errors;
    - a missing key, with zero requests sent.
  - The new tests were mutation-checked. Breaking any one of these rules fails a test: label snapping, the lead-in, not cutting neighbouring Words, near-equal batches, overlap removal, the target trim, the duration drop, the retry, the quota classification, the shortlist size, the ranking, the Window overlap.

Open issues:
- **Not run against real Gemini** (no key). Still unverified:
  - copy language and quality;
  - whether the model follows the label time contract;
  - whether gemini-3.8-flash accepts this `response_json_schema` (`$defs`/`$ref`, `minimum`/`maximum`).

  Smoke check: put `GEMINI_API_KEY` in `.env`, then run `make reanalyze JOB=8ef59ab26333` (the 8-minute episode from ticket 03, already downloaded) and `make analyze URL=…` on a full-length episode.
- **Temperatures.** Google's Gemini 3 guidance is to keep the default temperature 1.0, and warns that lower values can cause looping or degraded output. The spec's 0.2 (Score) and openshorts' 0.9 (Detail) are used as given. If Score answers loop or flatten, try 1.0 in ticket 08. The thinking level is left at the model default, another knob for ticket 08.
- **Free-tier rate limits.** A 3-hour episode is about 100 Windows, so about 13 Score requests plus 1 Detail, sent back to back. A per-minute limit could raise `QuotaExceeded`, which fails the Job until ticket 07.
- **Interactions API.** Google now recommends the Interactions API for new work, while `generateContent` "remains fully supported". A switch would only touch `GeminiLlm`.
- **Unenforced limits.** The hook's ~40 characters and the 3–5 hashtags are prompt instructions only: Gemini's schema subset has no string-length keyword. Hashtags are normalized to start with `#`.
- **`reanalyze` replaces Candidates.** Once ticket 11 exists, review edits would be lost.

**2026-10-13: verified by the owner's session.** `make test` passes (52 passed). Prompts reviewed. The only open item is the real-Gemini smoke check, which needs the owner's API key. It is carried into ticket 08, which runs real Gemini anyway; start with `make reanalyze JOB=8ef59ab26333`. Also for ticket 08: Google recommends temperature 1.0 for Gemini 3 models, so revisit the Score pass's 0.2. Committed.

**2026-10-13: second LLM provider, not committed (awaiting owner review).** `make test`: 133 passed (31 new), about 27 s. Not run against the real DeepSeek API (no key here).
- **Choice.** `LLM_PROVIDER=gemini` (the default, unchanged; `GEMINI_*` keys) or `openai`: `OpenAiLlm` in `app/llm.py`, an OpenAI-compatible Chat Completions client on plain httpx, with `LLM_BASE_URL` (default `https://api.deepseek.com`), `LLM_API_KEY`, `LLM_MODEL` (default `deepseek-flash`) and `LLM_THINKING` (`enabled`/`disabled`, default `disabled`). `real_ports` picks the port.
- **Request.** JSON mode (`response_format: json_object`). A system message says to answer with one JSON object fitting the response schema and holds `model_json_schema()`; the user message is the prompt from `app/prompts.py`, unchanged, so a comparison between providers is about the model. `PROMPT_VERSION` stays `v2`. `max_tokens` is 16,384, or 65,536 with thinking. `thinking: {"type": …}` is sent only when the base URL's host is `api.deepseek.com`.
- **Errors.** Empty, unparsable or off-schema content is transient (retried). 429 → `QuotaExceeded`, with a numeric `Retry-After` as the wait. 503/504 → `Overloaded`; 408, other 5xx, connection errors and timeouts → transient. 401 → "check LLM_API_KEY"; 402 → "top up the DeepSeek balance"; other 4xx → the server's message. A missing `LLM_API_KEY`, or `SELECTION_AUDIO_SIGNAL=true` (Gemini-only), fails `analyzing` with a clear message before any request; start-up is unaffected.
- **Pacing.** `LLM_REQUEST_INTERVAL_SECS` sets `QuotaTuning.request_interval_secs`; empty means 13 s for gemini, 1 s for openai.
- **Traceability.** `Settings.llm` is an `LlmChoice {provider, model, thinking}` (thinking is null except for DeepSeek). It is recorded as `llm` in `selection.json` and in `report.json`, shown on report.md's `LLM:` line and in the eval's terminal summary, and is part of the Score-batch cache key. Messages name the service: "Waiting for DeepSeek: …", "DeepSeek is busy. 503 …".
- **Tests.** `test_openai.py` covers the request shape, parsing, retries, the rate-limit wait, busy waits, the clear errors and `real_ports`. `test_resilience.py` checks that the cache misses when the provider or thinking changes; `test_config.py` covers the new keys; `test_evaluation.py` checks the recorded LLM. `conftest`'s settings pin `LLM_PROVIDER=gemini`, so the suite passes whatever `.env` says.
- **For the eval.** Run `make eval` once with Gemini, once with DeepSeek with `LLM_THINKING=disabled`, and once with `enabled`. Then compare the reports.
