# 06: The AI writes Emphasis and a Kicker, and no emoji

**Parent spec:** `spec.md` in this feature folder (user stories 8, 10; "AI").

**What to build:**
- **`ClipProposal`:** `viral_hook_text` may hold `*Emphasis*`, and gains `hook_kicker: str` (it may be empty).
- **HOOK PLAYBOOK** in `app/prompts.py`:
  - mark 1–3 key words (the claim, number or name) with `*`;
  - a Kicker of 1–2 words, at most 24 characters, in TRANSCRIPT_LANGUAGE, or empty when none fits (examples: "TERBONGKAR!", "FAKTA", "POV");
  - no emoji in either;
  - keep the ~40-character guidance, dropping "on at most 2 short lines".
- **`selection.py`:** normalises both (whitespace, Kicker cut to 24 characters, emoji stripped) into `hook_text` and `hook_kicker`.
- **Evaluation:** prints the hook with its markup and the Kicker.

**Blocked by:** 02, 03.

**Status:** ready-for-agent

- [ ] Selection test with a fake LLM: markup kept, Kicker normalised, emoji stripped, and a missing `hook_kicker` read as `""`.
- [ ] Existing Candidates load with an empty Kicker.
- [ ] One real run on a cached episode: Candidates have Emphasis and sensible Kickers; note the results in Comments.
