# Background removal: a person cut out by a cached Matte, over a Background or Overlays Behind the Main Track

Status: ready-for-agent
Created: 2026-10-22

## Problem Statement

The owner clips podcasts. The speaker is filmed in a room, and the Clip shows that room as shot.

- **The speaker can't be put over anything else.** A common short-form look is the speaker cut out over B-roll, a branded backdrop, or their own room blurred like a phone's portrait mode. None of these can be made.
- **The keys don't help.** Chroma key and Luma key (ADR 0014) work only on Overlays, and only on a picture shot against a flat colour. The Source is never shot that way, and it isn't an Overlay.
- **Nothing can sit under the speaker.**
  - The Main Track is the bottom of the frame: every Overlay is drawn over it.
  - Only a media Segment or a Manual Scene has a Background (blur or colour), and that shows only where the picture doesn't cover the frame.
  - A face-tracked Source Segment (Track, Split or Blur) has no Background at all.
- **Concat has this.** Its clip inspector's "Remove background" cuts out a person or an object with an edge feather. It precomputes masks in the background with progress, and lower tracks show through.
- **"Masks" are Out of Scope in `.scratch/advanced-edit/spec.md`.**

## Solution

Segments (of the Source or a media item) and Overlays get **Background removal**: a "Remove background" switch with a feather, which keeps only the person in the picture.

- **A Matte is made once per piece of video.**
  - When the switch is turned on, a background runner on this Mac makes the subject's **Matte** for the time the item shows. It uses a person-matting model (Robust Video Matting), downloaded on first use.
  - The Inspector shows "Finding the subject… N%". Until it is ready, the preview shows the picture whole.
  - The Matte is kept in 10 s pieces of the Source's (or media item's) own timeline. Trims, splits, other Segments and other Candidates showing the same time reuse it.
  - A render makes any pieces it still lacks before it draws.
- **What shows where the person isn't:**
  - **The Segment's Background**, in any Layout. It can be:
    - the picture itself, blurred (the default; this is the portrait look);
    - a colour;
    - an image from the Media Library, filling the frame.
  - **Overlays Behind the Main Track.** An Overlay switched Behind is drawn over the Segment's Background and under its picture, on a new Behind Track under the Video Track. B-roll laid there shows through wherever the speaker is cut out. It keeps its own timing in Timeline time, so it isn't cut or reordered with the Segments.
- **An Overlay with Background removal** shows what is under it where the person isn't, as a keyed Overlay does. It may be keyed as well.
- **The Grade and Video Effects of a cut-out item touch the person only.** The Candidate's Grade and every Adjustment Layer cover the whole Main Track picture, the Behind Overlays included.
- **Speed, Reverse and Freeze frame keep the Matte on the same frames.**
- **The agent can do all of it** through MCP: switch Background removal on, set a Background, set an Overlay Behind, download the model, and follow a Matte's progress.

## User Stories

