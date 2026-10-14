# 07: Hook timing, position and animation

**Parent spec:** `spec.md` in this feature folder (user stories 19–21; "Hook timing").

**What to build:**
- **Candidate:** gains `hook_start` and `hook_secs`.
- **HookStyle:** `animation_in`, `animation_out` and `animation_ms` take effect, as ASS tags:
  - `fade`: `\fad`
  - `pop`: `\t` with `\fscx` and `\fscy`, from 70% to 100%
  - `slide`: `\move`, from 60 px below
- **Preview.** The same animations in CSS.
- **`HookEditor`:** gains start, duration, position and animation controls.

**Blocked by:** 01, 04.

**Status:** ready-for-agent

- [ ] The hook shows from `hook_start` for `hook_secs` (default 3 s), clamped to the Clip. A start at or past the end gives no hook.
- [ ] Default animations (none in, fade out over 200 ms) keep v1's ASS exactly.
- [ ] Renderer tests check each animation's tags.
- [ ] A hook not at 0 s isn't on the first frame; the UI says so, since platforms show the first frame.

## Comments
