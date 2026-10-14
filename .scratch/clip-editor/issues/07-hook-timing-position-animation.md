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

**Status:** done

- [x] The hook shows from `hook_start` for `hook_secs` (default 3 s), clamped to the Clip. A start at or past the end gives no hook.
- [x] Default animations (none in, fade out over 200 ms) keep v1's ASS exactly.
- [x] Renderer tests check each animation's tags.
- [x] A hook not at 0 s isn't on the first frame; the UI says so, since platforms show the first frame.

## Comments

**2026-10-14: done.** `make test`: 293 passed (1 new Seam B timing test, 4 renderer tests). `npm run typecheck` and `npm run build` pass.

**Change from the plan:** `hook_secs` is a number with a default of 3.0, not `None`. A PATCH can't clear a field back to `None`, since `None` means "leave as is".

Built:
- **Timing.** `Candidate.hook_start` (0.0) and `hook_secs` (3.0). PATCH validates `0 ≤ start ≤ 180` and `0.5 ≤ secs ≤ 30`, and a change marks the Candidate edited. The planner's `_hook` keeps the hook in the Clip, and a start at or past the end gives no hook.
- **`HookStyle` animations:** `animation_in` (none), `animation_out` (fade) and `animation_ms` (200, from 50 to 1000).
- **Renderer** (`_hook_phases`, `_hook_motion`):
  - **Fading only, or none:** one event per element with `\fad(in,out)`. The default is v1's `\fad(0,200)`, so the v1 fixture stays byte-identical, and v1's number formats are kept.
  - **Pop or slide at either end:** the hook is split into in, hold and out parts, each animation taking `animation_ms` (at most half the hook's time).
    - Pop: `\fscx70\fscy70\alpha&HFF&\t(\fscx100\fscy100\alpha<own>)`, reversed on the way out. A popping box is placed `\an5` by its centre.
    - Slide: `\move` from 60 px below, with `\t` on alpha.
- **Preview:** `hookLook(time, hook, style)` mirrors those phases: opacity, a scale from each element's centre (`transform-box: fill-box`), and a slide offset.
- **UI:**
  - The Style panel's hook section gains "Comes on", "Goes off" and "Animation" (overridable like any style field).
  - `HookEditor` gains "Comes on at" and "Stays for" sliders. They preview at once, save after 700 ms, show how much fits in the Clip, and warn "Not on the first frame…" when the start isn't 0.

**Checks:**
- **libass** (pop and slide, both ends, 400 ms, rendered over a plain background): the popping box grows from its centre with its text and fades in, and shrinks back at the end. The sliding hook rises 60 px into place and goes down at the end.
- **Browser** (2f6cdf1b, scratch clone): start 1.0 s, 2.5 s long, pop in over 600 ms. Saved as `hook_start 1, hook_secs 2.5, overrides {animation_in: pop, animation_ms: 600}`. The preview showed no hook at 0.5 s, opacity 0.5 and scale 0.85 at 1.3 s, and full at 2.0 s. The first-frame warning was shown.
