# 04: Drop shadow, plate shapes, line height and tracking

**Parent spec:** `spec.md` (Implementation Decisions "Domain and model" (Text Style), "Planner (layout)", "Rasteriser").

**What to build:** the rest of the Text Style's look, in the inspector and the agent's tools.

- **The drop shadow:** a value type of its own (`colour`, `opacity`, `blur` px, `distance` px, `angle` degrees), shared later by the Hook and Caption Styles (ticket 14). Off when its opacity is 0, or when its distance and blur are both 0.
  - The rasteriser draws it as its own event below the text: the text in the shadow's colour and opacity, offset by distance and angle, and `\blur`red. libass's `\blur` acts on the outline, so it can't be a `\shad`.
  - The picture grows to hold the shadow.
- **The plate:** `shape` gains `strips`, a rounded rectangle behind each line (the Hook Shape's values). Radius and padding become editable.
- **Line height and tracking:**
  - `line_height` sets the anchors' pitch.
  - `tracking` (px, may be negative) is added after every character but a line's last. Line breaking measures it, and the rasteriser sets it as `\fsp`.
- **Inspector:** Shadow, Plate and Spacing sections, laid out as the existing fields are.
- **MCP:** every field can be set and merged, the shadow and the plate by their own fields.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] A rendered frame shows a shadow offset in the direction of its angle by its distance, softened by its blur. A zero-distance shadow with blur makes a halo.
- [ ] Strips draws one rounded plate per line, each as wide as its line plus padding. Block draws one plate.
- [ ] Planner: tracking widens a line by (n−1)×tracking, and the wrapped lines account for it. Line height sets the gap between anchors.
- [ ] `merge_candidate_items` changing `style.shadow.angle` keeps the shadow's other fields.
- [ ] Out-of-range values (negative blur, opacity over 1) are refused.