1. As the owner, I want to switch on "Remove background" for a Source Segment, so that only the speaker remains.
2. As the owner, I want the speaker's surroundings to become their own picture blurred by default, so that I get a portrait look with one switch.
3. As the owner, I want to change a cut-out Segment's Background to a colour, so that the speaker stands on a clean brand colour.
4. As the owner, I want to change a cut-out Segment's Background to an image from the Media Library that fills the frame, so that the speaker stands in front of a branded backdrop.
5. As the owner, I want Background removal to work in every Layout (Track, Split, Blur, Manual), so that the face-tracked speaker can be cut out.
6. As the owner, I want a Blur Layout's blurred fill to be replaced by the Segment's Background while Background removal is on, so that there is one consistent backdrop.
7. As the owner, I want to switch an Overlay to Behind the Main Track, so that B-roll plays behind the cut-out speaker.
8. As the owner, I want Behind Overlays on their own Behind Track under the Video Track, so that I can see and edit what plays behind.
9. As the owner, I want the Behind Track to have the same lanes, hide, mute, lock, Magnetic timeline, Ripple delete and Split all as the Overlay Track, so that I don't learn new rules.
10. As the owner, I want Behind Overlays to stay in Timeline time when I split, trim or reorder Segments (apart from the Magnetic timeline's ripple), so that B-roll isn't chopped up with the speaker's cuts.
11. As the owner, I want a Behind Overlay to show where a media Segment doesn't cover the frame, too, so that "behind" means the same everywhere.
12. As the owner, I want to set the feather in pixels, so that the edge of the cut is soft rather than jagged.
13. As the owner, I want the feather to grow with the picture's scale, so that a zoomed-in speaker keeps the same softness relative to them.
14. As the owner, I want to see "Finding the subject… N%" in the Inspector while the Matte is made, so that I know when the cut will appear.
15. As the owner, I want the preview to show the picture whole until its Matte is ready, so that nothing disappears unexpectedly.
16. As the owner, I want the cut-out to play in the preview in step with the picture, so that I can judge the edges and lay out B-roll.
17. As the owner, I want the preview's Grade and Video Effects to apply to the cut-out picture, so that the preview matches the render.
18. As the owner, I want trimming or splitting a cut-out Segment to reuse the Matte already made, so that I don't wait again.
19. As the owner, I want another Candidate showing the same moment of the Source to reuse its Matte, so that work isn't repeated.
20. As the owner, I want to render a Clip whose Matte isn't finished, so that the render completes it rather than refusing.
21. As the owner, I want a failed Matte to be shown with a Retry in the Inspector, so that I can recover.
22. As the owner, I want a render that needs a failed Matte to fail with a clear message, so that I never get a Clip that silently isn't cut out.
23. As the owner, I want to download the person model from the Inspector with progress, cancel and resume, so that I control a 15 MB download.
24. As the owner, I want to see that the model is GPL-3.0 before I download it, so that I know what I install.
25. As the owner, I want to remove the model (and with it every Matte) from the same place, so that I can free the space.
26. As the owner, I want to switch Background removal on before the model is downloaded, so that my edit is kept and the Matte waits.
27. As the owner, I want Background removal on an Overlay video or image, so that a presenter clip from the Media Library can be cut out too.
28. As the owner, I want Background removal and a Chroma or Luma key on one Overlay to multiply, so that I can clean up a difficult shot.
29. As the owner, I want a cut-out Segment's Grade and Video Effects to touch only the person, so that a glow or a grade doesn't spill onto the Background.
30. As the owner, I want the Candidate's Grade and Adjustment Layers to cover the Behind Overlays, so that B-roll and the speaker share one look.
31. As the owner, I want a cut-out Segment at a Speed to keep its Matte on the right frames, so that the cut never drifts.
32. As the owner, I want a reversed cut-out item to keep its Matte, so that Reverse still works.
33. As the owner, I want a Freeze frame of a cut-out Segment to hold its Matte too, so that the held frame stays cut out.
34. As the owner, I want a Transition between a cut-out Segment and another to crossfade both pictures with their Backgrounds and the Behind Overlays, so that the join looks right.
35. As the owner, I want to switch Background removal and its feather for several picked items at once (shared fields), so that I can treat a whole speaker sequence in one go.
36. As the owner on a phone, I want the same controls in the bottom sheet, so that I can do this away from my desk.
37. As the owner, I want unused Matte pieces swept away when I open a Job, so that disk use doesn't grow forever.
38. As the owner, I want copy and paste and duplicate to carry Background removal, the Background and Behind, so that a cut-out look moves with the items.
39. As the owner, I want undo and redo to cover every one of these changes, so that I can experiment.
40. As the owner, I want Candidates saved before this feature to plan, render and preview exactly as before, so that nothing changes behind my back.
41. As the agent, I want to set `background_removal`, a Segment's Background and an Overlay's `behind` through `edit_candidate` and `merge_candidate_items`, so that I can build the look.
42. As the agent, I want `dry_run` to show Background removal, Backgrounds and Behind Overlays in the Preview Plan, so that I can check before saving.
43. As the agent, I want an MCP tool to download the person model and to follow a Matte's progress, so that I can make a render succeed without the owner.
44. As the agent, I want an invalid feather or subject refused with a clear message, so that I can correct it.

## Implementation Decisions

Recorded in ADR 0015 (`docs/adr/0015-background-removal-reads-a-cached-matte.md`) and GLOSSARY (Background removal, Matte, Background, Overlay, Grade, Track).

**Model (candidates)**
- **`BackgroundRemoval`** = `{subject, feather}`, optional on Segment and Overlay. Absent means off.
  - `subject` is the enum `person`, the only value for now.
  - `feather` is in output pixels at the picture's fitted size, 0–40, default 4.
  - Values out of range, or an unknown subject, are refused on save.
- **`Background`** gains the kind `image` with a Media Library image id.
  - It fills 1080×1920 (cover, centred), with no Transform and no Keyframes.
  - A Media Library image a Background uses counts as used: it can't be deleted.
- **A Source Segment gains an optional `background`** (a `Background`).
  - It is used only while the Segment has Background removal, in any Layout.
  - Absent, it reads as the picture blurred.
  - A media Segment's or a Manual Scene's Background stays its Framing's.
- **Overlay gains `behind: bool`** (default false).
- **Copy, paste, duplicate, split and the Revision merge carry the new fields** like any item field.

**Matte store and runner**
- **A Matte module owns the derived files,** beside the Job (the Source) or the media item. It holds:
  - pieces of 10 s aligned to the item's own timeline, keyed by item, subject, model version and piece start. Each piece is a grayscale video at a 1280 px long edge, at the item's own frame rate, one Matte frame per video frame;
  - a still image's single PNG;
  - a remembered failure per piece.
- **Its interface:** given an item and a range, it answers which pieces exist, are missing, in progress or failed. It enqueues the missing ones, gives progress for a range, retries, and sweeps.
- **The model sits behind a narrow "matter" seam.** It takes frames at model size and gives alpha frames, keeping its recurrent state across a run.
  - The real implementation runs RVM MobileNetV3 through onnxruntime, with the CoreML provider ahead of the CPU.
  - Each piece runs from 1 s before its start (warm-up), discarding the warm-up frames.
  - Frames come from ffmpeg decoding at model size. The Matte is written through ffmpeg.
- **The runner works like the Retimed copies' runner.**
  - It runs one piece at a time, outside the Worker, at low priority, latest request first.
  - The editor's requests come from saves and drafts that turn Background removal on or change a range.
  - A render calls the same module synchronously for its missing pieces, inside its job, reporting progress.
- **Reverse:** a reversed item's Matte is a Retimed copy of its Matte pieces over the range, made by the 0009 mechanism after its pieces, in one size (the Matte's own), read by both the preview and the render.
- **The sweep runs when a Job is opened,** as Retimed copies' does: pieces that no Candidate nor its Revision History shows are removed. Removing the model removes every Matte.

