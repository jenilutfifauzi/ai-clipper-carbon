# 03: Preview Plan and preparation

**Parent spec:** `spec.md` in this feature folder (user stories 1–3; "Preview Plan and preparation"; ADR 0001).

**What to build:**
- `POST /api/jobs/{job}/candidates/{id}/preview-plan`:
  - **Body:** an optional draft with `preset_id`, `style_overrides`, `hook_text` and the fields of later tickets.
  - **Response:** the Render Plan, the clip's Words, `words_source` and `analysed`.
  - **Fallbacks:** without cached clip Words, the Transcript's Words in the range are used. Without a cached analysis, the clip is one Scene.
- `POST /api/jobs/{job}/candidates/{id}/prepare` queues transcription and analysis on the render worker, without an encode.

**Blocked by:** 01.

**Status:** done

- [x] Planning a saved Candidate gives the same plan a render would make from the same caches.
- [x] Without caches the response says `words_source: "transcript"` and `analysed: false`, and still plans captions and the hook.
- [x] A draft is planned without being saved.
- [x] `prepare` fills the `words/` and `analysis/` caches and leaves the Clip untouched. The Job is `rendering` while it runs and back in `review` after. A later `preview-plan` says `clip` and `analysed: true`.
- [x] Captions off for the Job: the plan has no captions, but the Words are still returned for editing.

## Comments

**2026-10-14: done.** `make test`: 282 passed (4 new Seam A tests in `test_render.py`).

Built:
- **Shared planning** (`app/rendering.py`):
  - `candidate_plan(...)`: the one way a Candidate is planned, used by renders and the preview.
  - `saved_words`, `saved_analysis` and `transcript_words`, factored out of `Renders`.
- **`app/editor.py`:** `preview_plan(...)` returns `PreviewPlan(plan, words, words_source, analysed)`.
  - The Words are those whose middle is in the Clip, on the Clip's timeline.
  - A portrait Source counts as analysed, since it is passed through.
- **`POST /api/jobs/{job}/candidates/{id}/preview-plan`:**
  - The optional body is a `CandidateUpdate`, applied through `review.update` (the same snapping and validation) and not saved.
  - 422 for a bad range or bad style overrides, 404 for an unknown Candidate or Preset.
- **Preparation:**
  - `Job.preparing` is a queue of Candidate ids, kept in `job.json` so that it survives a restart.
  - `Renders.prepare` queues a Candidate unless it is prepared already (`Renders.prepared`). The Job goes `rendering`.
  - `Renders.run` prepares before rendering Clips. `_prepare` transcribes (only when the Job is captioned) and analyses, and a failure becomes a Job warning.
  - `POST .../prepare` (202) returns the Job, through `Worker.prepare`.
- **Frontend `api.ts`:** `RenderPlan`, `PreviewPlan` and `Job.preparing` types, plus `api.previewPlan(jobId, id, draft, signal)` and `api.prepareCandidate`.

**Tests:**
- Before a render: Transcript Words, one Scene, and captions and hook planned.
- After a render: the preview plan equals the saved plan file exactly, with the Clip's own Words.
- A draft is planned and not saved, and errors give 422/404.
- Prepare fills the caches without a Clip, a second prepare queues nothing, and a later render doesn't transcribe again.
- Captions off: no captions, the Words are still returned, and prepare doesn't transcribe.
