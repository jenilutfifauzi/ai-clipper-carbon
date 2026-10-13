# 06: Channel Profile, Brief & few-shot

**Parent spec:** `spec.md` in this feature folder (Milestone M2; user stories 7, 18–21; Channel Profile module).

**What to build:** I keep one Channel Profile (niche, audience, clip style, things to avoid) and can read and change it through the API. I can add an optional Brief to any Job. The Detail pass uses three inputs:
- the Channel Profile;
- the Brief;
- few-shot examples drawn from my `fewshot` Reference Set clips.

An episode can never be both `eval` and `fewshot`.

**Blocked by:** 04 (Selection: Transcript → Candidates), 05 (Evaluation Harness).

**Status:** done

- [x] The Channel Profile can be read and replaced through the API and is persisted. Each new Job records a snapshot of the profile it used.
- [x] Job creation, in both the API and the CLI, accepts an optional Brief. The Brief is included in the Detail pass and shown in the Job details.
- [x] Few-shot examples are built from `fewshot` references as a Transcript excerpt plus the owner's note. Those episodes are fetched and cached through the same Source and Transcript path.
- [x] The Evaluation Harness and the few-shot builder both refuse a Reference Set where an episode appears under both roles.
- [x] Seam A tests use a fake LLM that records requests. They assert the profile, the Brief, and the few-shot examples reach the Detail call (the port contract), and that Jobs without a Brief still work.

## Comments

**2026-10-13: implemented, not committed (awaiting owner review).** `make test`: 71 passed in about 14 s (9 new tests in `test_steering.py`, and the eval test extended). Every box is verified with fakes at the ports. Nothing was run against real Gemini (no key).

Built (in `backend/app/`):
- `profile.py`: `ChannelProfile` and `ProfileStore`.
- `fewshot.py`: `few_shot_examples()` and `Example`.
- `storage.py`: `write_atomic`, moved out of `jobs.py` so the two new modules can use it without an import cycle.
- `video_source.py`: `VideoSource.fetch_captions`.
- Wiring in `prompts.py`, `selection.py`, `pipeline.py`, `jobs.py`, `api.py`, `main.py`, `cli.py`, `evaluation.py` and `config.py`, as described below.

**Channel Profile.**
- Fields: `niche`, `audience`, `clip_style`, `avoid`. All are optional free text, trimmed at the edges. An empty profile is valid.
- It lives in `DATA_DIR/profile.json`, written atomically. With no file, the profile is empty.
- `GET /api/profile` returns it. `PUT /api/profile` replaces it whole and returns the saved profile: a field left out becomes `""`, and a non-string gives 422.
- **Snapshot.** `JobStore.create(url, options, profile)` stores the current profile as `Job.profile`, from both the API and the CLI. Selection steers by the snapshot, so a profile edit only affects new Jobs. The snapshot appears in `GET /api/jobs/{id}` and in the listing. Jobs saved before this ticket read with an empty profile, which is what they ran with.
- `make reanalyze` keeps the Job's snapshot and Brief. The eval swaps a reused Job's snapshot for the current profile before analyzing it again (decision 5). Either way, `Job.profile` is always the profile behind the Job's current Candidates.

**Brief.**
- `JobOptions.brief` is trimmed, and a blank Brief becomes `null`. It shows in the Job details as `options.brief`.
- CLI: `analyze --brief "…"`, or `make analyze URL=… ARGS='--brief "…"'`. The Brief is printed with the Candidates.

**Prompts.** `PROMPT_VERSION` is now `"v2"`.
- **Detail pass.** Three sections go between the shortlist and TIME CONTRACT, in this order:
  1. CHANNEL PROFILE: every non-empty field in full, as a list item; multi-line text keeps its lines, indented;
  2. EXAMPLES;
  3. BRIEF.
