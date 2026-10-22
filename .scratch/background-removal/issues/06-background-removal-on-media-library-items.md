# 06: Background removal on Media Library items

**Parent spec:** `../spec.md` ("Model", "Matte store and runner", "Renderer", "Preview"); ADR 0015, 0014.

**What to build:** the owner cuts out a person in a media Segment, or in an Overlay video or image. A media Segment shows its Framing's Background where the person isn't. An Overlay shows what is under it. On an Overlay, Background removal may join a Chroma or Luma key, and their alphas multiply.

**The Matte:** pieces are kept beside the media item on its own timeline, as for the Source. A still image gets one PNG, made from a single run of the matter.

**Blocked by:** 03

**Status:** done

- [x] Seam B: Background removal reaches OverlayEvents and media SegmentPlans with the feather scaled.
- [x] Seam A (fake matter): a media Segment shows its Framing Background outside the kept area; an Overlay video and an image Overlay show the frame beneath; with Luma key the alphas multiply; an Overlay with Keyframes renders like an unkeyed one at the same frame.
- [x] Two Overlays of the same item over the same time share pieces.
- [x] The preview's compositor draws Overlays and media Segments, under their Corners, Border, Shadow and Blend Mode as the render orders them.
- [x] The Inspector section appears for Overlays and media Segments.

## Comments

**2026-10-22, done.** Built in 85f13f7, with a follow-up fix to the preview's toggling.

- **Mattes of Media Library items:**
  - A media item's Matte pieces live beside it on its own timeline. A still image gets one PNG from a single run of the matter.
  - Pieces are asked for on save, reported per Overlay by the status endpoint, made by a render and served to the preview.
  - They are swept with the Job and removed with the person model.
- **Render:**
  - An Overlay is cut after its crop, scale and flips, and a key's alpha multiplies the cut. A keyed Overlay is cut in its frame process.
  - A media Segment is cut over its Framing's Background, with the Behind Overlays between them (`_behind_slots` now covers media Segments).
  - Speed and Reverse follow ticket 07's Reversed copies on the item's own Mattes.
- **Preview:** cut-out Overlays and media Segments are drawn on a canvas in their PicturePanel (`CutVideo`, `CutImage`, `useItemMatte`). The Transition ghost of a reversed cut-out Segment now gets its pieces and copies.
- **Inspector:** the switch and the feather work on Overlays and media Segments.
- **Follow-up fix (preview):** `CutVideo` and `CutImage` keep their elements whether or not the item is cut. Switching Background removal therefore never remounts the video its Matte follows. Before the fix, toggling it on an Overlay lost the video's place.
- **Tests:**
  - Backend: `test_media_background_removal.py` (14 tests) with `test_background_removal`, `test_cutout_effects` and `test_sped_overlays`, 53 passed.
  - vitest: `matteTime`, `backgroundRemoval` and `matteHousekeeping`, 38 passed.
  - Typecheck is clean.
- **Browser walkthrough:** started on desktop, where toggling an Overlay's cut was checked and fixed. It was interrupted before the comparison with Save frame, so the preview's cut of Overlays and media Segments wasn't compared with a rendered frame.
