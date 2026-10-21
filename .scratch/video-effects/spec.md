# Video effects: an effect stack per picture, and Blend Modes for Overlays

Status: ready-for-agent
Created: 2026-10-21

## Problem Statement

The Advanced Edit can now colour every picture (Grades, Looks, Adjustment Layers), but it can't change how a picture looks beyond its colour.

- **Nothing can be blurred.** The owner can't soften a busy background Overlay, blur a face or a screen, or smear a picture for movement.
- **No stylised looks.** Short-form clips often use grain, glow, a pulsing bloom on a beat, a pixelated or posterized moment, a fisheye or an RGB fringe. None of these can be made.
- **No green screen.** An Overlay of a presenter shot on green, or a logo on black, can't have its background keyed out.
- **Overlays can only be laid over normally.** A light leak, a dust texture or a flare on black needs Screen or Add; a paper texture needs Multiply.
- **Concat has all of this:**
  - 21 effect packages, of which 14 are not colour: sharpen, gaussian, motion and zoom blur, chromatic aberration, fisheye, pixelate, bloom pulse, halftone, film grain, glow, posterize, vignette, chroma key and luma key;
  - each clip has an ordered chain of them, with bypass, reorder, remove and a starred library;
  - each clip has a blend mode.
- **"Filters and effects" are Out of Scope in `.scratch/advanced-edit/spec.md`.** Filters were overturned by ADR 0013 and sound effects by ADR 0017; video effects stay out.

## Solution

Every picture in the Advanced Edit gets a stack of **Video Effects**: Segments (of the Source or a media item), Overlays (videos and images) and Adjustment Layers.

- **Eleven effects in five categories:**
  - Blur: Gaussian blur, Motion blur;
  - Distort: Pixelate, Chromatic aberration, Fisheye;
  - Light: Glow, Bloom pulse;
  - Stylize: Posterize, Film grain;
  - Cutout: Chroma key, Luma key (Overlays only).
- **The stack comes after the item's Grade.**
  - A Segment's effects apply to its whole frame before the joins, so a Transition crossfades pictures that already carry them.
  - An Overlay's apply to its picture before its corners, border, rotation, shadow and opacity.
  - An Adjustment Layer's apply over the Main Track and the Overlays under it, mixed back with its Grade by its strength and fades.
- **The Inspector has an Effects section** under the colour section:
  - one row per effect, with its main slider, other settings behind "More", an on/off switch, move up / move down and remove;
  - an "Add effect" button that opens the effect library.
- **The Asset Panel gets an Effects tab,** like the Filters tab:
  - cards by category, each showing the frame at the playhead with its effect;
  - hovering a card tries it on the preview;
  - a click adds it to the Pick's stacks;
  - dragging one onto the Timeline makes an Adjustment Layer with that effect.
- **A star on each library tile** marks a favourite, kept for every Job, in both the Video and Audio Effect libraries. A Starred filter shows only those.
- **Chroma key has an eyedropper.** Clicking the paused preview picks the colour of the Overlay's own (graded) picture at that point. A swatch and a hex field are there too; the default is broadcast green.
- **An Overlay has a Blend Mode:** Normal, Multiply, Screen, Add, Lighten or Darken.
- **The preview shows effects at once.** It imitates them with SVG filters on the elements it already draws. Some are exact, some only near; "Compare render" shows the exact pixels.
- **The agent can do all of it** through `list_assets`, `edit_candidate`, `merge_candidate_items` and `dry_run`.

## User Stories

