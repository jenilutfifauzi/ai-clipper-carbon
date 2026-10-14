# 05: Retype the hook, Kicker and captions in place

**Parent spec:** `spec.md` in this feature folder (user stories 6, 7, 8; "Caption retyping").

**What to build:**
- A double-click (or Enter while selected) pauses and opens a text field over the item, in its font. Enter saves (Shift+Enter: a new line, hook only), Escape cancels, leaving it saves. At least 16 px on a phone.
- **Hook:** `hook_text` (at most 200), Cmd/Ctrl+B wraps the selection in `*…*` (shared with `HookEditor`). The Kicker's pill edits `hook_kicker` (at most 24).
- **Captions:** the line's Words, as Word Edits: one for one; extra typed words join the last Word; Words left over are removed.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Browser: retype each in both editors; undo in the Advanced Edit.

## Comments
