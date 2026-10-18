# 02: The Caption Style in the Advanced Edit's inspector

**Parent spec:** `../spec.md` (Implementation Decisions "Advanced Edit" → Inspector, the picked captions); user stories 16–18.

**What to build:** with the captions picked in the Advanced Edit, the inspector shows the clip editor's Preset bar and its full Caption Style panel. They are shared components, not copies, and they replace the hint "Their look is changed in the clip editor". The panel keeps "Reset position".

- Changes write the Candidate's Style Overrides (caption section) through the Advanced Edit's edits.
- Each change is one step of undo and redo.
- Picking a Style Preset sets `preset_id`.
- Saving the current look as a Preset works as in the clip editor.
- The preview shows each change as the clip editor's does, from a draft Preview Plan.
- On a phone the panel comes in the bottom sheet.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Picking the captions shows the Preset bar and every Caption Style field. Changing the font, size, colours, highlight, position or line limits changes the preview at once.
- [ ] Each change is one undo step, and undo restores the previous look.
- [ ] Choosing a Preset and saving a new Preset work and persist. Another editor sees the change through live sync.
- [ ] Revision merge: a Caption Style change in the Advanced Edit and another editor's change to a different Style Override field both survive.
- [ ] A locked Captions Track keeps the panel read-only.
- [ ] vitest: the Advanced Edit's caption style action writes the Style Override and is undoable.
- [ ] Typecheck, build, and a browser walkthrough at desktop and phone widths.
