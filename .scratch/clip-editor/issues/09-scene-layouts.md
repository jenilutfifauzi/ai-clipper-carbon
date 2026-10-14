# 09: Layout per Scene

**Parent spec:** `spec.md` in this feature folder (user story 24; "Layout per Scene").

**What to build:**
- **Candidate:** gains `layout_overrides: list[LayoutOverride(at, layout)]`.
- **Planner:** uses the override for the merged Scene that holds `at`.
- **Timeline:** a Scenes track coloured by Layout, with a popover to set one Scene's Layout (Auto clears the override), and "Analyse scenes" (`prepare`) when not analysed.

**Blocked by:** 03, 08.

**Status:** ready-for-agent

- [ ] Seam B:
  - an override changes only its Scene;
  - it works with the Candidate's Layout set;
  - an override outside the clip does nothing;
  - captions move with a changed Scene's Layout.
- [ ] Seam A: a render with one Scene overridden to Blur.

## Comments
