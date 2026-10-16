# 04: Keyed media Segments

**Parent spec:** `spec.md` (user stories 5, 15, 44; Implementation Decisions "The Candidate model", "Planner", "Renderer", "Editor actions").

**What to build:** a media Segment's Framing can move. Its position, scale, rotation and opacity can be keyed, and so can its sound's volume. A push into a detail of a B-roll clip, or a zoom out from cover, works in the preview and the Clip. The Segment's Background shows wherever the moving picture leaves the frame uncovered. Transitions see the moving picture.

- **Model.** `keys` on the Segment, for a media Segment only: the picture properties and `volume`. Keyframes on a Source Segment are refused.
- **Planner.** A keyed media Segment's picture carries its motion in Timeline time. Its Background is drawn unless the picture covers the frame at every frame, sampled at the Clip's frame rate.
- **Renderer.** The keyed picture comes from the frame process and its video decode (from 02). It is laid over the Background inside its Segment's chain, before Transitions. A keyed volume uses 03's expression in the Segment's own audio chain.
- **Editor.** The Segment's inspector shows its Transform and Volume fields' Keyframe diamonds (from 06, when 06 is in: otherwise 06 adds them). Trimming a media Segment's ends re-anchors its Keyframes (the re-anchoring from 07, when 07 is in: otherwise 07 wires it).
- **MCP.** A change of a media Segment's range that strands a Keyframe is refused, naming it.

**Blocked by:** 02, 03

**Status:** done

- [x] Seam B:
  - [x] a media Segment zooming out from cover to scale 1 gets its Background;
  - [x] one that stays covered at every frame doesn't.
- [x] Seam A, real ffmpeg:
  - [x] a media Segment keyed in `scale` has its picture at the sampled size at two times;
  - [x] a zoom out shows the blurred Background at its edges;
  - [x] a fade Transition into a keyed Segment shows the moving picture mid-transition.
- [x] Seam A, HTTP: Keyframes on a Source Segment are refused; an MCP range change that strands a Keyframe is refused.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done, but for the check by hand.** Built test first in `backend/tests/test_keyed_segments.py` (Seam B on the planner, Seam A through the API, MCP and the real ffmpeg) and the frontend's `advanced/keyedSegments.test.ts` (Seam D: trims, split, Keyframe edits).

