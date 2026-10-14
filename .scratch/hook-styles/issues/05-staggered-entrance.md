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

**Status:** ready-for-agent

- [ ] One element, or `animation_in: none`, gives v1's ASS.
- [ ] Renderer tests: staggered starts for fade, pop and slide with a Kicker and 3 strips.
- [ ] Hook time shorter than the stagger: every element is still on before the exit starts.
- [ ] Browser check: preview timing matches the render frame by frame at 0.25× speed.