1. As a clip editor, I want to add Gaussian blur to an Overlay, so that a busy screenshot sits behind the hook without competing.
2. As a clip editor, I want to add Gaussian blur over a span with an Adjustment Layer, so that a moment I can't show is blurred everywhere.
3. As a clip editor, I want Motion blur with a length and an angle, so that a picture looks like it is moving fast.
4. As a clip editor, I want Pixelate with a block size, so that I can hide a name or a face in a media Segment.
5. As a clip editor, I want Chromatic aberration, so that a glitchy moment has colour fringes toward the edges.
6. As a clip editor, I want Fisheye with a strength, so that a reaction shot bulges for comedy.
7. As a clip editor, I want Glow, so that bright parts of a picture bloom softly.
8. As a clip editor, I want Bloom pulse with an amount and a speed, so that highlights throb on a punchline.
9. As a clip editor, I want Posterize with a number of levels, so that a picture looks flat and graphic.
10. As a clip editor, I want Film grain over the whole Clip through an Adjustment Layer, so that the edit has a film texture.
11. As a clip editor, I want Film grain to move every frame, so that it looks like grain and not a dirty screen.
12. As a clip editor, I want Chroma key on a green-screen Overlay, so that the presenter stands over my Clip.
13. As a clip editor, I want to pick the key colour with an eyedropper on the preview, so that I don't have to guess the green.
14. As a clip editor, I want similarity, softness and spill settings on Chroma key, so that the edges are clean and the green fringe is gone.
15. As a clip editor, I want Luma key with a threshold, softness and invert, so that a logo on black or white drops its background.
16. As a clip editor, I want each effect's main setting as one slider in its row, so that the common change is one drag.
17. As a clip editor, I want an effect's other settings behind "More", so that the row stays simple.
18. As a clip editor, I want to switch an effect off without removing it, so that I can compare with and without.
19. As a clip editor, I want to reorder effects, so that I choose whether a picture is blurred then pixelated or the other way round.
20. As a clip editor, I want an effect already in a stack greyed out in the library, so that I don't add it twice.
21. As a clip editor, I want to remove one effect or all of them, so that I can start over.
22. As a clip editor, I want an Effects tab with cards showing my frame with each effect, so that I can see what they do before I add one.
23. As a clip editor, I want hovering a card to try it on the preview, so that I can audition effects quickly.
24. As a clip editor, I want to drag an effect card onto the Timeline to make an Adjustment Layer, so that I can apply it over a span of several items.
25. As a clip editor, I want to star effects I use often and filter the library to them, so that I find them fast.
26. As a clip editor, I want my stars on every Job, whichever browser I use, so that I set them up once.
27. As a clip editor, I want to star Audio Effects too, so that both libraries work alike.
28. As a clip editor, I want a bigger picture to get a bigger blur, so that scaling an Overlay keeps its look.
29. As a clip editor, I want effects on a picture with Keyframes to look the same as on a still one, so that animating it doesn't change its effects.
30. As a clip editor, I want an Overlay's Blend Mode set to Screen, so that a light leak on black adds light instead of covering the picture.
31. As a clip editor, I want Multiply, Add, Lighten and Darken too, so that textures and flares sit in the picture.
32. As a clip editor, I want the preview to show effects and Blend Modes as I change them, so that I don't wait for a render.
33. As a clip editor, I want "Compare render" to include effects, so that I can check the exact pixels of the ones the preview only approximates.
34. As a clip editor, I want to change effects on several picked items at once, so that matching Overlays stay matched.
35. As a clip editor, I want split, duplicate, copy and paste to keep an item's effects, so that editing doesn't lose them.
36. As a clip editor, I want undo to take back each effect change as one step, so that a slider drag is one undo.
37. As a clip editor, I want the rendered Clip to have the effects I saw, so that the preview can be trusted.
38. As the owner, I want Clips without effects to render exactly as before, so that nothing old changes.
39. As an agent, I want to list the video effects catalogue with each setting's range, so that I can choose valid values.
40. As an agent, I want to set an item's stack and an Overlay's Blend Mode through `edit_candidate` and `merge_candidate_items`, so that I can apply effects without the editor.
41. As an agent, I want `dry_run` to show each item's effects and Blend Mode, so that I can check what will render.
42. As an agent, I want a clear refusal for an unknown effect, a value out of range, a duplicate in a stack, or a key on a Segment, so that I can fix my request.

## Implementation Decisions

