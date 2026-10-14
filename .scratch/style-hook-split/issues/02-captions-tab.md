# 02: Captions tab

**Parent spec:** `spec.md` in this feature folder (user stories 1, 4, 5; "Captions, always shown", "More options").

**What to build:**
- **Tab:** "Style" becomes "Captions".
- **`editor/CaptionStylePanel.tsx`:** the everyday caption controls, then More options (outline, shadow, Line breaks).
- **`components/MoreOptions.tsx`:** a `<details>` disclosure that counts the overridden fields inside it.

**Blocked by:** 01.

**Status:** done

- [x] More options shows "N changed" for overrides inside it, and opens and closes from the keyboard.
- [x] Every control is labelled and keyboard reachable, in dark and light themes.

## Comments

**2026-10-14: done.** `npm run typecheck` and `npm run build` pass.

Built:
- **Tab:** "Style" is now "Captions".
- **`CaptionStylePanel`:** font, size, colours, "Highlight the spoken word" and Position. Those two now have override markers too. UPPERCASE, then More options: Outline and shadow, Line breaks.
- **`components/MoreOptions`:**
  - a native `<details>` whose summary is "More options", what is inside, and "N changed";
  - the chevron turns in 150 ms, motion-safe only;
  - open or closed is kept per tab in `CandidateEditor`.

**Browser check:**
- After Outline +1 and closing it, the summary read "1 changed".
- Enter and Space on the focused summary open and close it.
- Read correctly in light and dark themes.
