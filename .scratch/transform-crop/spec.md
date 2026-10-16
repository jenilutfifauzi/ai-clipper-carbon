# Transform and crop for Overlays, Segments and a Manual Layout

Status: ready-for-agent
Created: 2026-10-16

## Problem Statement

Pictures in the Advanced Edit can barely be placed.

- **An Overlay can only move and grow.** It has a centre, a width and an opacity. It can't be rotated, flipped, stretched or cropped, and it is clamped inside the frame, so it can't bleed off an edge. It has no rounded corners, border or shadow, the usual look of a picture-in-picture on Shorts and Reels.
- **A media Segment has two choices.** It is filled (a centred 9:16 crop) or fitted over its blur. It can't be zoomed into a detail, moved off centre, rotated (a phone video recorded sideways), or set on a plain colour.
- **The Source can't be framed by hand.** Track, Split and Blur are chosen per Scene, and Track follows faces. When the tracker frames the wrong person, cuts off a product held to the camera, or wobbles, the only remedy is another Layout. "Manual crop positioning" has been Out of Scope since v1.
- **Grips are partial.** The stage moves the hook, the captions and Text Layers with four corner grips and snaps them to fixed guides. Overlays have their own single corner grip and no snapping. Nothing rotates.
- **Concat has all of this:**
  - `SetClipTransform`: scale 0.05–8, position, rotation, stretch, flips and opacity;
  - a per-edge `Crop`;
  - grips for corner scale, edge stretch and rotation;
  - smart guides to other pictures' edges.

## Solution

Every picture is placed by one **Transform** and one **Crop** (GLOSSARY.md; docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md).
- **Overlays** get a Transform, a Crop, corners, a border and a shadow.
- **Media Segments** get a **Framing** (a Transform, a Crop and a **Background**), which replaces `fit`.
- **A new Layout, Manual,** frames the Source with a Framing, for one Scene (a Layout Override) or for the whole Candidate.

**The Transform.**

| Field | Range | Meaning |
|---|---|---|
| `x`, `y` | 0..1080, 0..1920 | The centre, in output pixels. It stays on the frame; the picture may go past its edges. |
| `scale` | 0.05–8 | Times the fitted size: the largest that fits 1080×1920 keeping the (cropped) picture's aspect. 1 fits. |
| `stretch_x`, `stretch_y` | 0.1–10 | Times the fitted width and height, on top of `scale`. 1 keeps the aspect. |
| `rotation` | −360..360 | Degrees clockwise about the centre. |
| `flip_h`, `flip_v` | | Mirrored left to right, top to bottom. |
| `opacity` | 0..1 | |

**The Crop:** `left`, `top`, `right`, `bottom`, each a fraction 0..0.9 of the picture's width or height. A pair that would leave less than a tenth is pulled back. The crop is taken first, and the cropped picture is what is fitted.