- **ADR 0014** records the core decisions: a stack after the Grade on Segments, Overlays and Adjustment Layers; the eleven effects and what was dropped; keys on Overlays only; sizes at the fitted size; time from the item's start; SVG imitation; Blend Modes on Overlays; quarter-resolution blurs; global favourites. This feature overturns "effects stay out" in `.scratch/advanced-edit/spec.md` for pictures.
- **Model:**
  - Segment, Overlay and AdjustmentLayer gain `video_effects`: an ordered list of applied effects, empty by default. An absent list reads as empty, so stored Candidates are unchanged.
  - An applied effect has the shape of an Audio Effect's: `id`, `params` (a map from setting key to value; a missing key takes the default) and `enabled` (true by default).
  - An id appears at most once in a stack. A Cutout effect on a Segment or an Adjustment Layer is refused.
  - Overlay gains `blend`: `normal` (default), `multiply`, `screen`, `add`, `lighten` or `darken`.
  - Settings are constant over the item. They have no Keyframes.
- **Catalogue (extends `backend/app/audio_effects.py`'s registry, or a sibling module sharing its types):**
  - Video effects join the registry under a video kind. Each has an id, a name, a category (Blur, Distort, Light, Stylize, Cutout), an order, a description, its settings (one marked as the intensity) and a pure builder from settings, the picture's scale and its size to an ffmpeg video filter fragment.
  - A setting may be a number or a colour (`#RRGGBB`), for the chroma key.
  - Its interface: list the catalogue as plain data, filtered by kind; validate an applied effect (the same rules as audio, plus no duplicates and the Cutout rule, which needs the item kind); build the chain of a stack from its enabled entries in order.
  - Settings, matched to Concat for behaviour, not copied:
    - Gaussian blur: radius 1–50 px (10).
    - Motion blur: length 2–60 px (18), angle −90–90° (0).
    - Pixelate: size 2–64 px (16).
    - Chromatic aberration: shift 1–24 px (4); red scaled up and blue down about the centre.
    - Fisheye: strength 5–100% (50).
    - Glow: amount 10–100% (45).
    - Bloom pulse: amount 0–100% (50), speed 0.5–5 (2).
    - Posterize: levels 2–8 (4).
    - Film grain: amount 2–40 (12).
    - Chroma key: colour (#00B140), similarity 1–60% (30), softness 0–50% (10), spill 0–100% (50).
    - Luma key: threshold 0–100% (10), softness 0–50% (10), invert (0 or 1).
  - Built-in effects never change their look. A revision is a new id.
- **Sizes:** px settings are output pixels at the picture's fitted size (scale 1). The planner multiplies them by the item's scale (by the larger of `scale × stretch_x` and `scale × stretch_y`) for the render. A Segment's effects apply to the 1080×1920 frame, so its scale is 1.
- **Time:** Bloom pulse's phase and Film grain's seed run from the item's start (`t` minus the item's start on the Timeline). A still image with either is read as a looping stream for its span, not drawn once.
- **Planner:**
  - SegmentPlan, OverlayEvent and AdjustmentEvent carry the item's validated, enabled stack, with sizes already scaled, and OverlayEvent its Blend Mode.
  - The dry-run view lists each item's stack and each Overlay's non-Normal Blend Mode.
- **Renderer:**
  - **Segment:** the stack's chain goes after its Grade (`renderer.py` `_segmented`), before fps/format and the joins. A Segment with effects is not "plain" for the concat fast path or the collapse back into a range.
  - **Overlay:** after Grade, before `format=rgba` and the corners (`_picture`). A Cutout effect leaves an alpha that the rest of the chain keeps.
  - **Keyed picture (frame process, ADR 0008):** the stack is added to the decoder's `-vf` after the Grade (`frames.py` `VideoDecode`), at scale 1. A still image takes the looping route when an effect changes with time, and `graded_image` otherwise.
  - **Adjustment Layer:** the stack follows its `grade_filters` on the split branch, before the strength and fades (`_adjustment`).
  - **Glow and Bloom pulse** blur a quarter-size copy and scale it back before the `blend=screen`.
  - **Blend Mode:** for a non-Normal Overlay, the picture is padded to the frame with transparency. Its colour is blended over the frame below with `blend=all_mode=<mode>`, then masked by its alpha (`alphamerge`) and laid over with `overlay`, enabled over its span. Normal keeps today's `overlay`.
  - **Render cost:** a ticket measures each effect at its defaults, and a non-Normal Blend Mode, on a 1080×1920 test clip. The table goes into ADR 0014.
- **Preview (frontend):**
  - Each effect has an SVG filter imitation, chained after the Grade's in the same `<defs>` (`GradeFilters.tsx`), on the same elements: the decks for a Segment, the inner picture element for an Overlay, the Adjustment Layer's wrapper.
  - The imitations, from the planned (scaled) sizes:
    - Gaussian blur: `feGaussianBlur`.
    - Motion blur: a directional blur, rotated by its angle (near).
    - Pixelate: a tiled sample (near).
    - Chromatic aberration: channels split, red and blue scaled about the centre, recombined (near).
    - Fisheye: `feDisplacementMap` with a generated radial map.
    - Glow: blur and `feBlend` screen, mixed.
    - Bloom pulse: highlights, blur and screen. The amount is set on `Playback`'s frame from `sin`.
    - Posterize: `feComponentTransfer` discrete.
    - Film grain: `feTurbulence`, reseeded each frame on `Playback`'s frame.
    - Chroma key: alpha from the distance to the key colour by `feColorMatrix` and a table (near).
    - Luma key: luminance to alpha, then a table.
  - Blend Mode: CSS `mix-blend-mode` on the Overlay's outer element.
  - "Compare render" covers effects with no change: it already renders through the render path.
  - The Effects tab's cards apply each effect's imitation, at its defaults, to the frame at the playhead, as the Filters tab's cards do.
- **Editor actions:** following the Audio Effects actions (`actions.ts`):
  - Add effect appends to every picture in the Pick that can take it, skipping one that already has it, or a Segment or Adjustment Layer for a Cutout effect.
  - Move up / down, enable, remove, remove all and change a setting act on one entry by index.
  - Each action is one step of undo, and works on a Pick of several items whose stacks are equal.
  - Dropping a card on the Timeline makes an Adjustment Layer with a neutral Grade and that effect, as a Look drop does.
  - Split, duplicate, the Clipboard and the Revision merge carry `video_effects` and `blend` as fields of the item.
- **Inspector UI:**
  - An Effects section for a Segment, an Overlay and an Adjustment Layer, after the colour section. Its rows match the Audio Effects rows: intensity slider, "More" popover, switch, up/down and remove; "Add effect" opens the library popover.
  - The chroma key's colour setting is a swatch, a hex field and an eyedropper. The eyedropper takes a click on the paused preview, reads the Overlay's media frame at that point, and passes it through the Overlay's Grade fold (`grading.ts`).
  - An Overlay gets a Blend Mode menu next to its opacity.
  - Desktop only; the phone plays effects but doesn't edit them.
- **Effects tab:** a new Asset Panel tab, like `LookPanel.tsx`'s `FiltersPanel`: categories, search, Starred chip, cards with a star.
- **Favourites:**
  - A global store on the server (DATA_DIR, like the Imported Looks index) of starred catalogue ids, with a GET and a PUT (or add/remove) endpoint.
  - Both the Video Effect library and the Audio Effect library (`AddEffect` in `AudioEffectsFields.tsx`) show stars and a Starred filter.
  - Not part of any Candidate, not in MCP.
- **API and MCP:**
  - `GET` the video effects catalogue (or the shared catalogue filtered by kind).
  - Validation runs on every save path, so a bad stack is refused with the item, index and reason.
  - MCP:
    - `list_assets(kind="video_effects")` returns the catalogue;
    - `edit_candidate` and `merge_candidate_items` take `video_effects` on Segments, Overlays and Adjustment Layers, and `blend` on Overlays; `merge_candidate_items` replaces a stack as a whole;
    - `dry_run` shows each item's stack and Blend Mode;
    - the server instructions describe the stack, its place after the Grade, sizes at the fitted size, keys on Overlays only and the Blend Modes.

## Testing Decisions

Good tests check what is seen and what is refused, not how a filter string is spelled. Examples:
- a rendered frame's sharpness, alpha or colour at a point;
- a change between two frames;
- the Candidate after an editor action;
- what the API and MCP turn down.

- **Catalogue (pytest, real ffmpeg, short):**
  - every effect's chain at its defaults, minimums and maximums runs over a generated 1 s 1080×1920 clip without error, and keeps its size and length;
  - validation fills defaults and refuses unknown ids, unknown keys, out-of-range values, a bad colour, duplicates and a Cutout effect on a Segment or Adjustment Layer;
  - a disabled entry adds nothing.
- **Seam B, the planner (pytest):**
  - stacks reach SegmentPlans, OverlayEvents and AdjustmentEvents, enabled entries only;
  - sizes are scaled by the Overlay's scale;
  - Blend Mode reaches OverlayEvents;
  - a stored Candidate without the fields plans exactly as before;
  - the dry-run view lists them.

  Prior art: `test_overlay_grades.py`, `test_adjustment_layers.py`.
- **Seam A, the HTTP API with real ffmpeg** (short renders of a generated test pattern, as the grade tests do):
  - Gaussian blur lowers edge contrast in the frame;
  - Pixelate makes blocks of one colour of about the planned size;
  - Posterize leaves at most `levels` values per channel;
  - Film grain makes two consecutive frames of a still differ, and Bloom pulse makes frames differ over its period;
  - Chroma key makes a green Overlay transparent, so the frame beneath shows; Luma key does the same for black;
  - a scaled-up Overlay's blur is bigger in proportion;
  - a keyed (Keyframed) Overlay renders its effects like an unkeyed one at the same frame;
  - effects on an Adjustment Layer apply only over its span;
  - Screen over a dark area lightens it; Multiply darkens it; Normal is unchanged;
  - a Segment with effects among plain ones keeps its timing at a join and under a Transition;
  - a stored Candidate renders the same command as before (the existing command fixture).
- **Render cost:** a measured run per effect, reported in ADR 0014, not asserted.
- **API and MCP refusals and shapes:**
  - the refusals above, through the API and `merge_candidate_items`;
  - `list_assets(kind="video_effects")` content;
  - `merge_candidate_items` replacing a stack and setting `blend`;
  - the favourites endpoint.
- **The editor (vitest):**
  - Add effect on a mixed Pick, skipping duplicates and Cutout on Segments;
  - move, toggle and remove by index;
  - dropping a card makes an Adjustment Layer;
  - split and paste carrying stacks and Blend Mode;
  - the Revision merge of two stack edits;
  - each SVG imitation builder produces a filter for every catalogue effect (the catalogue and the frontend table stay in step).

  Prior art: `actions.test.ts`, `audioEffects.test.ts`, `grading.test.ts`.
- **Walkthrough** (`run` / ego-browser, desktop):
  - add blur to an Overlay and scale it;
  - key a green Overlay with the eyedropper;
  - drag Film grain onto the Timeline;
  - set an Overlay to Screen;
  - star an effect and filter;
  - Compare render;
  - render and compare.

Run only this feature's backend test files, never the full suite.

## Out of Scope

- **Halftone and Zoom blur** (no credible ffmpeg filter or SVG imitation), **Sharpen and Vignette as effects** (Adjust has them), and **Concat's colour effects** (the Grade has them; wheels and curves are later colour work).
- **Keyframes on effect settings.**
- **A WebGL preview.**
- **Keys on Segments and Adjustment Layers;** AI background removal is `background-removal` (#13).
- **Blend Modes for Text Layers, Shapes, Segments and Adjustment Layers.**
- **A Candidate-wide effect stack.** An Adjustment Layer over the whole Clip does that.
- **Effect presets saved by the owner, imported effects, and favourites for Looks or Transitions.**
- **Editing effects on a phone.**
- **A "slow" warning on costly effects.**

## Further Notes

- **Concat is a reference for behaviour and settings only, never for code.** Its manifests and WGSL shaders are not copied.
- **The SVG imitations have no shared fixture with the render,** unlike the Grade's fold. The render is tested by what it draws; the preview's faithfulness is checked by Compare render and the walkthrough.
- **Templates (#21) will carry stacks and Blend Modes as ordinary item fields.**
- **`background-removal` (#13) may sit in the Cutout category** and reuse the stack, if it becomes an effect rather than a field.
