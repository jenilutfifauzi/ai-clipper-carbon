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

**2026-10-14: prompt v3, start/end quality and diversity. Not committed (awaiting owner review).** `make test`: 148 passed. `test_selection.py` has 7 new tests and 4 updated where the behaviour changed on purpose. Changed: `app/prompts.py`, `app/selection.py`, `SelectionTuning` in `app/config.py`, and `ClipProposal` in `app/llm.py`. Each new rule was mutation-checked: breaking it fails a test.

What changed in v3:
- **The Detail transcript is one sentence per line.** Lines used to be Whisper segments or caption lines, which often start mid-sentence, and the model opens clips at a line's label. Now a line breaks at sentence punctuation (`. ? ! …`) or at a silence of at least 0.3 s. A line still going after 12 s breaks at the next segment's start; that is all that happens on captions with no punctuation and no gaps. Label snapping uses the same lines.
  - On Job 8ef59ab26333 this gives 237 Whisper segments → 81 lines, and on its YouTube track 219 → 171.
  - I checked the signal: 76% of Whisper's ≥ 0.3 s pauses fall within 1 s of a sentence end in the punctuated YouTube track.
- **Quoted edges.** The schema now requires `topic`, `opening_words` and `closing_words` (6–8 words each, copied from the transcript). Each quote is fuzzy-matched (difflib ratio ≥ 0.7, ignoring case and punctuation) within ±20 s of the Word that the proposed time resolves to. A match places the edge; with no match, the time rules apply as before. Centring on the resolved Word, not the raw label, matters: an end label can sit after a long silence (one did, 30 s away).
- **Whole sentences.**
  - A start in mid-sentence moves forward to the next sentence if that starts within 2.5 s (the opening was the previous sentence's tail).
  - An end in mid-sentence extends to the end of its sentence if that is within 4 s.
  - A quoted edge moves only for punctuation, never for a pause: on unpunctuated captions, pause-based extension added dangling phrases to ends the model had chosen well.
  - A clip that is too long is cut at its last sentence end that keeps it in range.
  - The lead-in and tail are unchanged.
- **Diversity.**
  - The prompt asks for a distinct `topic` per clip and no back-to-back clips.
  - Post-processing drops the weaker of two clips less than 5 s apart (one passage cut in two), or whose topics share at least 50% of their words of 4+ letters.
  - The prompt now asks for up to 2 spare clips, so these drops don't leave the count short.
  - A clip that can't be fitted to the duration range is now dropped before the overlap and diversity steps. Before, it knocked out its neighbours and was then dropped itself.
- `PROMPT_VERSION` is `v3`. Proposals in `selection.json` files saved before v3 still load: the new fields default to "".

Real runs (DeepSeek `deepseek-flash`; v2 rerun from a worktree of HEAD):

| Episode | Version | Candidates | Opening words |
|---|---|---|---|
| 8ef59ab26333, 8 min, Whisper | v2 | 3 | "gagal lebih baik, gagal lebih baik gue bikin…" / "dan kapan itu terakhir gitu Karena…" / "Karena kita punya value… Nah menurut gue…" (#1 and #2 back to back) |
| 8ef59ab26333 | v3 (final run) | 3 of 3 | "kayaknya apa yang dibikin Radhi itu terjual terus…" (the host's question) / "Itu gue gak tau, adalah sebuah berkah atau kutukan…" / "apa namanya carilah pekerjaan dimana orang ngeliatnya lu kayak main-main…" |
| 8ef59ab26333 | v3 (earlier run) | 3 of 3 | "Karena gue selalu ngerasa gagal, itu persoalan gue." / the same "berkah atau kutukan" / "karena pegangan gua kan omongannya nafal tuh…" |
| 1d5d363bec2e, 41 min, YouTube captions, no punctuation (Raymond Chin ft. Hermanto Tanoko, hrfJprWnvEo) | v2 | 3 of 5 (2 too long) | "menarik tapi kan sekarang paham atau dulu…" / "itu memang tidak bisa dilihat hanya produknya saja…" / "untuk kita semua terus stay humble…" |
| 1d5d363bec2e | v3 | 5 of 5 | "ini kan sudah airnya bagus murni, ini mau nggak saya kasih…" (the poison analogy) / "ya jadi pengusaha itu nggak gampang…" / "lanjut nggak lanjut itu bukan karena saya lihat laporan keuangannya…" / "kaya dulu nih saya mau yang sehat…" (a fragment) / "jadi orang harus rileks…" |
| 1d5d363bec2e | v3, `LLM_THINKING=enabled` | 5 of 5 | "kalau nggak punya privilege nggak bakal bisa bangun bisnis besar…" / "Bill Gates sama (Steve Jobs) mereka bilang…" / "saya nggak pernah mengenal sakit, sakit pun itu kerja…" / "integritas itu yang pertama…" / "saya ini kan mulai usia saya 5 tahun sudah dididik untuk berinvestasi…" |

- **Themes.**
  - v3 no longer returns a passage cut in two. The diversity rule fired once per run on 8ef59ab26333: in each case the model had split one continuous answer.
  - 8ef59ab26333 still yields two clips on the wider "never satisfied" theme, about 40 s apart and different stories.
  - On 1d5d363bec2e the v3 topics are all distinct: leadership/integrity, ownership, partners, happiness before wealth, big dreams.
- **Remaining weak spots.**
  - Ends: some still stop mid-story (e.g. "…halamannya terlalu tipis"). The model chooses those.
  - Too-long clips: with thinking disabled, DeepSeek proposes 1–2 clips per run over the 90 s maximum (100–135 s), and the existing 15 s `duration_fix_secs` rule drops them. The spares now make up for it. With thinking enabled, all 7 proposals were in range.
  - Unpunctuated captions: openings are better but not always sentence starts, since only the model can see sentence boundaries there.
- **Cost and latency.**
  - 9 real runs used about CNY 0.36 in all (balance 1.98 → 1.62; the balance updates with a lag).
  - Latency, thinking disabled: 8.7–13.7 s on the 8-minute episode (v2: 8.3 s), and 17–19 s on the 41-minute one (v2: 14.5 s).
  - Thinking enabled: 341 s, and about CNY 0.1 for that one run.
- **A bug outside Selection.** `parse_json3` (`app/transcript.py`) crashes with `KeyError: 'dDurationMs'` on this episode's track. The track has 49 text-less "append" events (`aAppend`, segs `"\n"`) with no duration. Fix: read `dDurationMs` only after the text check, or use `.get(…, 0)`. I didn't touch it (it's outside Selection). Job 1d5d363bec2e's Transcript was built by a scratch script that skips those events, which is what a fixed parser would produce.

Recommendations for the formal eval:
- Run `make eval` on v3 with thinking both disabled and enabled. Thinking gave the best openings and no out-of-range clips, but it is about 18× slower; latency is the trade-off.
- When judging postability, look at the first 3 s and last 3 s of each Candidate specifically, and count "opens mid-thought" and "ends mid-thought" separately from the topic choice.
- Include at least one unpunctuated-caption episode and one Whisper episode, as they hit different rules.
- Knobs to try if needed:
  - `fragment_secs` / `complete_secs`;
  - `adjacent_secs`, which may be too strict for dense episodes;
  - `duration_fix_secs`, or a "cut a too-long clip at a sentence end" rule, if too-long drops persist;
  - `line_max_secs` for unpunctuated captions.
