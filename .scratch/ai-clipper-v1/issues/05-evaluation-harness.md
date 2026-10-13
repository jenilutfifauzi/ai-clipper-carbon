# 05: Evaluation Harness

**Parent spec:** `spec.md` in this feature folder (Milestone M2; user stories 61–66; Evaluation Harness module).

**What to build:** As the owner, I list my past clips in a Reference Set file. I then run one command that analyzes each eval episode and produces a report with:
- recall;
- which references were found or missed;
- a top-5 Candidate list per episode, for my manual judgement.

Each report is saved under the prompt version that produced it, so iterations can be compared.

**Blocked by:** 04 (Selection: Transcript → Candidates).

**Status:** ready-for-agent

- [ ] The Reference Set format holds: episode URL, start, end, note, and role (`eval` or `fewshot`). Invalid entries fail with clear errors.
- [ ] The command analyzes every `eval` episode and reuses cached Sources and Transcripts where they exist. `fewshot` episodes are never evaluated.
- [ ] A reference counts as found when some Candidate covers at least 50% of the reference clip's duration. Recall = found ÷ total across eval episodes.
- [ ] The report contains:
  - per-episode recall and the found/missed references;
  - the top-5 Candidates with title, time range, reasoning, and a timestamped link for preview;
  - overall recall;
  - a field for the owner to record the postable count per episode.
- [ ] Reports are saved with the prompt version and a timestamp. Earlier reports remain for comparison.
- [ ] The recall computation is verified by a test against a hand-built example: partial overlaps just above and just below 50%, and several Candidates touching one reference.
