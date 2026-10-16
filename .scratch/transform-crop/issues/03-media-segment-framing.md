# 03: A media Segment's Framing and Background

**Parent spec:** `spec.md` (user stories 22–25, 53; Implementation Decisions "Model", "Migration", "Planner", "Renderer", "Preview"); ADR 0007.

**What to build:** a media Segment is placed by a `Framing` (a Transform, a Crop and a Background), which replaces `fit`. It is drawn from the plan in the preview, no longer with `object-cover`.

- **Model.** Add `Background` (`blur`, or `colour` with `#rrggbb`) and `Framing`. `Segment.fit` goes, and `Segment.framing` comes in: required on a media Segment, refused on a Source Segment.
- **Migration.** Fill becomes the cover scale, and Blur becomes scale 1. Both get a blurred Background.
- **Planner.** A media Segment's Scene is a Background panel (today's blurred cover, or a colour) plus a `Picture`.
- **Renderer.** Draw the Background (today's blur panel, or a `color` source), then `_picture` over it.
- **Preview.** `PreviewSegments` draws the plan's Background panel and `PicturePanel`.
- **Inspector.** The Transform section on a picked media Segment, plus Background (Blur or a colour). A newly inserted media Segment is fitted over its blur (scale 1), as today.
- **Transitions** between media Segments render and preview as before.

**Blocked by:** 02

**Status:** done

- [x] Seam B:
  - [x] the Framing is required or refused by Segment kind;
  - [x] migration of fill and fit, with the same boxes as before within a pixel.
- [x] Seam A:
  - [x] scale 0.5 over a colour shows the colour at the frame's corners;
  - [x] an old Job with filled and fitted Segments renders the same plan boxes;
  - [x] a Transition between two media Segments still renders.
- [ ] Walkthrough: a sideways phone video rotated 90° and filled matches the render.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified, at each seam test first.

- **Model.** `BackgroundKind` (`blur`, `colour`), `Background` (`kind`, `colour` as `Colour`, #RRGGBB) and `Framing` (`transform`, `crop`, `background`, all identity by default) are in `backend/app/candidates.py`. `Fit` and `Segment.fit` are gone; `Segment.framing: Framing | None`. `Episode.segments` in `review.py` requires it on a video's Segment and refuses it on the episode's. The PATCH refuses an old `fit` with a message naming the framing (`_no_old_segments` in `api.py`).
- **Migration.** `migrated_segment(data, sizes)` in `backend/app/migration.py`: filled becomes `cover_scale` of its video (clamped to 8), fitted scale 1, both over `{"kind": "blur"}`; a Source Segment just loses `fit`. `migrated_candidate` and `migrated_clip` apply it, so `candidates.json`, the Revision History and `clips.json` read in the new shape; only a filled Segment asks the Media Library for a size.
- **Planner.** `SceneLayout.FILL` became `MEDIA`. `ScenePlan` gained `picture: Picture | None` and `colour: str | None`. `framed_scene(start, end, layout, width, height, framing)` plans a Scene of one picture: its `picture_of` over its Background, which is the blurred `_filled` cover of what the Crop keeps (`panels`, one Panel with `blur`), or no panels and `colour`. `SegmentInput.framing` replaces `fit`. `on_frame(picture)` gives the part of an unturned Picture that is on the frame as a Picture of its own (a crop in item pixels, flips minded); the planner tests use it to show that a migrated filled Segment shows the old 9:16 crop within a pixel, and fitted the old box.
- **Renderer.** `_scene` hands a Scene with a picture to `_framed_scene`: the frames are split; the Background is today's blurred panel, or a frame of the colour made from the frames themselves (`crop=2:2,scale,drawbox=t=fill`, so it has their timestamps, rather than a `color` source whose first frames could show before the picture's); then `_picture` of `on_frame(picture)`. So a filled video is still cropped to the frame and scaled to 1080×1920, never scaled to 3414 px wide, and a picture that covers the frame opaque skips the blur. `_check` accepts a Scene of a picture with no panels.
- **Preview.** `MediaSegment` draws the Scene: a black or `colour` box, the blurred cover through `panelStyle(panel, item_size, frame)` (new in `picture.ts`, beside `pictureStyle`), then `PicturePanel` with the video. `PreviewTransitions`' ghost passes the Scene (`segmentScene(plan, index)` replaced `sceneLayout`). `BLUR_SIGMA`/`BLUR_BRIGHTNESS` are exported from `ClipPreview.tsx`. The Timeline doesn't label a video's Scene; the clip editor names it "Video".
- **Inspector.** `SegmentFields` shows `TransformFields` (Transform and Crop) and the new `BackgroundFields` (Blur or Colour with a `ColorField`, in `TransformFields.tsx`) for a video's Segment; groups `segment:<id>:transform.<field>`, `crop.<edge>`, `background.<field>`. `newMediaSegment` uses `filledFraming(width, height)` (`picture.ts`).
- **MCP.** `_patch_model` treats `Framing | None` (any optional dataclass) as a nested patch, so `merge_candidate_items` merges `{"framing": {"transform": {"rotation": 90}}}` field by field. The instructions say what a video Segment's framing is. Clipboard and the client merge carry the Framing as part of the Segment, unchanged.

Choices: a newly inserted video's Segment is now filled (the ticket's "Fill is the default"), where before it was fitted over its blur. The blurred Background is of what the Crop keeps, not the whole video. Fill in `TransformFields` now goes by `fillScale(width, height, rotation)`: turned a quarter, a sideways phone video stands up and covers the frame (it used the unturned cover scale, ticket 01's choice, which zooms a turned video far too much); Overlays get this too.

Not tried: no browser walkthrough (a sideways phone video turned 90° and filled against its render, the Background control, a Transition between two framed videos in the preview).

**2026-10-16: orchestrator fix.** The ticket wrongly said a new media Segment is filled "as today"; today's `newMediaSegment` fits it over its blur. `newMediaSegment` now gives scale 1 over a blurred Background again, and the unused `filledFraming` is gone.
