# 04: A Segment's Background, colour and image

**Parent spec:** `../spec.md` ("Model", "Planner", "Renderer", "Preview", "Editor"); ADR 0015, 0007.

**What to build:** with Background removal on, the owner picks what shows behind the speaker: the picture blurred (the default), a colour, or an image from the Media Library filling the frame. This works in every Layout. The same image kind is offered for a media Segment's or a Manual Scene's Framing Background.

**The model:**
- `Background` gains the kind `image` with a Media Library image id. It fills 1080×1920 (cover, centred), with no Transform.
- A Source Segment gains an optional `background`. It is used only while Background removal is on, and when absent it reads as the picture blurred.
- A Media Library image a Background uses counts as used, so it can't be deleted.
- A missing image, or an item that isn't an image, is refused on save.

**Blocked by:** 02

**Status:** done

- [x] Seam B: the Background in force reaches the SegmentPlan, the Segment's own only with Background removal on, replacing a Blur Layout's fill; the dry run shows it.
- [x] Seam A (fake matter): a frame shows the colour, or the image's pixels, outside the kept area; an image of another aspect covers the frame.
- [x] The Inspector's Background picker (blur, colour, image) appears for a cut-out Source Segment and offers image for Framings; one step of undo each; on a mixed Pick and in the phone's sheet.
- [x] The preview draws the colour or image under the cut.
- [x] MCP sets `background` through the item patches; deleting a used image is refused.

## Comments

**Built:**
- Model (backend/app/candidates.py): `BackgroundKind.IMAGE` and `Background.image` (a `MediaId`); an image kind without its image is refused ("An image Background needs its image…"). `Segment.background: Background | None` (None: the picture blurred); refused on a video's Segment ("Segment v shows a video, whose Background is its framing's…"). `Candidate.backgrounds()` / `backgrounds_of(framing, overrides, segments)` list every Background with the part it is (its Framing's, Layout Overrides', Segments' framings', Segments' own); `media_ids()` includes their images, so a used image can't be deleted (409 through the existing `media_uses`). An image given at all counts as used, so the editor drops it when the kind changes (the colour is kept). A lone Segment with a Background stays a Segment (review.py).
- API: `_check_media_of` refuses a Background image that is missing or isn't an image (422 "Segment a's background: no image X in the Media Library", "Its framing's background: …", "The Layout Override at N s's background: …", "Segment v's framing's background: …"); edit, draft and MCP go through it.
- Planner (Seam B): `SegmentInput.background`; `_cut_out` sets `SegmentPlan.background` to the Segment's own, else `Background()`; not cut out: None (unchanged). `ScenePlan.image` (after `framing`, so positional constructions keep working): `framed_scene` gives an image Background no panels and no colour; `keyed_scene` clears it when the moving picture covers every frame.
- Renderer: `_plain(plan, given, out, name, colour, image)` makes the colour frame from the given frames (as before) and, with an image, overlays it read by a `movie=` source (`filter_value`-escaped path), `scale=W:H:force_original_aspect_ratio=increase,crop=W:H` (cover, centred), `overlay=0:0:eof_action=repeat`. Used by `_framed_scene`, `_keyed_scene` and `_backdrop_scene` (Manual Scene's image, or the Segment's own colour/image). The files come from `files` (renamed `images` in `_scenes`/`_scene`/draws, threaded from `_command` through `_segmented` and `_cut_out`); `rendering.played_files` adds `backdrop_images(plan)` (Scenes' and cut-out Segments' images). No `movie` source and no change in the command without an image (the command fixtures pass).
- MCP: through the auto-derived item patches; the dry run lists a cut-out Segment's `background` ({kind, colour for a colour, image}); the instructions line grew. `TOOLS_BUDGET_BYTES` 91,000 → 92,000 (91,504).
- Editor: `BackgroundPicker` (TransformFields.tsx): Blur / Colour / Image (offered once the Library has an image, or when it already is one), the Colour field, and the image picked from the Library's thumbnails (radio buttons); `backgroundOfKind` keeps the colour, takes the first image when switched to Image without one, drops the image with its kind. `BackgroundFields` (Framings: media Segments, Manual Scenes) now wraps it, so Framings get the image kind too. The Library's images reach it by the `LibraryImages` context, provided around the Inspector in AdvancedEdit (desktop and the phone's sheet). The Remove background section shows "Behind the person" (`BackgroundPicker`) once any picked Source Segment is cut out, the first one's, Mixed when they differ; `setSegmentBackground` / `backedSegments` / `segmentBackground` / `sameBackground` in actions.ts set it on every picked cut-out Source Segment (mixed Pick too) as one change: a kind or an image one step each, a colour's drag grouped `segment-background:colour:<ids>`. A blur kept with its colour (`{kind: "blur", colour}`) rather than dropped, so switching back restores it.
- Preview: `filledStyle(colour, image)` (picture.ts: background colour plus a CSS `cover`/`center` background image of `mediaItemUrl`) used by `CutBackdrop` (`backdropView` gives `image` for a Segment's own image or a Manual Scene's), the Manual Scene's slot 0 (`slotView` carries `image`, `PanelView` draws it), and `MediaSegment`'s Background. The Transition ghost reuses `slotView`/`backdropView`, so it draws it too.
- Tests: `backend/tests/test_segment_backgrounds.py` (Seam B: in force only with removal, own/blurred/None, Blur, Framing image Scene, candidate plan and `media_ids`, refusals; Seam A with the fake matter: colour outside the disc, a 2:1 image covering the frame in Blur (its halves meeting at the middle, every corner the image's), a Manual Framing's image; missing/non-image refused, used image delete refused then allowed; MCP merge, dry run, refusal). Updated for `image: None` in saved Backgrounds: test_manual_layout.py, test_media_segments.py; test_freeze_frame.py's expected Segment was already missing `video_effects`/`background_removal` and now has them and `background`. `frontend/src/pages/job/advanced/segmentBackground.test.tsx` (actions on a mixed Pick, undo groups, picker markup, Framing's Image option, `backdropView`/`slotView`/`filledStyle`).

**Deviations / notes:**
- The Framing picker's changes keep their existing groups (`…background.<field>`), so consecutive kind (or image) picks on one Framing merge into one undo step, as kind changes did before; the Segment's picker makes each kind and image pick its own step.
- No browser walkthrough was done for this ticket (tests, typecheck only).
- The image is read once by `movie` (its one frame repeated); an animated or huge image isn't special-cased. A Background image isn't scaled by the Export Settings' size beyond covering the frame at that size (it is drawn at the plan's size, so it is right at every resolution).

**For 05 (Behind Overlays):** the backdrop is `[{name}b]` in `_cut_out`, now possibly an image (`_plain`); lay Behind Overlays over it before `[{name}c]`. In the preview, `CutBackdrop`'s div carries the image as a CSS background; Behind Overlays go above it inside `CutGroup`. For a media Segment or a Manual Scene that isn't cut out, the Framing's Background (now possibly `ScenePlan.image`) is drawn in `_framed_scene`/`_keyed_scene` and `MediaSegment`/`PanelView`: Behind Overlays showing where the picture doesn't cover go between it and the picture.
**For 06 (media items):** a media Segment's cut-out Background is its Framing's (`scene.image`/`scene.colour`/panels); `_backdrop_scene` already takes the Scene's image for a picture Scene, and `backdropView`'s `manual` argument already carries `image`. `Segment.background` is refused on a video's Segment, as the spec says.

