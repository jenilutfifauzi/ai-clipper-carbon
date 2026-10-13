# 08: Selection gate

**Parent spec:** `spec.md` in this feature folder (Milestone M2 exit criteria; user stories 63–67).

**What to build:** Iterate on the selection prompts and temperatures, using the Evaluation Harness, until the gate passes. The cap is about 5 iterations. The gate is:
- recall ≥ 60%;
- the owner judges at least 3 of the top 5 Candidates postable on each eval episode.

The outcome is recorded either way. An agent may run the iterations and prepare each report, but the postability judgement and the pass/fail call belong to the owner.

**Blocked by:** 05 (Evaluation Harness), 06 (Channel Profile, Brief & few-shot).

**Status:** ready-for-human

- [ ] Each iteration bumps the prompt version, saves an eval report, and records the owner's postable counts.
- [ ] Changes between iterations are summarised in a short log: what changed, recall, and postable counts.
- [ ] If the gate passes: record the final prompt version and results in the project notes, and set ticket 09 to `wontfix`.
- [ ] If the gate has not passed after about 5 iterations: record the best version and results, and leave ticket 09 open to run.

## Comments

**2026-10-13 (from ticket 04).** Start with the real-Gemini smoke check that ticket 04 deferred: put the key in `.env`, then run `make reanalyze JOB=8ef59ab26333` (the 8-minute episode from ticket 03). Google recommends temperature 1.0 for Gemini 3 models; compare it against the Score pass's 0.2 during iteration. `selection.json` in each Job keeps the Window scores, the shortlist and the raw Detail answers for inspection.

**2026-10-13: first real selection run (DeepSeek `deepseek-flash`, thinking disabled, prompt v2)** on Job 8ef59ab26333, an 8-minute local-whisper transcript. It produced 3 Candidates in 8.3 s with plausible topics and hooks. Observations for iteration:
- **Starts carry fragments of the previous sentence**: "gagal lebih baik, gagal lebih baik gue bikin…", "dan kapan itu terakhir gitu Karena gue selalu…", "Karena kita punya value… Nah menurut gue…". The model tends to start at a transcript line's label, and that line begins mid-thought. Push sub-line start times, or snap the start to the sentence start.
- **Candidates #1 and #2 are adjacent (6:02) and close in theme** (never feeling successful / always feeling like a failure), which is borderline for the diversity rule.
