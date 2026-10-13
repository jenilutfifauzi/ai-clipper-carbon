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
