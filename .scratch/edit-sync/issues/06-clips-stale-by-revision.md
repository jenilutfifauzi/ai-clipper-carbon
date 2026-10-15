# 06: Clips go stale by Revision

**Parent spec:** `spec.md` in this feature folder (user story 28).

**What to build:** the Clips list marks a Clip stale after any change to its Candidate, including Advanced Edit changes (Text Layers, Music, Overlays, Segments, Transitions, Word Edits, styles). Today only the range, the hook text, the Layout or the Preset make it stale.

- **Render:** a finished render records the Candidate's Revision on its Clip.
- **Clips list:**
  - A Clip is stale when its Candidate's Revision differs from the one it was rendered from.
  - A Clip rendered before this change has no Revision and keeps the old field-by-field comparison.
- **MCP:** `list_clips` shows the Revision a Clip was rendered from.

**Blocked by:** 01.

**Status:** done

- [x] Seam A: a render records the Candidate's Revision on its Clip; an edit after it leaves the Clip's Revision behind the Candidate's.
- [x] The Clips list marks a Clip stale after an Advanced Edit-only change, and not after only choosing it for rendering.
- [x] Typecheck and build; browser walkthrough.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_render.py`: a Clip records the Candidate's Revision it was rendered from, and an edit of only the Text Layers leaves it behind.
- `tests/test_mcp.py`: `list_clips` shows the Revision.
- `npm run build`.
- **Browser** (scratch copy, rendered with real ffmpeg):
  - Right after the render: not stale.
  - After "Render this clip" (`selected`): still not stale.
  - After a Text Layer added from the Advanced Edit (another tab): "Changed since this render", live.

**Changes from the plan:**
- **The Revision replaces only the field-by-field comparison of edits.** A Clip is also stale when its Candidate's Style Preset now resolves to other styles (the Preset was edited after the render), which changes no Revision. That check (`restyled`) stays.