**Model download**
- **A second downloaded model,** following Kokoro's pattern (ADR 0019):
  - a pinned URL (RVM's upstream release `rvm_mobilenetv3_fp32.onnx`), SHA-256 and size;
  - a `.part` file resumed with Range requests, renamed into `DATA_DIR/models` after the check;
  - states absent, downloading (done/total), ready and failed;
  - one download at a time.
- **Endpoints mirror Kokoro's:** download (202), cancel, and remove (409 while a Matte is being made), plus a state read. Each state carries the model's name, size and licence ("GPL-3.0") for the UI.

**Planner (Seam B)**
- **SegmentPlans and OverlayEvents carry Background removal,** with the feather scaled by the item's scale (0014's rule) and the pieces they read.
- **SegmentPlans carry the Background in force** (the Source Segment's own while Background removal is on, replacing the Blur Layout's fill).
- **The Render Plan lists Behind Overlays apart from the others,** with the same OverlayEvent shape.
- **The dry-run view shows all of these.**
- **A Candidate without the fields plans exactly as before.**

**Renderer**
- **Each picture's chain:** crop → scale → flips → Matte → Grade → Video Effects → the rest, as 0014 orders them.
  - The Matte input is read with the same `-ss`/`-t`, Speed `setpts`, Reverse copy or Freeze hold as its picture. It is scaled to the picture's cropped size, feathered with a blur, and joined with `alphamerge`.
  - On an Overlay it multiplies with a key's alpha.
- **A cut-out Segment is composited** as its Background, then the Behind Overlays at that Timeline time, then its alpha picture. This happens before the joins, so a Transition crossfades whole frames, and the Candidate's Grade and Adjustment Layers come after.
- **Behind Overlays are drawn with the Overlay chain.** A Segment that is not cut out and covers the frame hides them; outside their spans they cost a pass-through, as `_spanned` does.
- **A render whose Matte failed or whose model is absent fails** with a message naming the item and the cause.

**Preview**
- **A pure mapping from deck time to Matte piece and frame,** in TypeScript, follows 0009's per-Segment mapping (Speed, Reverse, hold).
- **A Matte compositor component replaces a cut-out picture's `<video>`/`<img>` with a `<canvas>`.**
  - The Matte pieces play on hidden videos following the picture's deck.
  - On each `requestVideoFrameCallback`, it draws the picture, turns the Matte's luminance into alpha, blurs it by the feather, and masks the picture with it.
  - The SVG Grade and effect filters stay on the element.
  - Until a piece is ready, it draws the picture whole.
- **Backgrounds of kind image and Behind Overlays are drawn in the same DOM composite,** in 0015's order.

**Editor**
- **The Inspector gets a "Remove background" section** for Segments and Overlays:
  - the switch;
  - the feather;
  - the Matte's status (progress, failed with Retry);
  - the model's state (Download "Person model (15 MB, GPL-3.0)", progress with Cancel, Remove).

  It works on a mixed Pick through shared fields, and appears in the phone's bottom sheet.
