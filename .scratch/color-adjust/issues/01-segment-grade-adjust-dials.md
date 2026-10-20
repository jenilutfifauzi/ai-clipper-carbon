# 01: A Segment's Grade with the Adjust dials

**Parent spec:** `../spec.md` ("Model", "The fold", "Planner", "Renderer", "Preview", "Advanced Edit UI", "MCP"); ADR 0013.

**What to build:** the owner picks one or more Segments (of the Source or a media item) in the Advanced Edit. A Color section in the Inspector grades them with eleven Adjust dials in Concat's ranges:
- temperature (2000–11000 K, 6500 neutral);
- tint;
- saturation;
- exposure (±3 EV);
- brightness, contrast, highlights, shadows, whites and blacks;
- fade.

The dials are grouped as Color, Lightness and Effects. Each dial resets with a double-click, and the section has a reset button. Each change is one step of undo. A dial drag shows on the preview at once.

**Where it shows:**
- **Source Segments:** the panel videos switch filter at each Segment's span, on both decks and the Transition ghost.
- **Media Segments:** each one's element carries its filter.
- **Render:** the graded Segment's whole frame (panels, picture, Background), before the joins, so a Transition blends graded pictures.

**The fold** turns a Grade into one table per channel (exposure, brightness, contrast, highlights, shadows, whites, blacks, fade) and one colour matrix (temperature, tint, saturation). It is written twice:
- in Python, for the render (`lutrgb` or `curves`, then `colorchannelmixer`);
- in TypeScript, for the preview (an SVG `feComponentTransfer` and an `feColorMatrix` with `color-interpolation-filters="sRGB"`).

One shared JSON fixture pins both. A neutral Grade adds no filter anywhere.

**The model:**
- `Grade` holds `adjust`, plus `look` and `intensity`, which stay unused until 05. Only `Adjust`'s eleven dials are read here; sharpen and vignette come in 02.
- It lives on Segment as `grade`.
- Split, duplicate, paste and Freeze frame keep it.

**The agent:** sets it through `edit_candidate` and field by field through `merge_candidate_items`. The dry run's segment view shows it.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] **Model:** a stored Candidate without `grade` reads with a neutral Grade. Out-of-range dials are refused with the dial named.
- [ ] **Fold:** pytest and vitest both pass the shared fixture: neutral, each dial alone at both ends, and a mix.
- [ ] **Render, on a test source of known colours:**
  - Raising temperature warms a grey patch (R up, B down).
  - Raising exposure brightens it.
  - Saturation −100 turns a coloured patch grey.
  - A Segment's Grade changes only that Segment's frames.
- [ ] **Neutral Grade:** it renders the same pixels as no Grade.
- [ ] **Render cost:** a graded Clip renders within a set budget of an ungraded one.
- [ ] **Planner:** Segment plans carry their Grade.
- [ ] **MCP:** `merge_candidate_items` sets one dial of a Segment's Grade and keeps the others. The dry run lists it.
- [ ] **Editor (vitest):**
  - A dial change on a multi-Segment Pick is one undo step.
  - Split, duplicate, paste and Freeze frame keep the Grade.
  - The preview filter is built from the fold's output.
- [ ] **GLOSSARY:** terms used as written (Grade, Adjust).
