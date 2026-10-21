# Canvas aspect: 9:16, 4:5, 1:1 and 16:9 per Candidate

Status: ready-for-agent
Created: 2026-10-21

## Problem Statement

Every Clip is 9:16 at 1080×1920. That suits TikTok, Reels and Shorts. But I also post the same episode's moments to Instagram's feed (4:5 or square) and to YouTube and X (16:9), and today I can't make those shapes at all. The frame is fixed everywhere: in the Layouts, the caption and hook places, the safe area, the Style Presets, the preview and the stage guides.

Concat lets each timeline have its own format (16:9, 9:16, 1:1, 4:3 or custom) and lets me change it later. Its pictures, text and export all follow the new shape.

## Solution

Each Candidate has a **Canvas Aspect**: 9:16 (the default), 4:5, 1:1 or 16:9.
- The Job chooses one for all its Candidates when it is made.
- Each Candidate can be changed on its own from the Advanced Edit, with a picker above the player.

The **Canvas** is the Candidate's frame in output pixels, its short side always 1080: 1080×1920, 1080×1350, 1080×1080 or 1920×1080. The Render Plan, the preview, the stage and the MCP tools all work in it.

When the aspect changes, the backend rescales the Candidate's own positions once, so the edit looks the same on the new shape:
- Pictures keep their place as a fraction of the frame.
- Backgrounds keep filling the frame.
- Logos, text and shapes keep their size.
The change is a new Revision, so the Clip goes stale and one undo restores it.

The Layouts adapt:
- **Track** crops at the Canvas's shape.
- **Split** stacks its two faces on 9:16 and 4:5, and puts them side by side on 1:1 and 16:9.
- **Blur** fits the Source over its blurred cover.

Captions on Auto, the hook and the Watermark stay inside the Safe Area of each aspect.

Style Presets keep their places in the 1080×1920 **Reference Space**, so one Preset serves every shape; the planner maps it onto each Canvas.

A Candidate has one aspect and one Clip. To have the same moment in two shapes, duplicate the Candidate and change the copy.

Export resolution is the Canvas's short side, so "1080p" gives 1080×1920, 1080×1350, 1080×1080 or 1920×1080.

## User Stories

