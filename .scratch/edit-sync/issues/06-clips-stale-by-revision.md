# 06: Clips go stale by Revision

**Parent spec:** `spec.md` in this feature folder (user story 28).

**What to build:** the Clips list marks a Clip stale after any change to its Candidate, including Advanced Edit changes (Text Layers, Music, Overlays, Segments, Transitions, Word Edits, styles). Today only the range, the hook text, the Layout or the Preset make it stale.

- **Render:** a finished render records the Candidate's Revision on its Clip.
- **Clips list:**
  - A Clip is stale when its Candidate's Revision differs from the one it was rendered from.
  - A Clip rendered before this change has no Revision and keeps the old field-by-field comparison.
- **MCP:** `list_clips` shows the Revision a Clip was rendered from.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Seam A: a render records the Candidate's Revision on its Clip; an edit after it leaves the Clip's Revision behind the Candidate's.
- [ ] The Clips list marks a Clip stale after an Advanced Edit-only change, and not after only choosing it for rendering.
- [ ] Typecheck and build; browser walkthrough.
