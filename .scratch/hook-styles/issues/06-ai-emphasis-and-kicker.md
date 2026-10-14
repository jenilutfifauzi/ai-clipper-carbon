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

**Status:** ready-for-human

- [x] Selection test with a fake LLM: markup kept, Kicker normalised, emoji stripped, and a missing `hook_kicker` read as `""`.
- [x] Existing Candidates load with an empty Kicker.
- [ ] One real run on a cached episode: Candidates have Emphasis and sensible Kickers; note the results in Comments.

## Comments

**2026-10-14: built; the real run is left.** `uv run pytest tests/test_selection.py tests/test_evaluation.py tests/test_audio_signal.py tests/test_steering.py tests/test_gemini.py tests/test_openai.py`: 87 passed (2 new selection tests).

**Left for the owner:** one real run on a cached episode, which calls the LLM. It wasn't run here (the owner chose no paid AI run during implementation). The status is `ready-for-human` until it is done and noted below.

Built:
- **`ClipProposal`:** gains `hook_kicker` (required in the schema sent; `""` when loading proposals saved before v4).
- **Prompt (PROMPT_VERSION v3 → v4):** the HOOK PLAYBOOK asks for Emphasis on the 1–3 words that carry the hook, forbids emoji in the hook and the Kicker, and describes `hook_kicker` (1–2 words, at most 24 characters, or ""). The "at most 2 short lines" wording became "a few short lines".
- **`selection._candidate`:** `hook_text` is the hook without emoji (markup kept, whitespace collapsed). `hook_kicker` is cut to the whole words that fit in `KICKER_MAX_CHARS`, which moved to `app/candidates.py` and is shared with the API.
- **Evaluation:** a report's hook line adds "(kicker: …)" when there is one.

**2026-10-14: review fix.** `selection._cut` cuts the AI's hook to `HOOK_MAX_CHARS` (moved to `app/candidates.py` with `KICKER_MAX_CHARS`) as well as its Kicker, both to whole words. A run of Emphasis cut in two loses its opening asterisk. The eval report writes "Kicker" with a capital, as the glossary does.
