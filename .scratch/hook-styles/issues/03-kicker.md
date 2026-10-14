# 03: Kicker

**Parent spec:** `spec.md` in this feature folder (user stories 9, 16, 17; "Kicker on the Candidate", "HookEvent", "Drawing").

**What to build:**
- **Candidate** gains `hook_kicker: str = ""`: at most 24 characters, whitespace collapsed. PATCH takes it and a change marks the Candidate edited. `preview-plan`'s draft takes it too.
- **HookStyle** gains `kicker_colour` (`#000000`) and `kicker_box_colour` (`#FFE600`).
- **Planner:** `HookEvent.kicker = (text, box, size)`:
  - its size is 0.55 × the hook's set size, on one line, shrunk if too wide;
  - it sits above the first line, aligned like the hook, with a 0.25 × size gap;
  - `area` grows to hold it, so positions keep the whole hook in the safe area;
  - emoji are stripped and `uppercase` applies.
- **Renderer:** a pill (radius = half its height) with its text.
- **Preview:** the same pill.
- **Staleness:** `RenderedClip.hook_kicker` is recorded and compared. Old `clips.json` files read it as `""`.
- **HookEditor:** a Kicker input above the hook, with a 24-character counter, saved like the hook text.
- **Style panel:** the Kicker colours go in the Box and decoration group.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] An empty Kicker gives v1's plan and ASS.
- [ ] Seam B tests: Kicker placement for each position and alignment, inside the safe area.
- [ ] Seam A tests: PATCH validation (25 characters refused); a draft Kicker in `preview-plan`; a render's plan file holds it; a changed Kicker marks the Clip changed.
- [ ] Browser check: preview and render agree.
