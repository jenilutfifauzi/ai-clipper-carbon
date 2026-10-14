# 03: Preview Plan and preparation

**Parent spec:** `spec.md` in this feature folder (user stories 1–3; "Preview Plan and preparation"; ADR 0001).

**What to build:**
- `POST /api/jobs/{job}/candidates/{id}/preview-plan`:
  - **Body:** an optional draft with `preset_id`, `style_overrides`, `hook_text` and the fields of later tickets.
  - **Response:** the Render Plan, the clip's Words, `words_source` and `analysed`.
  - **Fallbacks:** without cached clip Words, the Transcript's Words in the range are used. Without a cached analysis, the clip is one Scene.
- `POST /api/jobs/{job}/candidates/{id}/prepare` queues transcription and analysis on the render worker, without an encode.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Planning a saved Candidate gives the same plan a render would make from the same caches.
- [ ] Without caches the response says `words_source: "transcript"` and `analysed: false`, and still plans captions and the hook.
- [ ] A draft is planned without being saved.
- [ ] `prepare` fills the `words/` and `analysis/` caches and leaves the Clip untouched. The Job is `rendering` while it runs and back in `review` after. A later `preview-plan` says `clip` and `analysed: true`.
- [ ] Captions off for the Job: the plan has no captions, but the Words are still returned for editing.

## Comments