- **Time base.** A Segment's `at` is seconds from where it starts on the Timeline, which is its `start` in its video (no speed). That is the window 07's `split` already uses (`[shown.source_start − start, cut − start]`: for a video's Segment `shown.source_start` is its `start`, as the planner doesn't snap it), so the two agree. Written down in `Segment`'s docstring, `ClipSegment` in `api.ts`, ADR 0008's `at` bullet and the MCP instructions.
- **Model.** `Segment.keys` (`backend/app/candidates.py`), checked in a new `Segment.__post_init__` against `PICTURE_KEYS + SOUND_KEYS` and its length `end − start`. A Segment of the episode with any Keyframe is refused ("Segment e shows the episode, which has no Keyframes: only a video's Segment can be keyed"); empty lists are fine. A range that strands one gets the model's message ("Segment v's scale Keyframe at 1 s is past its length of 0.75 s; send its keys too"), so MCP's `merge_candidate_items` is refused naming it with no MCP code.
- **Planner.** `SegmentInput` gained `keys` and `id` (filled in `rendering.candidate_plan`); `SegmentPlan` gained `gain` (its volume Keyframes, in its own seconds) and `id`. `keyed_scene(scene, transform, keys, start, fps)` puts the motion on the Scene's Picture through `moving` (Timeline time), then samples `picture_at` at each frame `start + n / fps` of the Scene (the Clip's rate, 30 without one) and, when `covers(picture)` holds at all of them, leaves the Background out (`panels = []`, `colour = None`). `covers` is opaque and every frame corner inside the turned picture (1e-3 px slack). Unkeyed Segments plan as before: the renderer still decides their cover itself.
- **Renderer.** Keyed pictures are keyed by `("overlay", i)` or `("scene", i)` now (`Keyed`, `Feeds`). `_keyed_scenes(plan)` finds a video Segment's keyed Scenes; `_feeds` makes their `FrameFeed` in seconds into the Segment (`_later` moves the motion by −start), with a `VideoDecode` from the Segment's `source_start`. `_scene_inputs` adds the pipes after the Overlays' inputs, and `_segmented` → `_scenes` → `_scene` hands a keyed Scene's input number to `_keyed_scene`. That draws the Background from the Segment's frames brought to the Clip's rate from 0 s (`setpts=PTS-STARTPTS,fps=<rate>:start_time=0:round=up`, the same frame choice as `VideoDecode`), or a black frame when the plan left it out, then lays the feed at 0, 0, all inside the Segment's chain, before `xfade`. The `fps` on the joined frames is still added only for keyed Overlays. A keyed volume is `asetpts=PTS-STARTPTS` and 03's `_volume` in the Segment's own sound chain in `_source_inputs` (so `_measure` measures it too). The unkeyed golden command doesn't change.
- **MCP.** The dry run's scenes get `keys` and `bounds_at_keys` (`_motion_view`), and `sounds` lists a keyed Segment's volume (`id`, `media`, its span, `keys` in Timeline time). The instructions' Keyframes paragraph names video Segments. The tool list is 59.6 kB of its 60 kB budget (58.9 kB before: the schema of `segments`' `keys`, twice). No wording was trimmed, so **the next ticket that adds to the tool list must trim**.
- **Editor.**
  - Trims: `dragSegment` (`actions.ts`) re-anchors the dragged Segment through `retimed`, from the Segment as the drag began (every step of the drag is made from its origin already, so no `retimer` is needed). `retimed` now takes an item with `end` as well as one with `secs`. There are no range fields for a Segment in the inspector (only its Hint and its drag), so nothing else trims one by hand.
  - 06's clusters (merged before this was finished): `KeyedRef` has a `segment` kind; `KeyScene` takes an optional `track` (the Main Track as planned), and `keyedItem(edits, ref, track?)` gives a video Segment's span from it (`segmentSpan(segments, id, track)`; without it, as played back to back). `withKeyed` writes a Segment's keys and its Framing's Transform constant or `volume`. `KeyingContext` carries `track` from `AdvancedEdit`. `FramingFields` takes `playback` and `span`, shows `shownTransform` at the playhead, writes `writtenTransform`, passes `keyed` to `TransformFields`, and Reset goes through `resetFraming` (drops the Transform's Keyframes, keeps the sound's). The Segment's "Its sound" slider has a `KeyCluster` and shows the value at the playhead; the inspector's `volumeOf` writes a Keyframe for a keyed one (`writeItemKey` with the track). The phone's Transform sheet gets the same through `FramingFields`.
  - Stage: a video Segment keyed in its Transform is held by its Grips where it is at the playhead (`heldTransform`, which `stageTransform` now uses too) and its Grips write Keyframes there (`writeSegmentTransform`); Crop mode's commit sets the Crop and writes the Transform the same way.
- **Preview.** `MediaSegment` (`PreviewSegments.tsx`) gives `PicturePanel` the playback, so a keyed Segment moves as an Overlay does. Its sound is an `AudioEvent` of its own (its gain, the Transition's fade out as `fade_out`): keyed, through `followCurve` (now exported from `PreviewMusic.tsx`); unkeyed, `loudness` of it, the same volume as before. `picture.ts` gained `scenesAt` and `hasKeyedPictures`; `ClipPreview`'s `useKeyedTime` and the stage's pictures sample keyed Scenes as well as Overlays.

Choices:
- **"No Background" is no panels and no colour**, so the renderer lays the picture over a black frame and the preview over its black box; nothing shows through, since the picture covers every frame.
- **The keyed Segment's Background is brought to the Clip's frame rate** inside its chain, so its frames and the feed's pair one to one. A video at another rate is then at the Clip's rate from the start of its Segment, as a Transition already makes it.
- **The Transition test allows a frame either way**: xfade pairs the two sides' frames in order, not by time, so the blended picture is the Segment's frame k at the first side's frame time.

Not checked by hand: the preview of a keyed video Segment in the browser (its motion through `PicturePanel`, its sound's curve through `setValueCurveAtTime`), the inspector's clusters on a Segment, and dragging its Grips or edges. Stood in for by: the render tests measure the rendered picture's size at 0.52 s and 1.52 s against `value_at`, the blurred Background above and below a zoom out, the picture's place half way through a fade, and the sound 12 dB down after a dip to 0.25; `keyedSegments.test.ts` checks the trims, split and Keyframe edits; typecheck and build cover the wiring. Ticket 11's walkthrough covers it.
