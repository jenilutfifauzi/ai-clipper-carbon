# 06: A Transition's sound: Linear, Equal power or Cut

**Parent spec:** `../spec.md` ("Model", "Catalogue and rendering" Sound, "Preview" Sound, "Advanced Edit" join inspector).

**What to build:** the owner chooses how the sound crosses a join.
- **The field.** A Transition gains `sound`: `linear` (the default, today's sound), `equal_power` or `cut`.
- **The render:**
  - Linear is `acrossfade`'s `tri`.
  - Equal power is `qsin` on both curves.
  - Cut switches at the middle of the overlap: each side gets a short `afade` at the middle, and `acrossfade` uses `nofade` on both curves.
  - A dip never drops the sound out on its own.
- **The preview.** Both the ghost's and the incoming Segment's volumes follow the chosen curve over the overlap. Today only the ghost fades.
- **The join inspector** has a segmented control, Linear / Equal power / Cut. A change is one undo step.
- **The agent.** `TransitionEvent`, the dry run and the tool descriptions carry `sound`.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] With a tone on each side, a Cut render has only the first tone just before the middle of the overlap and only the second just after.
- [ ] Equal power keeps the summed level near constant at the middle, while Linear dips there.
- [ ] Linear renders the same audio as before.
- [ ] Stored Transitions read as Linear.
- [ ] The preview's volumes for both sides follow each curve (vitest on the curve maths).
- [ ] MCP can set `sound`, and the dry run shows it.
