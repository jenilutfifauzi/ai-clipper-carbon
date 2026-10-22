# 0015: Background removal reads a cached Matte, and Overlays can go Behind the Main Track

Status: accepted
Date: 2026-10-22

Builds on 0002 (Segments), 0006 (two decks), 0007 (Framing and Background), 0009 (Retimed copies), 0013 (the Grade), 0014 (Video Effects) and 0019 (a model downloaded on first use).

## Context

The `background-removal` feature (roadmap #13, `.scratch/advanced-edit-v2/roadmap.md`) brings Concat's AI cutout to the Advanced Edit. The use case is the podcast speaker over B-roll or a branded background.

- **Concat makes the cutout a clip property,** not an effect. It offers subjects Auto, Person and Object and an edge feather. A background job precomputes masks at 10 fps into one PNG per millisecond, and the renderer only reads them. Nothing in Concat runs a model per frame at export. The removed area is transparent, so lower tracks show through.
- **Concat's models:**
  - Person: Robust Video Matting (RVM) MobileNetV3, 15 MB, **GPL-3.0**.
  - Object: IS-Net, 179 MB, Apache-2.0.
  - A bundled fallback: MediaPipe Selfie, Apache-2.0, coarse and without temporal state.
- **Our Main Track has nothing under it.**
  - Only a Framing's Background (blur or colour) sits behind a media Segment or a Manual Scene.
  - Source Segments in Track, Split or Blur have no Background.
  - Every Overlay is drawn over the Segments.
- **ffmpeg can't run the model,** and our preview is a DOM composite with no WebGL (0012, 0014).
- **"Cutout" already names the Video Effect category of the keys,** which 0014 kept for Overlays. 0014 left "keys on Segments" to this feature.
- **`.scratch/advanced-edit/spec.md` lists masks as Out of Scope.**

## Decision

- **Background removal is a field, not a Video Effect:** `background_removal` = `{subject, feather}` on Segments (of the Source or a media item) and Overlays.
  - `subject` is only `person` for now.
  - `feather` is in output pixels at the picture's fitted size, scaled by the planner as 0014's sizes are.
  - The Matte applies after the picture's crop, scale and flips, and before its Grade and Video Effects. So the Grade and effects touch the subject alone, and the Matte follows the Crop and flips.
  - On an Overlay it may join a Chroma or Luma key, and their alphas multiply.
  - "Cutout" stays the name of the keys' category. The UI calls this "Remove background", in an Inspector section (and the phone's sheet). It has no Effects tab card and no hover try-on.
- **The Matte is computed ahead, by RVM, at every frame.**
  - It is made from the Source or the media item at a 1280 px long edge (a smaller one at its own size), through onnxruntime with CoreML ahead of the CPU.
  - It is kept as grayscale video pieces of 10 s on the item's own timeline, each run with 1 s of warm-up for RVM's recurrent state. A still image gets one PNG.
  - Every Segment, Overlay and Candidate showing that time reads the same pieces, so trims, splits and other Candidates reuse them.
  - The pieces are swept, as Retimed copies are, when no Candidate nor its Revision History needs them. Removing the model removes every Matte.
- **A Matte runner of its own,** like the Retimed copies'.
  - It runs one at a time, at low priority, latest request first.
  - It starts when Background removal is switched on or a range changes, and the Inspector shows "Finding the subject… N%".
  - A render makes the pieces it lacks first, inside its own job.
  - A failure is remembered until a Retry, and fails the render of a Clip that needs it.
- **The model is downloaded on first use,** with 0019's pattern: a `.part` file that resumes, a pinned SHA-256, and progress, cancel and remove. It comes from RVM's upstream release and is never bundled. The Inspector labels it "Person model (15 MB, GPL-3.0)".
  - The field can be saved without the model, and the Matte waits for it.
  - MCP gets tools to download the model and follow a Matte's progress. The field itself is reached through `edit_candidate` and `merge_candidate_items`, as every item field is.
- **Speed, Reverse and Freeze frame follow the Source's time.**
  - At a Speed, the Matte's frames are picked by the same Source time, through the same `setpts` in the render.
  - A reversed item's Matte gets a reversed Retimed copy (0009).
  - A Freeze frame holds one frame of the Matte.
