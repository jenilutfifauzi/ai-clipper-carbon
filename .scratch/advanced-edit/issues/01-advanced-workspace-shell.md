# 01: Advanced Edit workspace shell (desktop + mobile)

**Parent spec:** `spec.md` in this feature folder (user stories 1, 2, 3, 15).

**What to build:**
- **Entry point:** an "Edit Advanced" button in the clip editor that opens `/jobs/:job/candidates/:id/advanced`.
- **Shared draft logic:** the workspace edits the same draft through `useDraftSave` and `usePreviewPlan`. Pull out of `CandidateEditor.tsx` whatever both editors need.
- **Desktop layout:**
  - Asset panel (tabs Media, Audio, Text, Transitions, empty for now).
  - Player, which reuses `ClipPreview`.
  - Inspector.
  - Multi-track Timeline:
    - Clip and Scenes, plus Captions and Hook, all from the Preview Plan.
    - Playhead, zoom, snapping.
    - The hook can be moved and resized, as in the clip editor.
- **Mobile layout:** player, Timeline, a bottom toolbar, and the inspector in a bottom sheet. Pinch zooms, a tap selects, a long press then drag moves.
- **Undo/redo:** a history of draft states, with Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z and toolbar buttons. Moving the hook is the first undoable edit.
- **Glossary:** add **Advanced Edit** and the multi-track Timeline to `GLOSSARY.md`.

**Blocked by:** none.

**Status:** done

- [x] The button opens the workspace; back returns to the clip editor with the same Candidate.
- [x] Hook moved in the workspace is saved and shows in the clip editor.
- [x] Undo/redo restores and re-saves the draft.
- [x] Desktop (≥1024 px) and phone (390 px) layouts, no horizontal page scroll.
- [x] Typecheck and build; browser walkthrough at both widths.

## Comments

**2026-10-14: done.** `npm run build` (typecheck + build). Browser walkthrough on a copy of a real Job, at 1440x900 and at 390x844 with touch emulation.

**What was checked:**
- Dragging the hook saved `hook_start` 3.01. Cmd+Z restored 0.0, and Shift+Cmd+Z brought back 3.01.
- On touch, a swipe scrolled the timeline and left the hook where it was. A long press followed by a drag moved it.
- Pinching zoomed the timeline about the fingers.

**Changes from the plan:**
- The workspace is a top-level route outside the app's shell, so it can fill the screen.
- On a phone, selecting an item doesn't open the inspector by itself, because the sheet would cover the timeline mid-drag. Instead, the toolbar turns into the item's tools (Done, Edit).
- The asset tabs say "can't be added yet" until their tickets land.
