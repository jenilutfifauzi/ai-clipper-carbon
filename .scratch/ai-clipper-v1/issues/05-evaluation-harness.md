# 05: Evaluation Harness

**Parent spec:** `spec.md` in this feature folder (Milestone M2; user stories 61–66; Evaluation Harness module).

**What to build:** As the owner, I list my past clips in a Reference Set file. I then run one command that analyzes each eval episode and produces a report with:
- recall;
- which references were found or missed;
- a top-5 Candidate list per episode, for my manual judgement.

Each report is saved under the prompt version that produced it, so iterations can be compared.

**Blocked by:** 04 (Selection: Transcript → Candidates).

**Status:** done

- [x] The Reference Set format holds: episode URL, start, end, note, and role (`eval` or `fewshot`). Invalid entries fail with clear errors.
- [x] The command analyzes every `eval` episode and reuses cached Sources and Transcripts where they exist. `fewshot` episodes are never evaluated.
- [x] A reference counts as found when some Candidate covers at least 50% of the reference clip's duration. Recall = found ÷ total across eval episodes.
- [x] The report contains:
  - per-episode recall and the found/missed references;
  - the top-5 Candidates with title, time range, reasoning, and a timestamped link for preview;
  - overall recall;
  - a field for the owner to record the postable count per episode.
- [x] Reports are saved with the prompt version and a timestamp. Earlier reports remain for comparison.
- [x] The recall computation is verified by a test against a hand-built example: partial overlaps just above and just below 50%, and several Candidates touching one reference.

## Comments

**2026-10-13: implemented, not committed (awaiting owner review).** `make test`: 62 passed (10 new), about 12 s. All six boxes are verified with fakes at the ports. A real `make eval` still needs the owner's Gemini key and Reference Set.

Built:
- `backend/app/references.py`: `load_reference_set(path) -> ReferenceSet`, `Reference`, `ReferenceSetError`, `video_id(url)`.
- `backend/app/evaluation.py`: `evaluate()` (the harness), `judge()` and `recall()` (the found rule), `gate()`, the report writers, `transcribed_job()`.
- `backend/app/jobs.py`: `JobStore.load_selection`.
- `backend/app/cli.py`: the `eval` and `gate` commands. In the `Makefile`: `make eval` and `make gate [REPORT=<folder>]`.
- `eval/references.example.yaml`: placeholder entries, with comments explaining the format.

**Reference Set** (`eval/references.yaml`).
- The file is committed so runs are reproducible. It doesn't exist yet: the owner copies the example to it. `make eval` without it says so.
- It is a YAML list with one entry per clip. All five fields are required: `url`, `start`, `end`, `note`, `role` (`eval` | `fewshot`).
- `url` can be any YouTube form: `watch?v=`, `youtu.be/`, `/live/`, `/shorts/`, `/embed/`, `m.`, `music.`, or no scheme. `&t=` and `si=` are ignored. It is normalized to `https://www.youtube.com/watch?v=<id>`, and entries with the same video are one episode.
- Times are `m:ss`, `h:mm:ss` or seconds, with optional decimals and optional quotes. They are read as written, so YAML's base-60 reading of `12:34` doesn't apply. `ss` and `mm` must be 00–59.
- The loader lists every problem at once as `<path>:<line>: <problem>`. It catches:
  - invalid YAML, or a file that isn't a list;
  - an entry that isn't a mapping;
  - unknown, duplicate, missing or empty fields;
  - a URL that isn't YouTube;
  - a bad time, or end ≤ start;
  - an unknown role;
  - an episode listed under both roles.
- The loader itself refuses an episode under both roles, so ticket 06's few-shot builder gets the same refusal by using `load_reference_set(REFERENCE_SET).episodes("fewshot")`.

**How a run works** (`make eval` → `evaluate(settings, real_ports(settings))`).
- Eval episodes run in file order. fewshot episodes are never fetched or analyzed.
- `transcribed_job` looks for the newest Job of the same video (any URL form) with the same language, duration range and Brief (`JobOptions()` defaults: `id`, 20–90 s, no Brief) that has a Source and a `transcript.json`.
  - If there is one, the run calls `Pipeline.run(job, start=ANALYZING)`, like `make reanalyze`. Nothing is downloaded or transcribed.
  - Otherwise a new Job runs the whole pipeline.
  - Either way the eval measures the real analyzing stage. Whatever ticket 06 adds there is measured too.
- Candidates and Window scores are read from the Job's `selection.json`.
- **Found rule:** coverage = (reference ∩ Candidate) ÷ reference duration, rounded to 6 places. A reference is found when the single best Candidate covers ≥ 0.5 (exactly half counts).
  - Candidates that each cover part of a reference don't add up.
  - One Candidate can find several references.
  - Recall = found ÷ total across eval episodes, also given per episode.
- No report is written if:
  - the Reference Set is invalid or has no eval references;
  - a Job doesn't end in `review` (download error, LLM error or quota);
  - a reference ends more than 1 s past its episode's end.
  In each case the run prints the reason and exits 1.
