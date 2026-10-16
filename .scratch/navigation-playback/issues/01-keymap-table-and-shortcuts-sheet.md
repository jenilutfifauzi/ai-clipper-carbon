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

**Status:** ready-for-agent

- [ ] Seam G (vitest), worked examples:
  - [ ] Cmd+Z gives `undo`, Shift+Cmd+Z and Ctrl+Y give `redo`, and Shift+Z gives `fit`;
  - [ ] Space gives `play`, Escape gives `pick-none`, and Shift+Delete gives `ripple-delete`;
  - [ ] Cmd+L and Cmd+F give nothing;
  - [ ] with a field focused, nothing except Escape;
  - [ ] no two rows share keys in the same context;
  - [ ] every row appears once on the sheet;
  - [ ] Mac naming gives ⇧⌘Z, and other platforms give Ctrl+Shift+Z.
- [ ] Every existing shortcut works as before in the Advanced Edit (undo/redo, Space, select all, Escape, copy/cut/paste, duplicate, delete, ripple delete, split, Shift+Z, arrow moves).
- [ ] ? and the top bar's keyboard icon open the sheet, and Esc closes it.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
