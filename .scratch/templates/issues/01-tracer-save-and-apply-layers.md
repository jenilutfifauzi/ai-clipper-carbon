# 01: Tracer: save a Template of layers and apply it through MCP

**Parent spec:** `../spec.md` (Implementation Decisions "Model", "Capture (pure)", "Apply (pure)" steps 1 and 4, "Server", "MCP"). See also GLOSSARY (Template, Anchor, Template item) and docs/adr/0023-templates-are-marked-copies-anchored-by-their-edges.md.

**What to build:** the agent can save a Candidate's layers as a Template and put them on other Candidates of any length, where they keep their place by their Anchors.

- **The Template store** is global and lives in the data directory. It is written atomically under a lock, like the Text Preset and Export Preset stores. It has no built-in Templates.
  - In this ticket a Template holds an id, a name, its created and updated times, and its layers. The layers are Text Layers, Shapes, Music Clips of Media Library items, Overlays and Adjustment Layers, each as on a Candidate plus its Anchor.
- **An Anchor is stored per edge:** the boundary the edge hangs from, and its distance from it. The boundaries in this ticket are the Main Slot's start and end, which with no intro or outro are the Clip's start and end. Intro and outro come in 03.
  - The guess on save hangs each edge from its nearest boundary.
  - An override is one of Start, End or Span, as the spec defines them.
- **Candidate layers gain an optional Template mark** (the Template's id). It is kept through edits, is ignored by the planner, and comes back in the Candidate's JSON. A paste from the Clipboard drops it.
- **Pure `capture`** takes a Candidate's edits and anchor overrides, and returns the Template's layers and notices. Music Clips of the Source's sound are left out, with a notice.
- **Pure `apply`** takes a Template and a Candidate, and returns the Candidate's new edits and notices. It places each layer by its Anchor and marks it. A plain trim at the Clip's end is enough here; 05 covers the full fit rules.
- **REST:**
  - `/templates`: list; create from `{job_id, candidate_id, edits (the draft), anchors?}`; replace; rename; delete.
  - A capture preview, which returns the guessed Anchors and notices without saving.
  - `POST /jobs/{id}/templates/apply` with `{template_id, candidate_ids, dry_run}`.
    - It runs inside one `change_candidates` lock: one new Revision and one Revision History state per changed Candidate.
    - It refuses (409) unless the Job is in review or rendering, and refuses an unknown Candidate (404) for the whole batch.
    - It returns per-Candidate edits and notices.
- **MCP:**
  - `list_presets`, `save_preset` and `delete_preset` take `kind: "template"`. `save_preset` takes `{name, job_id, candidate_id, anchors?}` and a `preset_id` to save over.
  - A new tool, `apply_template(job_id, candidate_ids, template_id, dry_run)`.
  - The server instructions gain a short Templates paragraph.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Pure tests:
  - Anchors are guessed per edge.
  - A Start, End or Span override is stored as its edges.
  - Source-sound Music Clips are left out.
  - A Start lower-third and an End call to action land at the same distances on a 20 s and a 75 s Candidate.
  - A Span layer stretches to cover the Main Slot.
  - Applied layers carry the Template's mark.
- [ ] HTTP:
  - Save, list, rename, save over (the id is kept) and delete.
  - Apply to three Candidates changes each by one Revision in one request.
  - `dry_run` saves nothing.
  - A Job not in review gives 409.
  - An unknown Candidate fails the batch.
- [ ] MCP: `save_preset`, `list_presets` (layers with their Anchors), `delete_preset` and `apply_template`, each with kind "template".
- [ ] The Candidate's JSON shows the mark. Existing Candidates without marks load unchanged.
