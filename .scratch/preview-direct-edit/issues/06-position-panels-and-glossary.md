# 06: Position panels and glossary

**Parent spec:** `spec.md` in this feature folder ("Style").

**What to build:**
- The hook's and captions' Custom Position shows an x slider next to the y one. Top, Middle, Bottom and Auto put x back at 540.
- GLOSSARY: Hook Style and Caption Style say they are placed where they are dragged on the preview.

**Blocked by:** 01.

**Status:** done

- [x] Browser: a drag on the preview moves the sliders; Top puts the hook back in the middle.

## Comments

**2026-10-15: done.** `npm run typecheck` and `npm run build` pass.

Built: the hook's and the captions' Custom Position show a slider for the middle across ("Hook's middle across", "Line's centre across", 0–1080 px, 540 without an x). Choosing any other Position clears the x override. The hook's height slider now reaches 1536, as far as a drag can put it (the planner keeps the hook in the safe area). GLOSSARY: Caption Style and Hook Style are placed wherever they are dragged on the preview.

**Checks:** Browser (clip editor, scratch clone): after a drag, the Hook tab's sliders read 767 px high and 423 px across. Choosing Top saved `{position: top}` without x, which put the hook back in the middle.
