# 01: One keymap table, and the shortcuts sheet drawn from it

**Parent spec:** `spec.md` in this feature folder (user stories 71–76, 81–83; Implementation Decisions "The keymap table").

**What to build:** every Advanced Edit shortcut is defined in one table, and a sheet lists them. The owner opens the sheet with ? or a keyboard icon in the top bar, and every key does what it says. The shortcuts behave exactly as today. This ticket only moves them into the table, and the later tickets add their rows.

- **The table.** Each row has:
  - an id;
  - its keys (a key name plus modifiers, with Cmd/Ctrl as "command");
  - its group (playback, navigation, editing, view);
  - a label;
  - whether it is desktop only.
- **A pure resolver** takes the key, the modifiers and a context, and returns a row's id or nothing. The context says:
  - whether a field or stage text has the focus;
  - whether an item reached by Tab has it;
  - whether the stage is full screen.
- **`useShortcuts` dispatches by id** instead of comparing keys inline.
- **Bare letters** match case-insensitively, and are ignored with Cmd/Ctrl, so Cmd+L and Cmd+F stay the browser's.
- **Precedence is as today.** A field or stage text takes everything except Escape. A Tab-focused item keeps its own arrows, Enter/Space and Delete.
- **The sheet.**
  - It is a dialog grouped by the rows' groups, closed with Esc.
  - It names keys as a Mac writes them (⌘ ⌥ ⇧) on a Mac, and Ctrl/Alt/Shift elsewhere, through a pure function.
  - It is not shown on a phone.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Seam G (vitest), worked examples:
  - [x] Cmd+Z gives `undo`, Shift+Cmd+Z and Ctrl+Y give `redo`, and Shift+Z gives `fit`;
  - [x] Space gives `play`, Escape gives `pick-none`, and Shift+Delete gives `ripple-delete`;
  - [x] Cmd+L and Cmd+F give nothing;
  - [x] with a field focused, nothing except Escape;
  - [x] no two rows share keys in the same context;
  - [x] every row appears once on the sheet;
  - [x] Mac naming gives ⇧⌘Z, and other platforms give Ctrl+Shift+Z.
- [ ] Every existing shortcut works as before in the Advanced Edit (undo/redo, Space, select all, Escape, copy/cut/paste, duplicate, delete, ripple delete, split, Shift+Z, arrow moves).
- [ ] ? and the top bar's keyboard icon open the sheet, and Esc closes it.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. The table is `SHORTCUTS` in `frontend/src/pages/job/advanced/keymap.ts` (tested in `keymap.test.ts`): each row has its id, its keys, its group, its label, and optionally `desktop` (left out on a phone), `typing` (also while a field has the focus) and `fullscreen` (only full screen, or only not; no row uses it yet). `resolveShortcut(keys, context)` gives the row's id: letters match in either case, any other character (? and Space) with Shift or without, and a focused item keeps arrows, Enter, Space, Delete and Backspace whatever the modifiers. `keyNames(row, mac)` names the keys, and `shortcutSheet()` groups the rows for the sheet. `useShortcuts` (in `AdvancedEdit.tsx`) builds the key and the context from the event and runs the id from a `Record<ShortcutId, …>`, so a row without a dispatch case doesn't compile; a case that can't run now (nothing picked, say) leaves the key to the browser. The sheet is `ShortcutsSheet` in `Chrome.tsx`, on the native `<dialog>` as the confirm dialog is, opened by ? and a keyboard button in the top bar on a desktop only; keys pressed in it don't reach the shortcuts behind it.

Three small differences from before, by the table's exact matching. Escape in an inspector field now picks nothing, as the spec says (it used to do nothing there; text on the stage still keeps its own Escape). Space, Escape and Delete with Cmd, Ctrl or Alt held now do nothing (Shift+Space still plays). A focused element that is neither a button nor a field (a link, say) no longer keeps the arrows and Space from the table, as only buttons and `role=button` items do.

Not tried in the browser: every shortcut working as before, and ? and the keyboard button opening the sheet and Esc closing it, are left for the walkthrough (11).

**2026-10-16: Review fixes.** Only `role=button` items (the Timeline's and the stage's) keep their arrows, Space and Delete now: a focused real `<button>` (the player bar, the toolbar, the keyboard button after the sheet closes) leaves Space, the arrows and Delete to the table, and Space no longer also clicks it (the key is prevented); Enter still activates it. The preview's scrubber and rate menu carry `data-shortcuts` and don't count as fields, so the table's keys work while they have the focus (← and → step frames rather than the scrubber's own 0.1 s); the rate menu also lets go of the focus once a rate is picked.
