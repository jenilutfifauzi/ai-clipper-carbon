# 14: Shadow and box padding and radius on the Hook and Caption Styles

**Parent spec:** `spec.md` (Solution "Hook and Caption Styles"; Implementation Decisions "Renderer": their new fields).

**What to build:** the hook and captions share the Text Layers' shadow and plate shapes, so that all text on a Clip can share one look.

- **The Hook Style and the Caption Style take the shadow value type** of ticket 04 (colour, opacity, blur, distance, angle).
  - The Caption Style's existing shadow fields migrate into it.
  - The renderer draws it as an event below each line, offset and `\blur`red, wherever it can't be a plain `\shad`.
- **Padding and radius:** the hook's box (Block and Strips) and the caption highlight box gain `padding_x`, `padding_y` and `radius` in px, replacing their constants.
- Defaults (and the migration) reproduce today's look, so stored Style Presets render as before.
- The clip editor's style fields and Style Overrides through MCP take them.

**Blocked by:** 04.

**Status:** done

- [x] A hook with a shadow at 45° and some blur shows a soft shadow down and to the right in a rendered frame.
- [x] A caption shadow migrated from the old fields renders as before.
- [x] A larger hook box radius rounds its corners. Larger padding widens it in the plan and the frame.
- [x] Every built-in Style Preset's Render Plan and a rendered frame are unchanged at the defaults.

## Comments

**2026-10-17: done.**

