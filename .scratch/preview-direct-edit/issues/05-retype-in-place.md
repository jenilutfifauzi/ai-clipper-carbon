# 05: Retype the hook, Kicker and captions in place

**Parent spec:** `spec.md` in this feature folder (user stories 6, 7, 8; "Caption retyping").

**What to build:**
- A double-click (or Enter while selected) pauses and opens a text field over the item, in its font. Enter saves (Shift+Enter: a new line, hook only), Escape cancels, leaving it saves. At least 16 px on a phone.
- **Hook:** `hook_text` (at most 200), Cmd/Ctrl+B wraps the selection in `*…*` (shared with `HookEditor`). The Kicker's pill edits `hook_kicker` (at most 24).
- **Captions:** the line's Words, as Word Edits: one for one; extra typed words join the last Word; Words left over are removed.

**Blocked by:** 03.

**Status:** done

- [x] Browser: retype each in both editors; undo in the Advanced Edit.

## Comments

**2026-10-15: done.** `npm run typecheck` and `npm run build` pass.

Built:
- `editor/InlineText.tsx`: `InlineText` opens a text field over the hook, its Kicker (a double-click on its pill), the caption line on screen, or a Text Layer, in its font and case, at least 16px. Enter or leaving it saves, Escape doesn't; Shift+Enter is a new line in a Text Layer; Cmd/Ctrl+B marks Emphasis in the hook. Playback pauses, the item isn't drawn while it is retyped, and focus goes back to its handle.
- `StageControls.retype`: `textOf` (the hook's and the Kicker's text with their Emphasis marks), `onText`, and `onWords` (a change of the Word Edits, applied by each editor to its own list).
- `editor/emphasis.ts`: `toggledEmphasis`, shared with `HookEditor`. `editor/wordEdits.ts`: `withWordEdit` (shared with `CaptionTextEditor`), `lineWords` and `retypedLine`.
- **Clip editor:** a retyped hook or Kicker remounts `HookEditor`, so that its fields show it.

**Change from the plan:** a caption line's Words are found by their text (as edited), nearest the line's time, not by time alone. In a Clip cut into Segments, the Preview Plan's Words were 0.5 s from the line's, and matching by time edited the Word before. A Word whose edit is several words takes as many typed words.

**Checks:** Browser (scratch clone):
- Advanced Edit: the hook was retyped to `Istri harus *izin* suami dulu?`, undone and redone. The line "seorang istri keluar" was retyped to "seorang ibu keluar rumah", saved as `istri→ibu`, `keluar→keluar rumah`.
- Clip editor: Enter on the hook, then retyped with Cmd+B, saved as `Bolehkah *istri* keluar tanpa izin?`. The Hook tab's field shows it.
- A real double-click works. The automation's two clicks were 1.2 s apart, past the 350 ms double-tap, so it opened with Enter there.

**2026-10-15: after review.**
- A retyped Word keeps the punctuation around it, so a sentence's end still ends its caption line. Typed in the capitals that uppercase captions show, it is saved in lower case (with a capital it was written with kept).
- When no run of Words reads as the line, they are found by time.
- A double-tap on the Kicker is tested against where the plan draws it, after a move that isn't planned yet.

**Changes from the plan:**
- Shift+Enter makes a new line only in a Text Layer. The planner joins the hook's text into balanced lines, so a new line there would do nothing.
- Enter on the hook opens the hook. The Kicker opens with a double-click on its pill.

Checked: "rumah dalam Islam" retyped as "rumah dalam AGAMA" saved `Islam,` → `AGAMA,`.
