# 09: The Agent's choices as a pop up above the composer, Claude Code style

**Parent spec:** `spec.md` (Solution 5, revised).

**Status:** done

**Blocked by:** 05, 08

**Why:** a `choices` Agent UI sits in the transcript, where it scrolls away and needs the mouse. The owner wants it to behave like Claude Code's question pop up: the options right where you type, numbered, and answerable from the keyboard.

## Decisions (with the owner)
- **A panel docked above the composer.** It does not cover the chat. The card stays in the transcript as the record.
- It opens for the **latest finished turn's** `choices`, as long as no turn has followed. It disappears once a choice is sent (a new turn starts) and when it is dismissed with Esc or ✕. A dismissed choice stays answerable from its card.
- **Contents:**
  - the title;
  - the options numbered `1.`–`N.`, each with its detail;
  - a last row, "Something else…", whose text field sends what is typed;
  - a hint line: `↑↓ choose · Enter send · Esc close`.
- **Keyboard:**
  - the digits `1`–`N` send that option;
  - `N+1` goes to "Something else…";
  - ↑ and ↓ move the highlight, wrapping around;
  - Enter sends the highlighted option, or focuses the field when "Something else…" is highlighted;
  - Esc closes the panel.
- **Focus** (emil-touch-and-accessibility): the panel takes focus when it opens, except on touch devices. When it closes, focus goes back to the message box.
- **Motion** (emil-animations): it enters from below, `translateY(6px)` and opacity 0 to rest, over 200ms with `cubic-bezier(0.32, 0.72, 0, 1)`. It is `motion-safe` only and has no exit animation.

## What to build (`frontend/src/pages/job/advanced/agent/`)
- **`choicePopup.ts`, pure:**
  - `openChoices(turns)` returns `{ call, ui }` or null.
  - `choiceKey({ active, count }, key)` returns one of `{ active }`, `{ send: index }`, `{ other: true }`, `{ close: true }` or `null`. `count` is the number of options; "Something else…" is the row at index `count`.
- **`ChoicePopup.tsx`:** the panel. It is `role="dialog"`, `aria-labelledby` its title, holding `role="listbox"` and `role="option"` rows with `aria-selected`.
- **`AgentTab.tsx`:** renders it between the transcript and the composer while `openChoices(turns)` is not null, the call isn't dismissed, and no turn is on its way. It sends through the same `send` as the composer.

## Seams under test
1. `openChoices`:
   - it returns the last finished turn's choices;
   - null while that turn still runs, when it has no choices, or when another turn has followed;
   - with two choices in one turn, the last one wins.
2. `choiceKey`:
   - digits send, and the digit after the last option goes to "Something else…";
   - a digit beyond that does nothing;
   - the arrows wrap around;
   - Enter sends, or goes to the field;
   - Esc closes.
3. The panel's markup:
   - a dialog labelled by its title;
   - the numbered options, with the first selected;
   - the "Something else…" field;
   - the keyboard hint.

## Acceptance
- [x] The tests at the three seams pass (`choices.test.tsx`; the pure module is `choices.ts`, since `choicePopup.ts` and `ChoicePopup.tsx` are one file on macOS). Only `npx vitest run src/pages/job/advanced/agent` and `npx tsc --noEmit` are run.
- [x] Checked in the browser, Esc and "Something else…" through the tests only:
  - when the Agent offers choices, the panel opens above the composer;
  - pressing `2` sends the second option, and the panel closes when the next turn starts;
  - Esc closes it;
  - "Something else…" sends typed text.