**What was built:**
- **Styles** (`backend/app/styles.py`):
  - `CaptionStyle.shadow` and `HookStyle.shadow` are a `DropShadow` (ticket 04's). `shadow_colour` is gone.
  - `HookStyle.padding_x`/`padding_y` and `CaptionStyle.padding_x`/`padding_y`/`radius` (the highlight box) are px at the style's size, 0..200. `None` (the default) is today's: a Shape's own padding, or 0.12/0.08/0.12 of the line's size for the highlight box. The hook already had `radius` (px); it now has a comment.
  - `hard_shadow(offset, colour)` is the old shadow: opaque, unblurred, distance `offset × √2` at 45°, so its offset is exactly `(offset, offset)`. The three built-in Presets that had `shadow=4` use it.
- **Migration:** `migrated_shadow_fields` turns old `shadow` (int) and `shadow_colour` into the new `shadow` fields. An offset of 0 becomes `{distance: 0, blur: 0}` (off, with the old colour). It runs wherever a style or override is read:
  - CaptionStyle and HookStyle hook pydantic's core schema (`_ReadsOldShadow`). This covers presets.json, a Clip's stored styles and the API/MCP preset bodies.
  - `StyleOverrides.caption`/`.hook` have a `BeforeValidator`. This covers stored Candidates, Revisions and Clips, and API and MCP edits.
  - `_apply` runs it too, for overrides built in code.
  - Everything is written back in the new shape on the next save.
- **Overrides of the shadow** name some of its fields (`{"shadow": {"blur": 8}}`), merged onto the Preset's shadow. `_apply` refuses unknown nested names (`shadow.glow`) and a dict on a plain field. `StyleValue` allows such a dict. Its JSON schema is a short `type` list, to keep the MCP tool list small.
- **Renderer** (`backend/app/renderer.py`):
  - A shadow that is on, unblurred and at 45° (offset x == y > 0) stays a plain `\shad` in the Style line. Its BackColour carries the shadow's opacity. This is how old and built-in shadows write byte-for-byte the same ASS.
  - Any other shadow (blurred, or at another angle) is its own event under each line, built with `_shadow_tags` and `LIBASS_BLUR_SIGMA` (ticket 04):
    - A hook line's shadow is on layer 2, written before the lines, so it sits over the box and under the words. It is staggered with its line.
    - A caption's shadow event comes just before each text event, on the text's layer, so it sits over the highlight box.
  - A popping or sliding hook animates only the shadow's own alpha tag (`\3a` when stroked, `\1a` otherwise), so that a stroked shadow's letters stay hidden. This is `_Element.alpha_tag`, passed to `_hook_motion`.
  - `_highlight_shape` gives the highlight box's padding and radius.
- **Planner** (`backend/app/planner.py`): `_hook_padding` gives the box padding at the hook's size, used by Block and Strips, the anchors and the Quote Mark's inset.
  - **Fit:** with the style's own `padding_x`, `fit_hook` fits the line plus padding into the captions' width (`KICKER_WIDEST`, 820) instead of `HOOK_WIDTH`. When the hook is set smaller, the padding shrinks with it.
  - **Defaults:** unset, the fit and every number are exactly as before (`ceil(w + 2·36) == ceil(w) + 72`).
- **MCP:** `merge_candidate_items` merges a style override's shadow field by field (`_merged_fields`). The instructions describe the hook and caption shadow and padding. `TOOLS_BUDGET_BYTES` went from 67,500 to 68,500. The tool list is about 67.8 KB.
- **Clip editor** (frontend):
  - `ShadowFields` (switch, colour, opacity, blur, distance, angle, reusing `withShadow`/`shadowOn`) replaces the Shadow and Shadow colour fields in both panels.
  - The hook's box gets Padding across and Padding down, showing the Shape's own value until set.
  - With a Box highlight, the captions get a Highlight box group (padding across, padding down, corner radius).
  - `useStyleDraft`'s `overridden` and `sameValue` merge and compare a shadow override by its fields. Clips' staleness check uses `overridden` too.
  - The preview draws shadows moved, faded and blurred with an SVG `feGaussianBlur` (σ = blur/2), and the highlight box from the style (`styleShape.ts`).

**Tests:**
- `tests/test_styles.py`:
  - Old presets, overrides and Clip styles are read as `hard_shadow`. A migrated caption shadow writes the exact old Style line.
  - Shadow overrides merge and are refused when bad.
  - A translucent hard shadow is the Style's `\shad` with BackColour alpha.
  - A blurred or turned shadow is an event under each hook line and each caption line (all three highlights), at the offset, over the box.
  - Pop and slide drive the shadow's own alpha.
  - The highlight box's padding and radius, scaled on a shrunk line.
  - The built-in fixture (`builtin_preset_plans.json`) and the v1 byte-for-byte ASS test pass unchanged.
- `tests/test_planner.py`: block and strip padding, with left-aligned lines starting `padding_x` in; no effect without a box; a wider padding fits fewer words per line or a smaller size, and a narrower one more.
- `tests/test_render.py` (a real render): the padded box fills its planned area exactly with rounded corners, and a soft red shadow at 45° falls down-right of the green letters, none of it up-left, much of it blended. A caption override sent in the old shape (`shadow: 4`) is stored in the new shape and burns a magenta shadow 4 px right of and below the letters.
- `tests/test_mcp.py`: padding_x through the dry run (one line becomes two), shadow merged by its fields, an old-shaped caption shadow migrated, and refusals.
- Frontend: `styleShape.test.ts` (padding, highlight shape, shadow look, override merge) and `styleShadowAndBox.test.tsx` (the panels' fields set the overrides).
- Not in the repo: before the change, I wrote the ASS digests of 960 combinations to a scratch file: every built-in Preset × 5 old-shaped caption overrides × 8 old-shaped hook overrides × 3 hooks. After the change, the same overrides (migrated) gave identical digests.

**Decisions:**
- **Unset padding is `None`, "the Shape's own".** A Block's padding is 36/26 px whatever the size, while a Strip's is a share of the fitted size, so no single px default reproduces both. The editor shows the value drawn until one is set.
- **Explicit padding and the highlight radius are px at the style's size,** as a Text Layer plate's are, and shrink with a hook or caption line set smaller. The hook's existing `radius` stays unscaled, as before.
- **Padding does nothing with no box (Shape none).** Those lines keep a block's own placement.
- **A hard 45° shadow stays `\shad`** (with its opacity in BackColour) rather than becoming an event, so stored looks write the same bytes.
- **Known small difference:** while popping, a hook's event shadow scales about its own centre, so for those 200 ms its offset isn't scaled with the text. It is exact once on screen.
- **The preview now draws the caption shadow over the highlight box,** as the render always has (`\shad` belongs to the text event on layer 1). Before, it drew it under the box.