1. As a podcaster, I want to choose a Canvas Aspect when I create a Job, so that every Candidate Selection makes for a YouTube episode is 16:9 from the start.
2. As a podcaster, I want a new Job to default to 9:16, so that my usual Shorts workflow doesn't change.
3. As a podcaster, I want a Candidate added by hand to take its Job's aspect, so that it matches its siblings.
4. As a podcaster, I want the Candidates and Clips I already have to stay 9:16 and look exactly as before, so that the upgrade breaks nothing.
5. As an editor, I want an aspect picker above the player in the Advanced Edit, so that I can change a Candidate's shape where I see it.
6. As an editor, I want the picker to show the four shapes as small boxes with their labels (9:16, 4:5, 1:1, 16:9), so that I recognise them at a glance.
7. As an editor, I want the stage to take the new shape at once, so that I see the edit as it will render.
8. As an editor, I want my unsaved draft saved before the aspect changes, so that no edit is lost or rescaled half-way.
9. As an editor, I want one undo to restore the old aspect and every old position, so that trying a shape is safe.
10. As an editor, I want a Text Layer placed near the top of a 9:16 frame to stay near the top of a 16:9 frame, so that the layout survives the change.
11. As an editor, I want a Logo Overlay of 300 px to stay 300 px after the change, so that my branding keeps its size.
12. As an editor, I want a Text Layer's and a Shape's size kept, so that text doesn't grow or shrink with the shape.
13. As an editor, I want a media Segment that filled the 9:16 frame to still fill the 16:9 frame, so that no black bars appear.
14. As an editor, I want a Manual Framing zoomed in to a detail to keep the same zoom relative to filling the frame, so that my reframing is kept.
15. As an editor, I want Keyframes of position and scale rescaled by the same rules, so that animations keep their path and size.
16. As an editor, I want Cue Edits that moved a caption line to move with the frame, so that hand-placed lines stay where I meant them.
17. As an editor, I want the Track Layout to follow the speaker with a crop of the new shape, so that a 1:1 or 4:5 clip still frames the face.
18. As an editor, I want Track on a 16:9 Canvas with a 16:9 Source to show the whole frame without moving, so that a wide shot stays wide.
19. As an editor, I want Split on 1:1 and 16:9 to put the two faces side by side, so that each face gets a tall panel.
20. As an editor, I want Split on 4:5 to stack the two faces like 9:16, so that the feed version looks like the Short.
21. As an editor, I want the left face to stay on the left (or the top) in Split, so that the two speakers don't swap between shapes.
22. As an editor, I want Blur on 4:5 and 1:1 to show the Source fitted over its blurred cover, so that nothing of the wide shot is cut.
23. As an editor, I want Blur on a 16:9 Canvas with a 16:9 Source to show the Source alone, so that there's no pointless blur.
24. As an editor, I want a portrait Source on a 1:1 or 16:9 Canvas to show over its blur, not over black, so that the frame stays full.
25. As an editor, I want captions on Auto to sit at the seam of a stacked Split, under Blur's band when it has room, and otherwise in the lower third, so that they never cover a face.
26. As an editor, I want captions, the hook and the Watermark's nine places kept inside the Safe Area of each aspect, so that platform buttons never cover them.
27. As an editor, I want the stage's guides to show the Safe Area of the Candidate's aspect, so that I can place things by eye.
28. As an editor, I want smart guides at the Canvas's centre and edges, so that snapping works on every shape.
29. As an editor, I want a dragged caption or hook on a 16:9 stage to save its place correctly in the Style, so that it shows where I dropped it.
30. As an owner of Style Presets, I want one Preset to work on every aspect, so that I don't keep four copies of my brand.
31. As an owner of Style Presets, I want my existing Presets left as they are, so that my 9:16 Clips don't change.
32. As an owner of Style Presets, I want captions and the hook to keep their font sizes on every aspect, so that text stays legible.
33. As an owner of Style Presets, I want captions and the hook on a 16:9 Canvas no wider than they are on 9:16, so that lines stay short and readable.
34. As a podcaster, I want to duplicate a Candidate and change the copy's aspect, so that I have the same moment as a Short and as a feed post.
35. As a podcaster, I want the duplicate to keep everything else (Segments, layers, Style), so that I only fix what the new shape needs.
36. As a podcaster, I want the clip editor's preview in Review to have the Candidate's shape, so that I review it as it will look.
37. As a podcaster, I want Clip cards and their posters in the Candidate's shape, so that the Clips page shows what I'll post.
38. As a podcaster, I want a Clip rendered before an aspect change shown as stale, so that I know to render again.
39. As a podcaster, I want the 1080p Preset to give 1920×1080 for a 16:9 Candidate, so that my Export Presets mean the same thing on every shape.
40. As a podcaster, I want 720p, 1440p and 4K to follow the same short-side rule, so that 4K 16:9 is 3840×2160.
41. As a podcaster, I want text in a 16:9 4K Clip as sharp as in a 9:16 4K Clip, so that the shape doesn't cost quality.
42. As a podcaster, I want the size estimate to be right for every shape, so that I can trust it.
43. As a podcaster, I want a saved frame (PNG) to have the Candidate's shape, so that a thumbnail matches the Clip.
44. As a podcaster, I want the saved audio unchanged by the aspect, so that sound exports stay as they are.
45. As an MCP agent, I want `create_job_from_url` and `create_job_from_file` to take an aspect in the Job's options, so that I can make a 16:9 Job.
46. As an MCP agent, I want `edit_candidate` to take `aspect` and rescale the Candidate in the backend, so that I don't have to compute positions myself.
47. As an MCP agent, I want positions sent in the same edit as `aspect` taken as already on the new Canvas, so that I can change the shape and place things in one call.
48. As an MCP agent, I want `dry_run` to give a Preview Plan with the Canvas's width, height and Safe Area, so that I can check a change before saving.
49. As an MCP agent, I want `get_candidate` to show the aspect and the Canvas's size, so that I know which pixels I'm in.
50. As an MCP agent, I want the tools' documentation to say that Candidate positions are in the Canvas's pixels and Style positions are in the Reference Space, so that I place things in the right space.
51. As an MCP agent, I want a position outside the Canvas refused with a clear 422, so that I learn the frame's real size.
52. As an MCP agent, I want an aspect outside the four refused with a 422, so that I don't make an unsupported shape.
53. As an MCP agent, I want `merge_candidate_items` to place new items in the Canvas's pixels, so that items I add land where I mean.
54. As an editor, I want a new Overlay, Text Layer or Shape to start at a sensible place on the Canvas (the same fraction as on 9:16), so that adding things works on every shape.
55. As an editor on a phone, I want the stage and the bottom sheets to handle a 16:9 player, so that the Advanced Edit stays usable.
56. As an editor, I want the Revision History to list an aspect change as its own step, so that I can find it and restore it.
57. As an editor, I want another tab that holds the Candidate to see the new aspect through live sync, so that I don't overwrite it from an older shape.