- **What shows where the picture is taken away:**
  - **A Segment shows its Background, in any Layout.**
    - For a media Segment or a Manual Scene this is the Framing's Background.
    - A Source Segment in Track, Split or Blur gets one Background of its own, by default its own picture blurred. In Blur it replaces the Layout's blur, so there is one backdrop.
    - Background gains an Image kind: a Media Library image filling the frame (cover, centred), with no Transform.
  - **An Overlay can be Behind the Main Track** (`behind`).
    - It is drawn over the Segment's Background and under its picture, so it shows only where the picture doesn't cover the frame or is taken away.
    - It stays in Timeline time, apart from the Segments' cuts. During a Transition each side crossfades with the Behind Overlays already in it.
    - It sits on a new Behind Track under the Video Track, handled as the Overlay Track is (lanes, hide, mute, lock, Magnetic timeline, Ripple delete, Split all).
    - Being part of the Main Track's picture, it is under the Candidate's Grade and every Adjustment Layer.
- **The preview composites the Matte on a canvas.**
  - The Matte's pieces play on hidden videos following the decks (0006). Their frame is worked out from the deck's time.
  - On each frame (`requestVideoFrameCallback`), a 2D canvas draws the picture and the Matte (luminance to alpha, blurred by the feather).
  - The canvas replaces the picture's element, so the Grade's and the effects' SVG filters still apply. Until a Matte is ready, the picture is shown whole.

## Considered options

- **A Video Effect in the Cutout category,** as 0014 suggested. It would be uniform with the keys. But it alone would need a cache and a job, its place in the stack would mislead (the Matte is made from the original pixels), and it couldn't be tried on hover.
- **MediaPipe Selfie** (Apache-2.0, already a dependency). Rejected for coarse edges and frame-to-frame flicker. **An Apache-licensed matting model** (MODNet and the like) would avoid GPL weights. RVM was chosen because it is the best on video, and because ai-clipper is a personal tool that downloads the weights from upstream rather than shipping them.
- **Auto and Object subjects now** (Concat's parity). Object needs IS-Net (179 MB, per frame, prone to flicker) and isn't needed for a podcast speaker. `subject` leaves room for it.
- **10 fps masks** (Concat's). They are 3× cheaper, but edges would step on movement, and the render would have to repeat mask frames.
- **One Matte per Segment range.** Simpler, but any trim would redo all of it.
- **A 512 px Matte** (Concat's) is fastest but soft when a Track Layout zooms in on a face. A full-size Matte is sharpest but slowest and largest.
- **Rendering cut pictures as a server-made alpha video** (VP9 WebM) for the preview. The pixels would be exact, but this is refused for 0014's reason: every change would wait for an encode, and the Source decks would be broken up per Segment.
- **Only a wider Background** (image and video kinds per Segment). B-roll would then be cut and reordered with the Segments. **Only a lower track** (Concat's). A plain portrait blur or brand image would then need an item laid under every Segment.
- **Background removal only for Manual Layouts and media Segments.** The face-tracked speaker, the main use case, couldn't be cut out.

## Consequences

- **Overturns "masks" in `.scratch/advanced-edit/spec.md`'s Out of Scope,** for the subject's Matte only. Hand-drawn masks, the smart brush (SlimSAM), and the Auto and Object subjects stay out.
- **Every stored Candidate plans, renders and previews as before.**
  - An absent `background_removal` is off.
  - An absent `behind` is false.
  - A Segment with no Background of its own shows none until removal is switched on.
- **The Render Plan carries each item's Background removal** (its feather already scaled), **each Source Segment's Background, and the Behind Overlays.** The dry run shows them.
- **The backend gains a fourth kind of derived file** (after Filmstrips, Peaks and Retimed copies) and a second downloaded model.
- **The render must draw Behind Overlays inside the Main Track's picture,** between each Segment's Background and its picture, before the joins and the Candidate's Grade.
- **The preview gains a canvas path for pictures,** the only one that composites per frame in script. A Segment or Overlay with Background removal holds one or two more hidden videos while it is near.
- **The cost is paid once per piece of Source time shown.** The spec measures the Matte's throughput (frames per second of RVM at 1280 px on an M1) and a render with Background removal, and records them here.
