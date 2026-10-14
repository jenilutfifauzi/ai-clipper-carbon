# 03: Hook tab

**Parent spec:** `spec.md` in this feature folder (user stories 2, 4, 5; "Hook, always shown").

**What to build:**
- **Hook tab sections:** Words, Look, When and where, then More options.
- **`HookEditor`:** keeps the words. The timing sliders move to When and where, and the hint that the look is in Style goes.
- **Hook Style controls:** move from `StylePanel` into the Hook tab. `StylePanel.tsx` is removed.

**Blocked by:** 01, 02.

**Status:** done

- [x] Shape, font, colours, position and timing are in view without opening More options.
- [x] No box hides the box colour but keeps its value.
- [x] The first-frame warning and the fit message still show.

## Comments

**2026-10-14: done.** `npm run typecheck` and `npm run build` pass.

Built:
- **Hook tab:** **Words** (`HookEditor`: Kicker, hook text, Emphasis, fit message), **Look**, **When and where**, then **More options**.
  - **Look:** Shape cards; font, size, text, Emphasis and box colours.
  - **When and where:** position; `HookTimingFields` with the first-frame warning, moved out of `HookEditor`.
  - **More options:** lines, align and capitals; box opacity, radius, outline and shadow; Quote Mark; Kicker colours; animation.
- **Removed:** `StylePanel.tsx`, and the hint "Its look … are in Style". The too-long message now adds "Allow more lines in More options".
- **Box colour** is hidden for No box and keeps its value.

**Browser check:** the tab shows the sections in order. Picking Strips previewed and was saved.
