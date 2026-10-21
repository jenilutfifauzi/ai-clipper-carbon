# 01: Gaussian blur on an Overlay, end to end

**Parent spec:** `../spec.md` ("Model", "Catalogue", "Sizes", "Planner", "Renderer", "Preview", "Editor actions", "Inspector UI", "API and MCP"); ADR 0014.

**What to build:** the owner, or an agent, gives an Overlay (a video or an image) a stack of Video Effects. Its first entry is **Gaussian blur**. The preview shows the blur at once, and the rendered Clip has the same blur.

**The catalogue:** video effects join the Audio Effects registry under a video kind. Each entry has:
- an id, a name, a category (Blur, Distort, Light, Stylize, Cutout), an order and a description;
- its settings, one of them marked as the intensity;
- a pure chain builder that takes the settings, the picture's scale and its size.

The registry starts with Gaussian blur alone (radius 1–50 px, default 10). The rest come in 04, 05 and 06.

**The model:** an Overlay gains `video_effects`, an ordered list of `{id, params, enabled}`. It is empty by default, and an absent list reads as empty.

**Validation, on every save path:**
- An unknown id, an unknown setting key, a value out of range, or the same id twice in one stack is refused, naming the item, the index and the reason.
- A setting left out takes the catalogue default.

**Sizes:** px settings are output pixels at the picture's fitted size (scale 1). The planner multiplies them by the Overlay's scale (the larger of scale × stretch on each axis), and the plan carries the scaled values.

**The render:** the stack's chain runs after the Overlay's Grade and before its corners, border, rotation, shadow and opacity.

**The preview:** each effect has an SVG filter imitation, chained after the Grade's filter on the Overlay's picture element. Gaussian blur is `feGaussianBlur` at the planned radius.

**The editor:**
- An Effects section in the Inspector for an Overlay, after its colour section.
- One row per entry: the intensity slider, "More" for its other settings, an on/off switch, move up / down and remove. "Remove all" clears the stack.
- "Add effect" opens a library popover by category. An effect already in the stack is greyed out.
- Each action is one step of undo, and a slider drag is a single step. On a Pick of several Overlays, the actions apply to all of them when their stacks are equal.
- Split, duplicate, the Clipboard and the Revision merge carry the field.

**What the agent sees:**
- `GET` the video effects catalogue.
- MCP `list_assets(kind="video_effects")`.
- `edit_candidate` and `merge_candidate_items` take `video_effects` on Overlays, and `merge_candidate_items` replaces a stack as a whole.
- `dry_run` shows each Overlay's stack.
- The server instructions describe the stack, its place after the Grade and the size rule.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Overlays accept `video_effects`. Stored Candidates plan and render exactly as before (the existing command fixture is unchanged).
- [x] The registry lists Gaussian blur under the video kind. It validates, fills defaults and refuses duplicates, and a disabled entry adds nothing.
- [x] Seam B: the stack reaches the Overlay's plan with only its enabled entries, and the radius is scaled by the Overlay's scale.
- [x] Seam A: a blurred Overlay lowers edge contrast in the rendered frame, and a scaled-up Overlay is blurred proportionally more.
- [x] Refusals cover an unknown id, an unknown key, an out-of-range value and a duplicate, through the API and through MCP.
- [x] `list_assets(kind="video_effects")`, the `dry_run` stacks and the instructions text are in place.
- [x] The preview shows the blur on the Overlay and follows the slider live.
- [x] Vitest: add (skipping duplicates), move, toggle, remove, remove all and set by index, on a Pick of one and of several Overlays.
- [x] Gaussian blur's chain runs at its default, minimum and maximum over a 1 s 1080×1920 clip and keeps its size and length.

## Comments

Built end to end for Overlays.
- **Backend:** `app/video_effects.py` is the registry's video kind. It shares `Setting` with `app/audio_effects.py` and provides `Category`, `Effect`, `VideoEffect`, `checked_video_effects`, `enabled_video_effects`, `scaled_effects`, `video_effect_chain(stack, size)` and `catalogue()` (each entry has `"kind": "video"`).
  - A builder takes `(params, drawn size)`. Its px params are already scaled: the planner scales them (`overlay_scale` = scale × max(stretch)), so the plan carries what is drawn.
  - `scaled_plan` also scales them for 720p and 4K renders.
  - `GET /api/video-effects`; MCP `list_assets(kind="video_effects")`; the dry run lists `video_effects` under each Overlay; the instructions have a paragraph on them.
  - The MCP tools budget went up to 86_100.
- **Frontend:**
  - `src/videoEffects.ts`: catalogue store and `videoLibraryOf`.
  - `editor/videoEffects.ts`: `scaledEffects`, `draftVideoEffects` for the live slider, the `IMITATIONS` table, `effectsFilterId` and `pictureBox`.
  - `EffectFilters` in `GradeFilters.tsx`: one SVG filter per stack and size, `primitiveUnits="objectBoundingBox"`, so it holds at any stage size. It is chained after the Grade's filter on PicturePanel's inner element.
  - Editor actions in `actions.ts`: `picturedItems`, `addVideoEffect`, `moveVideoEffect` and the rest.
  - `VideoEffectsFields.tsx` reuses AudioEffectsFields' `EffectRow`, which is now exported. It is shown on a desktop only (`videoEffectsShown`).
- **Deferred to 03:** a keyed or animated Overlay (one with a frame process) does not get its effects in the render yet. The preview still draws them.
- **Near:** the SVG blur fades to transparent at the item's edges. ffmpeg's `gblur` extends them.
- **Not done:** a picture with its own alpha is blurred without premultiplying.