## Implementation Decisions

**Model**
- **Canvas Aspect on the Candidate:** a new field, `aspect`, one of `9:16`, `4:5`, `1:1` or `16:9`.
  - It is saved with each Revision, under the Revision part that holds the Layout.
  - A Candidate saved before this field defaults to `9:16`, so there is no migration step.
  - Duplicate copies it.
- **The Job's default:** `JobOptions` gains `aspect`, defaulting to `9:16`.
  - Selection's Candidates and Candidates added by hand take it.
  - The MCP job-creation tools already take `JobOptions`, so they get it for free.
- **One Canvas module (backend):** a small, deep module that maps an aspect to:
  - its Canvas size (short side 1080, the long side rounded to an even number);
  - its Safe Area box;
  - the mapping from the Reference Space to that Canvas.

  Everything that used the fixed 1080×1920 frame asks it. The Safe Areas:
  - 9:16 keeps today's box: x 0 to 950, y 232 to 1536.
  - 4:5, 1:1 and 16:9 keep about 5% clear at each edge.

**Two coordinate spaces**
- **Candidate-owned values are in the Canvas's pixels:**
  - Transforms (of Segments, Framings, Overlays, Text Layers, Shapes and Layout Overrides);
  - their Keyframes;
  - Cue Edits.
- **Style values are in the Reference Space** (1080×1920): the Caption, Hook and Watermark Styles' `x`, `y` and Custom places, in Style Presets and in Style Overrides.
  - The planner maps them onto the Canvas in proportion: x·W/1080 and y·H/1920.
  - The anchor enums (Top, Middle, Bottom, the nine Watermark places) are resolved against the Canvas's Safe Area directly.
  - Sizes are not mapped: font sizes, the Watermark's size, outlines and padding stay in pixels. The short side is the same on every Canvas.
- **Caption and hook widths:** these come from the Canvas's Safe Area, capped at their 9:16 widths, so a 16:9 caption is not twice as long.
- **Validators:**
  - Style validators keep their Reference Space limits.
  - Candidate-owned positions and the Keyframe ranges are checked against the Candidate's Canvas, so validation needs the aspect.
  - An unknown aspect is a 422.

**Rescale on an aspect change**
- One pure function takes a Candidate's draft, the old aspect and the new one, plus the pictures' sizes that fitting needs, and returns the rescaled draft.
  - **Centres** (x, y) map as fractions of the Canvas, for every Candidate-owned Transform, position Keyframe and Cue Edit.
  - **Framings** (media Segments, the Source in Manual, Layout Overrides) keep their scale relative to the cover scale. A Framing at the cover scale stays at the cover scale, and one zoomed to 1.5× cover stays at 1.5× cover.
  - **Overlays, Text Layers and Shapes** keep their drawn size in pixels: the new scale is the old scale × the old fitted size ÷ the new fitted size.
  - **Scale Keyframes** follow their item's rule.
  - **Clamping:** every result is clamped to the new Canvas.
- It runs in the backend when an edit changes `aspect`. Positions sent in the same edit are taken as already on the new Canvas and are not rescaled. The browser and MCP share it.

**Planner**
- The Render Plan carries the Canvas's width and height (already fields) and its Safe Area box.
- The Preview Plan carries them too, so the frontend never keeps its own per-aspect constants (ADR 0001).
- **Track:** crops the full Source height (or width, whichever binds) at the Canvas's aspect, and follows faces with the Smooth Camera as today.
- **Split:**
  - On 9:16 and 4:5, two stacked panels of the full width and half the height: 1080×960 and 1080×675.
  - On 1:1 and 16:9, two side-by-side panels of half the width and the full height: 540×1080 and 960×1080.
  - Each crop has its panel's aspect. The left face goes in the top or left panel. The face's rise above the panel centre applies only to stacked panels.
