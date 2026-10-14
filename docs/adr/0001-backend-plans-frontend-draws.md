# 0001: The backend plans, the frontend draws

Status: accepted
Date: 2026-10-14

## Context

The clip editor (`.scratch/clip-editor/spec.md`) shows a live 9:16 preview of a Candidate, with its captions and hook, while the owner edits it. The final Clip is burned by libass from a Render Plan made by `app/planner.py`.

That planner holds the rules of where things go:
- caption line breaking: characters, seconds, pauses, sentence ends, Layout changes;
- shrinking an over-wide line;
- fitting the hook on one or two balanced lines;
- choosing a Layout per Scene.

A browser preview can get these from one of two places:
1. **The frontend reimplements them** in TypeScript. Every edit previews instantly, but there are two copies of subtle rules, and they will drift. The preview would then promise line breaks the Clip doesn't have.
2. **The backend computes the Render Plan** for a draft of the Candidate's edits, and the frontend only draws it. Each edit costs a request (planning is milliseconds; no transcription or analysis runs), but the preview and the Clip share one source of truth.

## Decision

Option 2. `POST /api/jobs/{job}/candidates/{id}/preview-plan` returns the Render Plan, and the frontend draws exactly its events. The frontend draws them at their planned boxes, times, sizes and Layouts, and never breaks lines or chooses Layouts itself. Drafts are planned 250 ms after the last change, like the existing hook-fit check.

## Consequences

- The preview and the Clip agree on line breaks, timing, positions, sizes and Layouts. They may differ only in glyph rasterization (browser against libass) and in blur and scaling filters.
- The frontend needs the same fonts. It loads them from the backend, which bundles them for libass.
- Planning must stay cheap and pure. Anything slow (Whisper, scene and face analysis) is used only when cached, with a stated fallback, or run on request (`prepare`).