- The terminal summary shows, per episode: the Job (reused or new), found of total, and one line per missed reference. Then the overall recall and the paths of the report files.

**Reports.**
- Each run gets a new folder, `eval/reports/<PROMPT_VERSION>/<UTC YYYY-MM-DDTHH-MM-SSZ>/`. It is never overwritten: a same-second clash gets `-2`.
- The folder is committed rather than kept under the git-ignored `DATA_DIR`, for three reasons: the files are small text, each sits in git next to the prompt change that produced it, and the postable judgements are the owner's work.
- `report.md` holds:
  - the overall recall and a table of episodes;
  - per episode: the Job id (reused or new), the duration and the Transcript source;
  - each reference, found or missed, with a link to its start, its line, its note, and the best Candidate's rank, range and coverage;
  - for a miss, the Window holding the reference: its score and whether it was shortlisted. That tells a Score-pass miss from a Detail-pass miss;
  - the top 5: title, time range linked as `…watch?v=<id>&t=<s>s`, length, predicted score, hook, reason, and any reference it found.
- `report.json` is `EvalReport` from `app/evaluation.py`. It has the same data plus every Candidate in full.
- `postable.yaml` has one line per eval episode, `"<url>":   # 0 to N`, for the owner to fill in.

**For ticket 08.**
- Each iteration:
  1. bump `PROMPT_VERSION`;
  2. run `make eval`;
  3. the owner watches each episode's top 5 from `report.md` and writes the counts in that folder's `postable.yaml`;
  4. run `make gate REPORT=eval/reports/<v>/<time>` (plain `make gate` checks the newest report).
- `gate(folder)` returns `Gate(report, postable, status)`:
  - `fail` if recall < 60% or any count < 3;
  - `pending` if some count is still missing;
  - `pass` otherwise.
  Counts must be whole numbers from 0 to min(5, Candidates).
- Commit each run's folder once its `postable.yaml` is filled in. The iteration log can quote `make gate`'s output.
- The Detail pass runs at 0.9, so Gemini varies between runs. A second run of the same version lands in its own folder under that version.

**Tests.**
- `test_reference_set.py` (5 tests):
  - every URL form groups into one episode, with all three time forms;
  - one file with nine kinds of error, each reported with its line;
  - an episode under both roles is refused;
  - invalid YAML and a non-list file are refused;
  - the example file loads.
- `test_evaluation.py` (4 tests):
  - the hand-built found/recall example: 50.5% vs 49.5%, exactly 50%, two Candidates of 37.5% each on one reference, one Candidate finding two references, an edge-touching Candidate, no Candidates, and recall over two episodes;
  - an end-to-end run with `FakeVideoSource`, `FakeTranscriber` and `FakeLlm` on the 62-minute episode:
    - episode A was analyzed before through the API, under its `youtu.be` URL, and is reused without a second fetch;
    - episode B is fetched once;
    - the fewshot episode is never touched;
    - recall is 2/3;
    - the report files and preview links are checked;
    - the gate moves pending → fail → pass;
    - a second run fetches nothing and keeps the first report;
  - the gate fails below 60% recall, and invalid counts are rejected;
  - the harness refuses a set with an episode under both roles before fetching anything.
- Mutation-checked: each of these breaks a test: `>` instead of `≥`, ties going to the worse rank, no Job reuse, reuse only for the identical URL, evaluating fewshot episodes, the gate ignoring recall, allowing both roles, accepting seconds above 59.

**Smoke check (CLI, no key, no network).** I ran `make eval` against a scratch copy of Job `5d96939ba73e`, with `DATA_DIR` pointing at the scratch copy:
- line-numbered validation errors were printed;
- a `youtu.be/…?si=` entry reused the Job;
- the run stopped with "GEMINI_API_KEY is not set", and no report was written.
The temporary `eval/references.yaml` was removed afterwards, and the owner's `data/` is untouched.

Open issues:
- **Needs a real run.** Put `GEMINI_API_KEY` in `.env`, copy the example to `eval/references.yaml` and fill in the real clips, then run `make eval`.
- **Reuse replaces Candidates.** Like `make reanalyze`, reusing a Job replaces its `candidates.json` and `selection.json`. Once ticket 11 exists, review edits on an eval episode's Job would be lost. Each report keeps its own copy of the Candidates.
- **A failed run is redone in full.** A run that fails partway (for example on quota) writes nothing. On the rerun, Transcripts are reused, but the LLM calls for earlier episodes are made again.
- **Fixed language.** It is always `id`, with no flag.
- **Late end check.** A reference past its episode's end is caught only after that episode's selection has run.
- **No episode titles.** Source metadata has no YouTube title, so episodes are shown by URL.
- **For ticket 06:**
  - A fewshot episode needs only a Transcript. `Pipeline.run` has `start=` but no way to stop early, so a new fewshot Job would also run analyzing unless a stop is added.
  - If each Job snapshots the Channel Profile, a reused eval Job must still be analyzed with the current profile.

**2026-10-13: verified by the owner's session.** `make test` passes (62 passed). A real `make eval` waits for the owner's Gemini key and `eval/references.yaml`; that run happens in ticket 08. Committed.