- **Blur:** the blurred background covers the Canvas, and the Source is fitted, centred.
- **Portrait Sources:** today these are passed through over black. On a Canvas wider than the Source they use Blur. On 9:16 nothing changes.
- **Captions on Auto:**
  - at the seam of a stacked Split;
  - under Blur's band when the space between the band and the Safe Area's bottom fits the caption box;
  - otherwise in the lower third of the Safe Area.
  - Top and Bottom resolve against the Safe Area.
- **The hook and the Watermark:** places resolve against the Canvas's Safe Area, and custom places are mapped from the Reference Space.
- **Defaults for new items** keep their 9:16 fractions: centre at the Canvas's centre, and the default Text Layer y at the same fraction.

**Renderer and export (revises ADR 0021)**
- `output_size` gives the Canvas's aspect at the chosen short side, rounded to even.
- The scaled plan multiplies by short side ÷ 1080, which is identical to today's height ÷ 1920 on 9:16.
- The ASS script's PlayRes is the Canvas size.
- The bitrate's pixel factor already counts pixels, so it needs no change beyond using the real output size.
- The saved frame takes the Canvas's shape at the default Preset's resolution.

**Frontend**
- The global 1080×1920 frame constant goes. The Canvas comes from the Preview Plan, or from the Candidate's aspect where no plan is loaded yet.
  - This covers picture fitting and cover/fill scales, keyframe ranges, cue placement, transform fields, shapes, text layers, adjustments and effects regions, the stage clamps, and the preview's fitted-size hook.
- `StageEdit` guides come from the plan's Safe Area and the Canvas's centre and edges.
- Dragging a caption or the hook converts the stage's Canvas pixels into the Reference Space before writing the Style Override.
- **The aspect picker:** a small segmented control above the Advanced Edit's player, with a shape icon per aspect.
  - Choosing one saves the pending draft (if any), sends the aspect edit, and loads the returned Revision.
  - Undo, through the Revision History, restores the earlier Revision.
- The clip editor's preview in Review, the Clip cards, the posters and the Candidate cards' thumbnails take the Candidate's shape instead of a fixed 9:16 box.
- The phone layout keeps its structure; the player shrinks to fit a wide Canvas.

**API and MCP**
- `edit_candidate` and the Candidate PATCH accept `aspect`.
- `get_candidate` shows `aspect` and the Canvas size.
- `dry_run`'s Preview Plan shows the Canvas size and Safe Area.
- The documentation text in the MCP tools that says "0..1080, 0..1920" and "1080x1920 frame" is rewritten in terms of the Canvas and the Reference Space.

**Docs**
- ADR 0022 records these decisions.
- GLOSSARY has Canvas Aspect, Canvas, Reference Space and Safe Area.

## Testing Decisions

Good tests here check what comes out: plan geometry (panel boxes, crops, caption and hook boxes, mapped places), rescaled values, rendered file sizes and sampled pixels, and what the API and MCP accept and refuse. They don't check how ffmpeg arguments are spelled or which helper is called.