- **Deviation from the spec (decided by the owner's session):** the Score pass also gets the Brief and a short form of the profile, as extra rule lines after the `reason` rule. It does not get the few-shot examples.
  - The short form flattens each non-empty field to one line and cuts it at a word boundary to `SelectionTuning.profile_summary_chars` (200), ending with "…". It is short because every batch repeats it.
  - The Brief is worded as a priority, not a filter. A window that fits it scores clearly higher than an equally strong one that doesn't, but every window is still scored on its own merits over the full range.
- In the Detail pass, the moments that fit the Brief come first, then CLIP_COUNT is filled with the strongest other moments. Where the Brief and the profile disagree, the Brief wins.
- A section, and any sentence that goes with it (such as the "avoid" rule), is left out when it has nothing to say. With no profile, Brief or examples, the v2 prompts are byte-identical to v1 (checked).

**Few-shot examples** (`fewshot.py`, built at the start of the analyzing stage).
- **Source.** They come from `Settings.reference_set`. It defaults to ticket 05's `eval/references.yaml` and isn't read from the environment. The eval points it at the Reference Set it measures against; tests point it at a temporary file. Without the file there are no examples and no warning.
- **Invalid sets.** The set is read with `load_reference_set`. An episode under both roles, or any other invalid entry, fails the Job at `analyzing` with the loader's line-numbered message, before any fetch or LLM call.
- **An example** is the owner's note (whitespace flattened) plus the Words of the episode's Transcript whose midpoint falls in [start, end). The prompt shows it as `<example duration="45 s">`, then `Note: …`, then `Transcript: …`.
- **Captions-only port method.** `VideoSource.fetch_captions(url, language, dest) -> str | None` returns the caption track's file name in `dest`, or None when there are no captions.
  - `YtDlpVideoSource` runs yt-dlp with `fetch`'s caption and cookie options plus `skip_download` and `ignore_no_formats_error`. It sets no format, merge or remux options.
  - The track is parsed with the same `parse_json3`.
  - Few-shot never triggers a local transcription.
- **Cache.** `DATA_DIR/fewshot/<video id>/` holds the json3 track and `transcript.<language>.json`. Once the transcript file exists, the episode isn't fetched again for that language. A "no captions" result isn't cached, because captions can appear later: the next Job asks again.
- **Warnings** go on the Job, deduplicated when the Job is analyzed again, and each one names the clips left out. There are three cases:
  - an episode without captions;
  - a failed captions fetch, such as a private video (the Job carries on);
  - a clip whose range has no captioned Words.
- **Cap** (`SelectionTuning`):
  - at most `fewshot_max_examples` = 8 examples;
  - lasting at most `fewshot_max_secs` = 600 s together (about 1,500 words);
  - taken in turn from each episode, in file order. A clip that would go past the time cap is skipped and the next one tried. Clips over the cap are logged, not warned about.
- `selection.json` records the examples shown (`Selection.examples`). While fetching, the progress message reads "Fetching the captions of few-shot episode 1 of 3".

**Eval.**
- Eval Jobs use the current profile, no Brief, and the few-shot examples from the Reference Set being evaluated. A fewshot episode now gets a cached captions-only fetch, but still never a video fetch or an analysis.
- `report.json` gains `profile` and, per episode, `examples` (a count) and `warnings` (the Job's).
- `report.md` gains a "Channel Profile: …" line, "N few-shot examples" per episode, and any warnings. The terminal summary prints the warnings.
- A profile edit changes eval results without a `PROMPT_VERSION` bump. Compare the "Channel Profile" line between reports.

**Tests.**
- `test_steering.py`, Seam A through the API:
  - the profile round-trips through GET and PUT, with replace semantics, trimming and the 422, and survives an app restart;
  - a Job keeps its snapshot when the profile changes while the Job is held in `downloading`, and the next Job uses the new profile;
  - the Brief is in every Score request and in the Detail request;
  - the Score pass gets the short profile (a cut `avoid`, a flattened `clip_style`, and the full text absent), and the Detail pass gets it in full, between the shortlist and TIME CONTRACT;
  - the exact excerpt and note of each few-shot clip appear in the Detail request only;
  - only the fewshot episode's captions are fetched (no video fetch, and the eval-role episode isn't touched), and a second Job doesn't fetch them again;
  - no captions, a failed fetch or an empty range each give a warning, and the other examples are kept;
  - with no profile, Brief or Reference Set (and with a Brief only, or a profile only), the Job reaches review with no empty section and no triple newline in any prompt;
  - an episode under both roles fails the Job at `analyzing` before any fetch or LLM call.
- `test_evaluation.py`: the current profile replaces the reused Job's snapshot and reaches the Detail pass, the fewshot clip reaches the Detail pass, its captions are fetched once across two runs, and the new report fields are checked.
- `FakeVideoSource.fetch_captions` serves `captions[url]`, which is a track, None, or an exception to raise (`caption_track` by default), and records each call in `caption_calls`.
- Mutation-checked. Each of these breaks a test:
  - the Brief left out of the Score pass;
  - examples sent to the Score pass;
  - no cache;
  - the full profile sent to the Score pass;
  - the eval keeping the old snapshot;
  - the eval ignoring its own Reference Set;
  - an excerpt that runs one line too far;
  - a profile heading that is always present.

**Smoke checks** (real yt-dlp, no Gemini, everything in a scratch directory):
- `fetch_captions` on https://www.youtube.com/watch?v=9xo4pOaTsxY took 3 s. It wrote only `source.id-orig.json3` and `source.id.json3`, no video. That's 75 words, "hari ini kita ngobrol bersama Yono Bakri…", the same as ticket 02.
- `few_shot_examples` with a one-clip Reference Set on that video took 2.7 s the first time and 0.00 s the second (cached), and the excerpt matched the clip.
- `analyze <unavailable video> --brief "  cari momen yang lucu "` with a scratch `DATA_DIR` and profile wrote a `job.json` holding the trimmed Brief and the profile snapshot. The Job then failed in `downloading`, as expected for that video.

Open issues:
- **Not run against real Gemini.** It's still unknown whether the Brief and profile wording moves the shortlist without squashing the score range. Check in ticket 08 by comparing the Window scores in `selection.json` with and without a Brief.
- **An invalid Reference Set fails every new Job at `analyzing`** until it's fixed; then run `make reanalyze`. That's the intended refusal, but ticket 10's UI should show the error clearly.
- **Stale warnings.** Warnings from an earlier analysis stay on the Job. For example, if captions appear later, the old "no captions" warning remains. Only exact duplicates are dropped.
- **Missing captions aren't cached**, so each Job asks YouTube again, about 3 s per such episode.
- **One language.** Examples use the Job's language only, so a fewshot episode in another language is left out with a warning.
- **No length limit** on profile fields or the Brief. The Score pass cuts profile fields to 200 characters; the Detail pass and the Brief are sent whole.

**2026-10-13: verified by the owner's session.** `make test` passes (71 passed). The Score-pass deviation (Brief plus a short profile summary in Score) was decided by the owner's session and is recorded here. Committed.
