# 05: Staggered entrance

**Parent spec:** `spec.md` in this feature folder (user story 12; "Stagger").

**What to build:**
- When `animation_in` isn't `none`, elements come on in order, each `HOOK_STAGGER_MS` = 80 ms after the last:
  - the Kicker;
  - each line, together with its strip;
  - with `block`, the box comes on with the first line, and the Quote Mark with the first box.
- The exit is not staggered.
- **Renderer:** `_hook_phases` and `_hook_motion` take a per-element offset.
- **Preview:** `hookLook` mirrors it.
- Check the motion with `emil-animations` (easing stays as the renderer's linear `\t`; the preview must match it, not ease differently).

**Blocked by:** 01, 03, 04.

**Status:** done

- [x] One element, or `animation_in: none`, gives v1's ASS.
- [x] Renderer tests: staggered starts for fade, pop and slide with a Kicker and 3 strips.
- [x] Hook time shorter than the stagger: every element is still on before the exit starts.
- [x] Browser check: preview timing matches the render frame by frame at 0.25× speed.

## Comments

**2026-10-14: done.** `uv run pytest tests/test_styles.py`: 25 passed (4 new renderer tests). The v1 fixture is unchanged. `npm run typecheck` and `npm run build` pass.

**Change from the plan:** a two-line hook with a pop or slide entrance and no Kicker is now staggered too, since it has two elements. `test_a_popping_hook_grows_from_70_percent_and_shrinks_back_split_into_in_hold_and_out` was updated: its second line comes on at 0.08 s. Only one element, or no entrance, keeps the old ASS.

Built:
- **Renderer:** each element carries its step: the Kicker (pill and text) 0; line i and its strip `first + i`; a block and the Quote Mark with the first line. `_stagger` gives `HOOK_STAGGER_SECS` (0.08 s), or less when the hook is too short for every element to be on before the exit (`(time − entrance − exit) / steps`). `_hook_phases` takes the element's delay; exits are not staggered. Events stay ordered by part, then element.
- **Preview:** `hookEnds`, `stagger` and `hookLook(…, delay)` mirror them. `Hook` fades, moves and grows each element by its own step's look, with the renderer's linear timing.

**Checks:** Browser (scratch clone), pop in over 200 ms with the Kicker, two strips and a Quote Mark, at 0.1 s: Kicker 0.5; first strip, first line and Quote Mark 0.1; second strip and line 0. These are the values the ASS `\t` gives at that time.
