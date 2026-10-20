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

**Status:** done

- [x] Picking the captions shows the Preset bar and every Caption Style field. Changing the font, size, colours, highlight, position or line limits changes the preview at once.
- [x] Each change is one undo step, and undo restores the previous look.
- [x] Choosing a Preset and saving a new Preset work and persist. Another editor sees the change through live sync.
- [x] Revision merge: a Caption Style change in the Advanced Edit and another editor's change to a different Style Override field both survive.
- [x] A locked Captions Track keeps the panel read-only.
- [x] vitest: the Advanced Edit's caption style action writes the Style Override and is undoable.
- [x] Typecheck, build, and a browser walkthrough at desktop and phone widths.

## Comments

**2026-10-18, agent: done.**

**What changed:**
- `editor/useStyleDraft.ts`: the controls are now `styleControls(presets, draft, change, setPresets)`, shared by the clip editor (`useStyleDraft`, saving drafts as they pause) and the Advanced Edit (each change a step of undo). A field's changes carry a group (`style:caption.size`), so a slider's drag is one step; a Preset picked, saved or reset to is a step of its own. `usePresets()` loads the Presets.
- `advanced/edits.ts`: `preset_id` is one of the Advanced Edit's edits, so it is saved, undone and merged (as a field, ADR 0003) with the rest.
- `advanced/actions.ts`: `restyleCaptions` writes the Style Preset and Style Overrides as one change; null while the Captions Track is locked.
- `advanced/Inspector.tsx`: the picked captions show "Reset position", the shared `PresetBar` and the shared `CaptionStylePanel` (the hint "Their look is changed in the clip editor" is gone). `CaptionStylePanel` and `ShadowFields` take `inspector`: one field to a row in the 20rem inspector, as the Advanced Edit's other shadow fields are; the clip editor's layout is unchanged.
- `advanced/useEditHistory.ts`: the history's steps are pure functions (`stepped`, `undone`, `redone`), which the test drives.

**Locked Captions Track:** a locked Track's items can't be picked (`unlockedPick`), so locking it unpicks the captions and the panel goes away; `restyleCaptions` refuses as well (tested).

**Checks:**
- vitest `advanced/captionStyle.test.ts` (8): a field writes the caption Style Override and undo/redo take it back; a slider's drag is one step; a value equal to the Preset's drops the override; picking a Preset sets `preset_id`, clears the overrides and is undone in one step; a saved Preset moves the Candidate onto it; the other edits are kept; a merge with another editor's change to another Style Override field keeps both; a locked Captions Track refuses.
- Full vitest: 52 files, 801 tests passed; typecheck and `npm run build` pass (feat/captions-advanced and main had nothing new to merge).
- Browser walkthrough (built frontend on a copied data dir, desktop 1440×900 and phone 390×844): picking the captions shows the Preset bar and every field; Size changed with the slider moved the preview's caption at once and saved; one Undo put it back to 110, Redo to 140; "Yellow pop" set `preset_id` and was undone in one step; "Save as new" made the Preset (size 140) and moved the Candidate onto it; a colour typed here and a hook size PATCHed by another editor at the same Revision both survived the merge; the clip editor open in another tab showed the new colour through live sync; locking the Captions Track left "Nothing selected" and a click on a Cue picked nothing; on the phone, Edit opened the panel in the bottom sheet and Box highlight was saved and drawn.