- **Seam B: pure functions** (the main seam; prior art: `test_planner.py`, `test_manual_layout.py`, `test_keyframes.py`):
  - **Canvas module:**
    - the four sizes;
    - the Safe Areas (9:16 identical to today's);
    - Reference Space mapping of a Custom caption y and a Watermark x.
  - **Layouts per aspect:**
    - Track's crop aspect on 1:1 and 4:5;
    - Track on 16:9 with a 16:9 Source covering the whole Source without movement;
    - Split's two panel boxes on all four aspects, left face in the top or left panel;
    - Blur's fitted band on 1:1 and its absence on 16:9 with a 16:9 Source;
    - a portrait Source on 16:9 going to Blur.
  - **Captions on Auto:**
    - at the seam of a stacked Split;
    - in the lower third with a side-by-side Split;
    - under Blur's band on 4:5;
    - inside the Safe Area everywhere.
  - **Widths:** the caption and hook widths are capped on 16:9.
  - **Rescale:**
    - a centre at (270, 480) on 9:16 lands at (480, 270) on 16:9;
    - a filled media Segment stays at the cover scale;
    - a Framing at 1.5× cover stays at 1.5× cover;
    - an Overlay's drawn size in pixels is unchanged;
    - position and scale Keyframes follow;
    - Cue Edits move;
    - values are clamped to the Canvas;
    - positions sent in the same edit are left as sent;
    - 9:16 to 16:9 and back is within rounding for interior items.
  - **9:16 regression:** a 9:16 Candidate's Render Plan is identical to today's.
- **Seam A: HTTP and real ffmpeg** (prior art: `test_render_sizes.py`, `test_render.py`, `test_save_frame.py`):
  - **Sizes:** a 1:1 Candidate rendered at 1080p is 1080×1080, a 16:9 one is 1920×1080, and a 16:9 one at 720p is 1280×720.
  - **Pixels:** on 16:9, a Text Layer and a caption land at their mapped positions (sampled pixels), and the caption is inside the Safe Area.
  - **Saved frame:** a 4:5 Candidate's saved frame is 1080×1350.
- **Model, API and MCP** (prior art: `test_mcp.py`, `test_revisions.py`, `test_jobs_api.py`):
  - **The aspect field:**
    - an unknown aspect is a 422;
    - a Candidate without the field reads as 9:16;
    - `JobOptions.aspect` reaches Selection's Candidates and a hand-added one;
    - Duplicate keeps it.
  - **Editing:**
    - changing `aspect` makes a new Revision and the Clip stale;
    - a Transform outside the Canvas is a 422 (x 1500 is fine on 16:9 and refused on 9:16);
    - `edit_candidate` with `aspect` rescales;
    - `dry_run` shows the Canvas and Safe Area.
- **Editor (vitest; prior art: the Advanced Edit action tests and the picture helpers' tests):**
  - fitting and cover scales from a given Canvas;
  - the caption-drag conversion to the Reference Space;
  - stage guides from a plan's Safe Area;
  - the picker saving the draft before sending the aspect.
- Run only the feature's backend test files, never the whole suite.

## Out of Scope

- **4:3, 21:9 and custom sizes.** The four aspects only.
- **Variants:** several aspects or several Clips in one Candidate, or several aspects chosen at render time. Duplicate the Candidate instead (ADR 0021's one Clip per Candidate stays).
- **Per-platform Safe Areas** or a platform picker for the guides. There is one Safe Area per aspect.
- **Style positions per aspect** inside a Style Preset. One Preset serves every aspect, mapped in proportion; duplicate a Preset to tune it for a shape.
- **A new Layout** (such as "Full"). Track, Split, Blur and Manual generalise.
- **Smarter rescaling,** such as anchoring to the nearest edge or reframing with AI. The rescale is proportional and runs once.
- **An aspect in Export Presets.** Export only scales.
- **The Channel Profile holding a default aspect.** The default comes from `JobOptions`.
- **Changing the aspect from Review's cards or for many Candidates at once.** Only from the Advanced Edit's picker and the MCP tools.
- **Aspect badges on cards.** The card's shape shows the aspect.

## Further Notes

- **Out of Scope items overturned** (recorded in ADR 0022):
  - "The canvas aspect, which stays 9:16 at 1080×1920" in `.scratch/transform-crop/spec.md`.
  - "Canvas aspect ratios other than 9:16" in `.scratch/export-settings/spec.md`.
  - ADR 0022 also revises ADR 0021's scale factor (height ÷ 1920 becomes short side ÷ 1080; the same on 9:16).
  - This overturns no Out of Scope item of the Advanced Edit spec.
- **Concat** was used for behaviour only. It shares:
  - the short-side rule for sizes and export;
  - an undoable aspect change after creation;
  - pictures that follow the frame.

  It differs:
  - Concat stores positions as fractions and text sizes as fractions of the height. Here they are pixels of a Canvas with a 1080 short side, rescaled once.
  - Concat contain-fits every picture. Here Framings keep their cover.
  - Concat has no safe areas.
- **Hard-coded frame size:** about 110 places assume 1080×1920 today, about 75 of them in the planner. A forgotten one shows only on another aspect, which is why Seam B and Seam A both run on 1:1 and 16:9, and why a 9:16 plan must stay identical.
- **The caps on caption and hook widths** on 16:9 were not grilled explicitly. They follow from keeping font sizes in pixels with a 1080 short side.
- **Templates** (roadmap #21) will meet Candidates of several aspects. The rescale function is the natural way to apply a Template made on another aspect.