**The Background** (media Segments and Manual Scenes): `blur` (the picture itself, covering the frame, blurred and darkened as Blur Layout's is) or a colour. It shows wherever the picture doesn't cover the frame, and behind it where its opacity is below 1.

**Overlay decoration:**
- `radius`: 0..0.5 of the drawn picture's shorter side (0.5 is a pill or a circle). It scales with the picture.
- `border`: off, or a width (1..40 output pixels) and a colour.
- `shadow`: off, or a blur (0..100 px), an offset x and y (−100..100 px), a colour and an opacity.
- The border and shadow keep their pixel sizes when the picture scales.

**The Manual Layout.**
- It appears beside Auto, Track, Split and Blur, for the Candidate and for a Scene.
- **For a Scene,** a Layout Override with Manual carries its own Framing.
- **For the Candidate,** Manual carries one Framing for every Scene without an override.
- **A Manual Scene is still.** Its picture is where its Framing says for the whole Scene. Face tracking is not run there, and a re-run of the analysis does not move it. Auto never chooses Manual.
- **It starts from what the Scene showed.** Every Scene of the Render Plan carries the Framing of its first frame: a Track Scene's first crop, or Blur's fitted picture over its blurred Background. A Scene with Split shows two pictures, so it offers the Framing of a centred cover instead. Switching a Scene to Manual copies that Framing into the override, so nothing jumps.
- **It shows one picture.** Split stays automatic, with no framing by hand per panel.

**Drawing a picture,** the same in the renderer and the preview:
1. crop;
2. scale to the fitted size × `scale` × `stretch`;
3. flip;
4. corners and border;
5. rotate, with a transparent fill;
6. shadow;
7. opacity;
8. lay it over at its centre.

A media Segment or Manual Scene first draws its Background, then its picture.

**The stage (Advanced Edit).**
- **Picking.** Clicking an Overlay picks it. Clicking the picture behind every Overlay picks the Segment under the playhead: a media Segment, or a Source Segment.
  - On a Source Segment in a Manual Scene, the Grips edit that Scene's Framing.
  - On a Source Segment in an automatic Scene, nothing is drawn but its outline. The inspector offers "Reframe by hand", which makes the Scene Manual.
  - Items on locked Tracks can't be picked on the stage.
- **The Grips:**
  - dragging the body moves it;
  - a corner scales it about its centre, keeping its stretch;
  - an edge stretches it on one axis, about its centre;
  - a handle above the top edge rotates it.
  - The Grips sit on the rotated picture.
  - Rotation snaps to 0, 90, 180 and 270 within 3°, and Shift turns in steps of 15°.
- **Smart Guides.**
  - While moving or scaling, the picture's edges and centre (its box after rotation) snap within 6 CSS pixels to:
    - the frame's edges and centre;
    - today's fixed guides;
    - the edges and centres of the other pictures shown at the playhead: Overlays, and the Segment's picture.
  - Text is not a target.
  - A line marks each snap. Alt turns snapping off.
- **Crop mode.**
  - It is opened by double-clicking a picture, or with Crop in the inspector.
  - The whole picture shows dimmed in place, with the kept part bright.
  - Handles on the four edges and four corners move the Crop.
  - Enter or a click outside keeps it, and Escape drops it.
  - The kept part stays where it was on the stage: the same step adjusts the Transform's scale and centre.
- **One drag is one step of undo.** While a Grip is held, the picture is drawn from the drag, until the next plan arrives (ADR 0001).
- **Keys.** Arrow keys still move a Tab-focused item. The stage adds nothing new to the keymap.

**The inspector.** A Transform section shows for a picked Overlay, media Segment or Manual Scene:
- X, Y, Scale %, Width % and Height % (stretch), Rotation °;
- Flip ↔ and Flip ↕, and Opacity;
- the Crop's four edges and a Crop button;
- Fit (scale 1, no stretch, centred), Fill (the scale that covers the frame) and Reset (everything to its default).

Media Segments and Manual Scenes add their Background (Blur or a colour). Overlays add Corners, Border and Shadow.
- **A Manual Scene whose Framing is the Candidate's** shows "All Scenes" and an "Only this Scene" button. The button makes an override with a copy.
- **An override's Framing** shows "This Scene" and "Use for all Scenes", which sets the Candidate's Layout to Manual with this Framing.

**The clip editor.**
- Manual joins the Layout choices for the Candidate and per Scene.
- On its preview, a Manual Scene's picture can be dragged to pan and scaled from its corners.
- Rotation, flips, stretch, crop and the Background are only in the Advanced Edit.

**On a phone (Advanced Edit).**
- One finger moves a picked picture, a pinch scales it, and a two-finger twist rotates it, with the same snaps.
- The Grips are larger.
- A Transform sheet holds the inspector's fields, and Crop mode opens from it.

**MCP.**
- Every new field is reachable through `edit_candidate` and `merge_candidate_items`.
- `merge_candidate_items` merges a Transform, Crop, Framing, border or shadow field by field. For example, `{"id": "o1", "transform": {"rotation": 90}}` keeps the rest.
- The dry run lists each Overlay's and each Scene's resolved picture: its box, rotation, crop and Layout.
- The server instructions explain the units.

**Old Candidates.** They migrate when a Job is read:
- An Overlay's `size` becomes `scale` (size over the fitted width of its media item), and its `x`, `y` and `opacity` move into its Transform.
- A filled media Segment gets the scale that covers the frame, and a fitted one scale 1. Both get a blurred Background.
- Both render as before.

## User Stories

**Placing an Overlay**

1. As an owner, I want to scale an Overlay from 5% to 800% of its fitted size, so that it can be a small badge or fill the screen.
2. As an owner, I want to drag an Overlay partly off the frame, so that a picture can bleed off an edge as in a designed post.
3. As an owner, I want the Overlay's centre to stay on the frame, so that I can never lose it off the edge.
4. As an owner, I want to stretch an Overlay wider or taller from its edge Grips, so that I can fit it to a gap even if it distorts.
5. As an owner, I want to rotate an Overlay with a handle above it, so that a sticker-like picture can sit at an angle.
6. As an owner, I want rotation to snap to 0°, 90°, 180° and 270°, so that I can get it straight again easily.
7. As an owner, I want Shift to turn in 15° steps, so that I can reach common angles exactly.
8. As an owner, I want to flip an Overlay horizontally or vertically, so that a face in it looks into the frame.
9. As an owner, I want to set an Overlay's opacity in the same section, so that every way of placing it is in one place.
10. As an owner, I want numbers for X, Y, scale, stretch and rotation in the inspector, so that I can set exact values.
11. As an owner, I want Fit, Fill and Reset buttons, so that I can get back to a known state in one click.

**Cropping**

12. As an owner, I want to crop each edge of an Overlay or media Segment, so that I can show only the part that matters.
13. As an owner, I want a crop mode on the stage that shows the whole picture dimmed, so that I can see what I'm cutting away.
14. As an owner, I want the kept part to stay where it was when I finish cropping, so that cropping doesn't move my layout.
15. As an owner, I want Escape to drop the crop I was making, so that a slip costs nothing.
16. As an owner, I want at least a tenth of the picture always kept, so that I can't crop it to nothing.
17. As an owner, I want the crop to turn with the picture when it is rotated, so that what I cropped stays cropped.

**Decorating an Overlay**

18. As an owner, I want rounded corners on an Overlay, up to a circle, so that a picture-in-picture looks like Shorts and Reels.
19. As an owner, I want a border of a width and colour, so that the Overlay stands off the video.
20. As an owner, I want a drop shadow with blur, offset and colour, so that the Overlay looks lifted.
21. As an owner, I want corners to keep their shape and the border and shadow their size when I scale the Overlay, so that resizing doesn't spoil the look.

**Media Segments**

22. As an owner, I want to zoom into part of an uploaded video on the Main Track, so that I can show a detail full screen.
23. As an owner, I want to rotate a sideways phone video by 90°, so that it plays upright.
24. As an owner, I want to scale a media Segment down over a blurred copy of itself or over a colour, so that it can sit as a framed picture.
25. As an owner, I want my existing Filled and Fitted Segments to look as they did, so that nothing changes until I touch them.

**Framing the Source by hand**

26. As an owner, I want a Manual Layout for one Scene, so that I can frame a shot the tracker gets wrong.
27. As an owner, I want Manual to start from what the Scene showed, so that switching to it doesn't jump.
28. As an owner, I want to pan and zoom the Source in a Manual Scene on the stage, so that I frame it by eye.
29. As an owner, I want a Manual Scene to stay still, so that it doesn't wobble with face tracking.
30. As an owner, I want my Manual framing kept when the analysis runs again, so that my work isn't lost.
31. As an owner, I want Manual for the whole Candidate, so that a one-camera Source is framed once.
32. As an owner, I want "Only this Scene" and "Use for all Scenes", so that I can move between the two.
33. As an owner, I want a Manual Scene's picture scaled down over a blurred or coloured Background, so that I can show the whole wide shot.
34. As an owner, I want to rotate or flip the Source in a Manual Scene, so that a mirrored or tilted recording can be fixed.
35. As an owner, I want a part of the Source shown twice to be framed alike, so that a repeat matches.
36. As an owner, I want "Reframe by hand" when I pick an automatic Scene's picture, so that I find Manual where I'm looking.
37. As an owner, I want Manual and pan/zoom in the clip editor too, so that I don't open the Advanced Edit for a simple reframe.

**Grips and Smart Guides**

38. As an owner, I want to pick the picture behind the Overlays by clicking it, so that I can transform a Segment on the stage.
39. As an owner, I want corner Grips that scale about the centre, so that the picture stays where I put it.
40. As an owner, I want Grips that follow the picture's rotation, so that they sit on its real corners.
41. As an owner, I want a picture to snap to the frame's edges and centre, so that I can align it without measuring.
42. As an owner, I want a picture to snap to other pictures' edges and centres, so that Overlays line up with each other and with the video.
43. As an owner, I want Alt to turn snapping off, so that I can place a picture freely.
44. As an owner, I want a line to show where a picture snapped, so that I know why it stopped.
45. As an owner, I want each drag to be one step of undo, so that undo takes back what I did, not each pixel.
46. As an owner, I want Overlays to be picked and moved as the hook and Text Layers are, so that the stage behaves the same everywhere.
47. As an owner, I want locked Tracks' pictures not to be picked on the stage, so that the lock holds.

**Phone**

48. As an owner on a phone, I want to pinch to scale and twist to rotate, so that I can transform with my fingers.
49. As an owner on a phone, I want larger Grips, so that I can hit them.
50. As an owner on a phone, I want a Transform sheet with the same fields and crop, so that I can be exact.

**Rendering and the preview**

51. As an owner, I want the Clip to render exactly the transform I see, so that the preview can be trusted.
52. As an owner, I want the preview to show a transform as soon as the plan comes back, and while I drag, so that editing feels direct.
53. As an owner, I want Transitions to work between transformed Segments, so that nothing else breaks.

**The agent**

54. As an agent, I want Transform, Crop, Framing and decoration fields on Overlays, Segments, Layout Overrides and the Candidate, so that I can do anything the owner can.
55. As an agent, I want to change one field of a Transform without resending the others, so that I don't overwrite the owner's values.
56. As an agent, I want the dry run to show each picture's resolved box, rotation and crop, so that I can check my edit before saving.
57. As an agent, I want old-shape Overlay fields refused with a clear error, so that I learn the new shape.

## Implementation Decisions

**Model (`candidates.py`).**
- New frozen dataclasses: `Transform`, `Crop`, `Background`, `Framing`, `Border` and `Shadow`.
  - `Background` is a kind (`blur` or `colour`) plus a colour as `#rrggbb`.
  - `Framing` is a `transform`, a `crop` and a `background`.
  - The defaults are identity values: centre (540, 960), scale 1, no stretch, rotation 0, no flips, opacity 1, no crop, a blurred Background.
- **Overlay** loses `x`, `y`, `size` and `opacity`. It gains:
  - `transform`, `crop`, `radius`, `border: Border | None` and `shadow: Shadow | None`.
  - Its default `transform` places a new Overlay as today: its width is 540 px at the centre. The frontend's "add Overlay" computes that scale from the item's size.
- **Segment** loses `fit` and gains `framing: Framing | None`. It is required on a media Segment and refused on a Source Segment.
- **Layout** gains `MANUAL`.
  - `LayoutOverride` gains `framing: Framing | None`, required when its Layout is Manual and refused otherwise.
  - `Candidate` gains `framing: Framing | None` with the same rule against `Candidate.layout`.
- **Validation** (pydantic ranges, plus `review.py`):
  - the Crop is tidied as Concat's is (each edge 0..0.9, a tenth kept);
  - a non-finite value is refused;
  - the centre is clamped to the frame.

**Migration (reading a Job).**
- When a Job is read and a Candidate holds the old Overlay or Segment shape, it is converted using the Media Library's item sizes (see Solution). It is written back on the next save as a Revision like any other.
- The converter is pure: given an old Candidate dict and the item sizes, it returns the new one. A missing item, which can't happen as items in use can't be deleted, falls back to 16:9.

**Planner (`planner.py`, ADR 0001).**
- **A new `Picture` geometry**, resolved once:
  - `crop` (x, y, w, h in the item's pixels);
  - `width` and `height` (the drawn size, even pixels, after scale and stretch);
  - `centre`, `rotation`, `flip_h`, `flip_v`, `opacity`;
  - `radius` in pixels, `border` and `shadow`;
  - `bounds`: the box after rotation, for the Smart Guides and the dry run.
- **`OverlayEvent`** holds a `Picture` instead of `area`. The old clamp inside the frame goes.
- **A media Segment's Scene and a Manual Scene** plan a Background panel, which is today's blurred cover panel or a colour, plus a `Picture`. `SceneLayout` gains `MANUAL`.
- **Overrides.** `_framed` and `_choose` honour Manual like any forced Layout. A Manual Scene skips `_follow` and needs no face analysis.
- **Every `ScenePlan` gets `framing`:** the Framing that reproduces its first frame (Track: the first crop point as a Transform; Blur: scale 1 over blur; Split: a centred cover; Manual and media: their own). The editor copies it when switching to Manual.
- **A pure module computes all of this** from a Transform, a Crop, the item's size and the frame (fit, cover, crop pixels, rotated bounds). It is shared by the Overlay, media Segment and Manual paths, and by the migration (fitted width).

**Renderer (`renderer.py`).**
- **One `_picture` chain** draws a `Picture`:
  1. `crop`;
  2. `scale` to `width`×`height` with lanczos;
  3. `hflip`/`vflip`;
  4. `format=rgba`;
  5. corners and border with an alpha mask. The mask is a `geq` expression on the alpha, or a mask frame made per size and `alphamerge`d. The ticket chooses which, by speed on a 3-minute render.
  6. `rotate=a:ow=rotw(a):oh=roth(a):c=none`;
  7. shadow: a `split` of the alpha, coloured, `gblur`, offset, and laid under the picture;
  8. `colorchannelmixer=aa`;
  9. `overlay` at the centre minus half the rotated box.
- **Steps are left out when they are identity.** A plain picture is crop, then scale, then overlay, close to today's graph.
- **Media Segments and Manual Scenes** draw their Background as today's blurred cover panel, or as a `color` source, then `_picture` over it.
- Overlays use `_picture` in place of today's scale and overlay.
- `enable=between(t,…)` and `eof_action` are as today.

**Preview (frontend, ADR 0001).**
- **`PicturePanel`** draws a `Picture`:
  - an absolutely placed wrapper at `centre` with `width`×`height` (as % of 1080×1920);
  - CSS `transform: translate(-50%,-50%) rotate() scale(±1,±1)`;
  - `opacity`, `border-radius` and `border` on the wrapper, and `filter: drop-shadow()` on an outer wrapper so the shadow falls in screen space;
  - inside, the video or image positioned and sized to show only `crop`, as `PanelView` does today.
- **Media Segments** move from `object-cover`/`contain` to the plan's Background panel and `PicturePanel`. Overlays use `PicturePanel`.
- **A pure function** maps a `Picture` to its CSS boxes, so it can be tested without a browser.

**The stage (`StageEdit.tsx`).**
- `StageId` gains `overlay:<id>` and `picture` (the Segment under the playhead). Overlays leave their own pointer handlers in `PreviewOverlays.tsx`.
- **A new pure module of picture gestures.** It takes the picture's Transform at grab, its fitted size, the grip, and the pointer in frame pixels, and returns the new Transform:
  - move;
  - corner scale, the ratio of distances from the centre;
  - edge stretch, the pointer projected on the picture's own axis;
  - rotate, the pointer's angle from the centre minus the angle at grab, with snaps;
  - the pinch and twist of two pointers.
- **The Smart Guide targets** are a pure function of the plan at the playhead (the other pictures' `bounds`, the frame, `GUIDES_X/Y`). The snap returns the adjusted Transform and the lines to draw.
- **Crop mode** is a stage state of the Advanced Edit only. Its handles set the Crop. On commit, the module returns the Crop and the Transform that keeps the kept part in place.
- **Each gesture commits once,** on pointer up, through the editor's usual edit path. The undo history and the 250 ms draft plan are as today.
- **Picking `picture`** resolves to the Segment under the playhead, and for a Source Segment to the Scene's Framing source: its override if it has one, otherwise the Candidate's.

**Clip editor.**
- Its Layout pickers (the Candidate's, and per Scene on the Timeline) gain Manual. Choosing it copies the plan's `ScenePlan.framing`.
- On the preview, a Manual Scene's picture gets move and corner scale through the same module, without rotation or edge Grips.

**Advanced Edit inspector and phone.**
- A Transform section and its sheet are shared by Overlays, media Segments and Manual Scenes. The Overlay adds Corners, Border and Shadow, and the Segment or Scene adds its Background.
- "Reframe by hand" sits on a Source Segment's inspector, for the Scene under the playhead.
- Number fields commit like today's fields (one undo per change).

**Merging and the Clipboard.**
- The client merge (`merge.ts`) treats `framing` and `layout_overrides` as it does other items, keyed by id or `at`. Where both sides changed the same item, the owner wins.
- Copied Segments carry their Framing, and the Layout Overrides brought along with Source Segments carry theirs.

**MCP (`mcp_server.py`).**
- `_patch_model` is extended so that a nested dataclass field (`transform`, `crop`, `framing`, `border`, `shadow`, `background`) is itself an all-optional patch merged into the current value.
- `_plan_view` adds `overlays` (id, media, bounds, rotation, crop, opacity) and per-Scene `layout` and `framing`.
- The server instructions get a short paragraph on Transform units: the centre in output pixels, scale over the fitted size, the crop in fractions.

## Testing Decisions

Good tests here check what is seen: geometry in pixels, the pixels of a rendered frame, and the Transform after a gesture. They do not check how the filter string is spelled.

**Seam B: the pure planner (existing, extended).** Prior art: `test_planner.py`, `test_overlays.py`, `test_media_segments.py`.
- **The fitted size and scale:**
  - a 1920×1080 image at scale 1 is drawn 1080×608;
  - at scale 0.5 it is 540×304;
  - the cover scale of a 16:9 Source is 1920/607.5.
- **Stretch.** `stretch_x` 2 doubles the width only.
- **Crop:**
  - left 0.25 on a 1000×1000 image crops x 250, w 750, and that 750×1000 is what is fitted;
  - left 0.6 with right 0.6 is tidied to keep a tenth.
- **Rotation bounds.** A 100×200 picture at 90° has 200×100 bounds about the same centre.
- **The centre is clamped to the frame;** the picture is not.
- **Manual:**
  - an override with Manual plans that Scene as a Background panel plus its `Picture`, and needs no faces;
  - a Candidate Layout of Manual applies to Scenes without an override;
  - the Scene's `framing` equals the override's.
- **`ScenePlan.framing`:**
  - for a Track Scene it reproduces the first crop point. Drawing the Framing gives the same Source box within a pixel.
  - for Blur, scale 1;
  - for Split, a centred cover.
- **Migration:**
  - an old Overlay with `size` 540 on a 1920×1080 image becomes scale 0.5 at the same centre;
  - a filled Segment becomes cover, and a fitted one scale 1.
  - Both plan the same boxes as before within a pixel.

**Seam A: HTTP and real ffmpeg (existing, extended).** Prior art: `test_render.py`, `test_overlays.py`, `test_mcp.py`, `test_revisions.py`.
- **Pixel checks.** Render one frame of a Clip with a test image made of four coloured quadrants as an Overlay:
  - at rotation 90° the top-left quadrant's colour is at the top-right;
  - with `flip_h` it is at the top-right;
  - with crop `left` 0.5 the left quadrants' colours are gone;
  - with opacity 0.5 the pixel is mixed with what is under it;
  - with `radius` 0.5 the frame's pixels at the box's corners are the Segment's, not the Overlay's;
  - with a shadow offset of (20, 20), there are darker pixels just below and right of the box.
- **A media Segment** at scale 0.5 over a colour Background shows that colour at the frame's corners.
- **A Manual Scene** with a Framing at scale 1 over a colour shows the colour above and below the Source.
- **The PATCH:**
  - a Manual override without a Framing is refused;
  - a Framing on a Source Segment is refused;
  - an old-shape Overlay `size` is refused with a clear message.
- **Reading a Job saved in the old shape** returns the new shape, and its render matches before and after (same boxes in the plan file).
- **MCP:**
  - `merge_candidate_items` with `{"transform": {"rotation": 90}}` keeps the other Transform fields;
  - the dry run lists the Overlays' bounds and the Scenes' Layouts and framings.

**Seam H: picture gestures and Smart Guides (new, pure, vitest).** Prior art: `actions.test.ts` and `timelineView.test.ts` style of whole results from small inputs.
- **Move.** By (100, 0) from (540, 960) gives (640, 960). The centre is clamped at the frame's edge.
- **Corner scale.** Dragging the pointer from 200 px to 400 px from the centre doubles the scale, clamped at 0.05 and 8.
- **Edge stretch:**
  - on a picture rotated 90°, dragging the right edge's Grip downward stretches `stretch_x`;
  - stretch is clamped at 0.1 and 10.
- **Rotate:**
  - 2° snaps to 0°, and 88° to 90°;
  - with Shift, 22° gives 15°, and 23° gives 30°;
  - with Alt, there are no snaps.
- **Pinch and twist.** Two pointers moving apart to twice the distance and turning 30° give twice the scale and +30°.
- **Smart Guides:**
  - a picture whose left edge is 4 CSS px from another's right edge snaps to it, and the line is reported;
  - at 10 px there is no snap;
  - with Alt, there is no snap;
  - a rotated picture snaps by its bounds.
- **Crop commit.** Cropping the left 0.25 of a picture at scale 1 returns a Transform whose drawn kept part covers the same frame pixels as before.
- **`Picture` to CSS.** Rotation, flips, the crop's inner offset and size, and the radius in % come out as expected.

**Seam C: the client merge (existing).** A remote change to an Overlay's Transform and a local change to another Overlay both survive. Both changing one Overlay: the owner's wins.

**Not automated: a browser walkthrough** on a desktop (Chrome and Safari) and on a phone (iPhone Safari). Compare each step with a rendered frame at the same time.
- **An Overlay:** rotate it, flip it, stretch it, crop it in Crop mode, round it into a circle, and give it a border and a shadow.
- **A sideways phone video** as a media Segment: rotate it 90° and fill.
- **A Source Scene:** switch it to Manual, pan, zoom, scale it down over a colour, then Use for all Scenes.
- **The clip editor:** choose Manual for a Scene and pan it.
- **Smart Guides:** two Overlays snap edge to edge.
- **Undo:** each drag is one step.
- **On the phone:** pinch, twist, the Transform sheet and Crop mode.
- **A Transition** between two transformed media Segments.

**The checks to run:**
- the backend's pytest;
- the frontend's typecheck, tests and build.

## Out of Scope

- **Keyframes,** and any Transform that changes over an item's length (the `keyframes` feature).
- **Copying and pasting just the Transform** ("paste attributes").
- **Framing Split by hand,** per panel.
- **Face tracking or automatic Layouts on uploaded videos.**
- **Masks, blend modes, a Background picture, and a Background on Overlays.**
- **Rotating Text Layers, the hook or the captions** (the `text-advanced` feature).
- **Group bounds, group scale and group rotation** of a multi-item Pick, which stay out as in `multi-select-clipboard`. A group still moves together.
- **The canvas aspect,** which stays 9:16 at 1080×1920.

## Further Notes

- **Overturns two Out of Scope lines.** ADR 0007 records it.
  - Rotation: `.scratch/advanced-edit/spec.md` ("Keyframes, masks, rotation, …") and `.scratch/preview-direct-edit/spec.md`.
  - Manual crop positioning: `.scratch/clip-editor/spec.md` and `.scratch/ai-clipper-v1/spec.md`.
- **Choices made by default, not grilled.** Revisit them in review if they feel wrong:
  - the name **Framing** for Transform + Crop + Background;
  - rotation stored −360..360;
  - stretch 0.1–10, as in Concat;
  - border 1..40 px and shadow ranges;
  - 3° rotation snap;
  - a Split Scene offering a centred cover as its Framing;
  - Grips on a Manual Scene editing the Candidate's Framing when the Scene has no override (with "Only this Scene" to split it off);
  - the crop commit keeping the kept part in place;
  - the inspector's Fit, Fill and Reset.
- **Templates** (roadmap #21) and **keyframes** (#6) build on this one Transform shape.
- **Roadmap:** item 5, `transform-crop`, in the Advanced Edit v2 roadmap.
