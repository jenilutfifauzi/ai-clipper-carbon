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

**Status:** ready-for-agent

- [ ] Windows are max(90 s, 1.5× the maximum clip length) long, overlap by 30 s, and have edges snapped to Words.
- [ ] The Score pass sends Windows in batches of 8 at temperature 0.2. It returns schema-validated 0–100 scores, using the "2-second hook test" rule from the adapted prompt.
- [ ] The target count is max(3, round(episode minutes ÷ 9)). The shortlist is about twice the target.
- [ ] The Detail pass receives:
  - the full Transcript in a compact `[mm:ss] text` form;
  - the shortlisted Windows.

  It returns schema-validated Candidates with:
  - start and end;
  - predicted score, hook strength, emotion, retention notes, and reason;
  - hook text (at most 2 lines, about 40 characters);
  - title;
  - TikTok, Instagram, and Shorts descriptions and hashtags, in the transcript's language.
- [ ] Post-processing:
  - snaps each Candidate to Words (±1.5 s search, 0.35 s lead-in, 0.45 s tail);
  - removes overlapping Candidates;
  - enforces the Job's duration range (default 20–90 s).
- [ ] Candidates are ranked by predicted score, and the Job's status becomes `review`.
- [ ] Prompts are adapted from openshorts' Score and Detail templates with attribution. A prompt version identifier is recorded on the Job.
- [ ] Transient LLM errors are retried with exponential backoff.
- [ ] Seam A tests with recorded fake LLM responses cover:
  - off-word times getting snapped;
  - overlap removal;
  - out-of-range durations getting handled;
  - the target count;
  - the ranking.
- [ ] The CLI prints the Candidates: rank, time range, score, title, and hook.
- [ ] Manual smoke check: a real episode yields plausible Candidates.
