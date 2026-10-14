# 02: Emphasis in the hook, and emoji stripped

**Parent spec:** `spec.md` in this feature folder (user stories 6, 7, 16; "Hook text and Emphasis", "Hook fit check").

**What to build:**
- **Markup.** The planner parses `*run*` in the hook text into runs `(text, emphasised)`:
  - runs may span words, and an unpaired `*` is shown as written;
  - emoji (`Extended_Pictographic`, variation selectors, ZWJ) are removed before fitting;
  - `uppercase` is applied after parsing.
- **Width.** Fitting measures the text without its markup.
- **HookStyle** gains `emphasis_colour` (`#FFE600`).
- **Renderer:** `\c` switches per run.
- **Preview:** `<tspan>` fills per run.
- **HookEditor:**
  - An "Emphasis" button and Cmd/Ctrl+B wrap the selection in `*`, or unwrap an already wrapped selection. Selections snap to word boundaries.
  - The fit warning comes from the Preview Plan (`hook.size < hook_style.size`). `GET /api/hook` is removed if nothing else uses it.
- **Style panel:** the Emphasis colour goes in the Text group.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Seam B tests: spanning runs, an unpaired `*`, `**` (empty), emoji stripped, uppercase with markup.
- [ ] Renderer test: colour switches around an emphasised run. Text without markup gives v1's ASS.
- [ ] Cmd/Ctrl+B toggles Emphasis and keeps the selection; the button has an accessible name and pressed state.
- [ ] Browser check: preview and render agree on Emphasis colours.