- **A Segment's Background picker** (blur, colour, image) appears for a cut-out Source Segment.
- **Overlays get a "Behind the Main Track" switch.** Switching it moves the item between the Overlay and Behind Tracks.
- **The Behind Track** sits under the Video Track, with the Overlay Track's behaviour.

**MCP**
- **The new fields come through the existing item patches** (auto-derived), `edit_candidate` and `dry_run`.
- **New tools:** one downloads the person model (and reports its state), and one reports a Candidate's Matte progress, waiting with `ctx.report_progress` as `wait_for_job` does.

## Testing Decisions

Good tests check what is seen and what is refused, not how a filter string is spelled. For example:
- a rendered frame's alpha or colour at a point;
- which Matte pieces exist after an action;
- the Candidate after an editor action;
- what the API and MCP turn down.

- **The matter seam.** In tests, the model is replaced by a deterministic fake matter that keeps a known area of a generated test pattern (for example, one coloured disc) and drops the rest. Every Seam A test uses it: fast, offline, with checkable pixels.
- **Seam B, the planner (pytest):**
  - Background removal reaches SegmentPlans and OverlayEvents with the feather scaled;
  - a Source Segment's Background is in force only with Background removal on, and replaces the Blur fill;
  - Behind Overlays are listed apart;
  - the dry-run view shows them;
  - a stored Candidate without the fields plans exactly as before.

  Prior art: `test_overlay_grades.py`, `test_segment_video_effects.py`.
- **Seam A, the HTTP API with real ffmpeg and the fake matter:**
  - switching Background removal on makes the pieces covering the range, and a trim within them makes none new;
  - a second Candidate over the same Source time makes none new;
  - a rendered frame shows the subject's colour inside the kept area and the Background (colour, image, blur) outside;
  - a Behind Overlay shows outside the kept area and not over a Segment that isn't cut out;
  - the feather softens the edge in proportion to scale;
  - Speed, Reverse and Freeze keep the kept area on the same frames;
  - a Transition keeps timing;
  - an Overlay with Background removal and Luma key multiplies the alphas;
  - a render makes missing pieces first;
  - a failed piece fails the render with its message, and a Retry clears it;
  - the sweep removes unused pieces and keeps used ones;
  - a stored Candidate renders the same command as before (the existing command fixture).

  Prior art: `test_cutout_effects.py`, `test_retimed_copies.py`.
- **Model download:** the local HTTP server pattern of `test_kokoro_download.py`: resume, digest refusal, cancel, remove while busy (409), and removal deleting every Matte.
- **The real model, opt-in** (`MATTE_MODEL=1`, as `RENDER_COST`): RVM on a short clip with a person gives a non-trivial Matte. It measures throughput (frames per second at 1280 px on an M1) and the cost of a render with Background removal, and both are recorded in ADR 0015.
- **API and MCP:**
  - refusals (feather range, subject, Background image not an image);
  - `merge_candidate_items` setting the fields;
  - the download and progress tools.
- **The editor (vitest):**
  - the deck time → Matte piece and frame mapping (Speed, Reverse, hold), against a shared fixture with the Python mapping;
  - Inspector actions on a mixed Pick;
  - switching Behind moves an Overlay between Tracks;
  - the Behind Track's ripple and Split all;
  - copy, paste and the Revision merge carrying the fields.

  Prior art: `actions.test.ts`, `grading.test.ts`.
- **Walkthrough** (`run` / ego-browser, desktop and phone):
  - download the model;
  - cut out the speaker;
  - watch the progress;
  - change the Background to a colour and an image;
  - lay B-roll Behind;
  - play across a Transition;
  - render and compare.

Run only this feature's backend test files, never the full suite.

## Out of Scope

- The Auto and Object subjects (IS-Net). `subject` leaves room for them.
- The smart brush and smart eraser (SlimSAM), and hand-painted masks.
- A bundled fallback model (MediaPipe Selfie).
- An Effects tab card for Background removal, or trying it on hover.
- A Transform or Keyframes on a Background image, and video Backgrounds (use a Behind Overlay).
- Behind for Text Layers, Shapes or Adjustment Layers.
- Background removal on Adjustment Layers.
- Keyed (animated) feather.

## Further Notes

- **Overturns "masks"** in `.scratch/advanced-edit/spec.md`'s Out of Scope, for the subject's Matte only (ADR 0015).
- **RVM's weights are GPL-3.0.** ai-clipper is a personal tool that downloads them from upstream on request and never ships them. Revisit this if the app is ever distributed.
- **Cost:** a 60 s Clip at 30 fps is 1800 frames of RVM. The real-model test measures this; the UI shows progress and no warning.
- **Builds on** ADR 0002, 0006, 0007, 0009, 0013, 0014 and 0019.
