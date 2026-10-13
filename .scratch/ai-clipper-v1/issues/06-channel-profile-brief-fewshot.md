# 06: Channel Profile, Brief & few-shot

**Parent spec:** `spec.md` in this feature folder (Milestone M2; user stories 7, 18–21; Channel Profile module).

**What to build:** I keep one Channel Profile (niche, audience, clip style, things to avoid) and can read and change it through the API. I can add an optional Brief to any Job. The Detail pass uses three inputs:
- the Channel Profile;
- the Brief;
- few-shot examples drawn from my `fewshot` Reference Set clips.

An episode can never be both `eval` and `fewshot`.

**Blocked by:** 04 (Selection: Transcript → Candidates), 05 (Evaluation Harness).

**Status:** ready-for-agent

- [ ] The Channel Profile can be read and replaced through the API and is persisted. Each new Job records a snapshot of the profile it used.
- [ ] Job creation, in both the API and the CLI, accepts an optional Brief. The Brief is included in the Detail pass and shown in the Job details.
- [ ] Few-shot examples are built from `fewshot` references as a Transcript excerpt plus the owner's note. Those episodes are fetched and cached through the same Source and Transcript path.
- [ ] The Evaluation Harness and the few-shot builder both refuse a Reference Set where an episode appears under both roles.
- [ ] Seam A tests use a fake LLM that records requests. They assert the profile, the Brief, and the few-shot examples reach the Detail call (the port contract), and that Jobs without a Brief still work.
