# 0015: Background removal reads a cached Matte, and Overlays can go Behind the Main Track

Status: accepted
Date: 2026-10-22

Builds on 0002 (Segments), 0006 (two decks), 0007 (Framing and Background), 0009 (Retimed copies), 0013 (the Grade), 0014 (Video Effects) and 0019 (a model downloaded on first use). Drawn on the Candidate's Canvas (0022), whatever its aspect.

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
  - It is made from the Source or the media item at a 1280 px long edge (a smaller one at its own size), through onnxruntime: CoreML in its MLProgram format, on a fixed-shape copy of the model for each Matte size, and the CPU where that can't be had. Both make the same Matte. (Amended by ticket 13. CoreML's default NeuralNetwork conversion is wrong, which is why 09 ran the Matte on the CPU alone: see Consequences.)
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
  - A reversed item's Matte gets a reversed Retimed copy (0009), made from its pieces after them, by the Matte runner or a render, and found wherever a copy of a wider range serves. It is of one size, the Matte's own, which the preview and the render both read (amended by ticket 07: the Matte is already no larger than a preview copy). It is reversed in the same pieces as its picture's copy, and joined with the item's sound, so that its frames start where the picture's do.
  - A Freeze frame holds one frame of the Matte.
- **What shows where the picture is taken away:**
  - **A Segment shows its Background, in any Layout.**
    - For a media Segment or a Manual Scene this is the Framing's Background.
    - A Source Segment in Track, Split or Blur gets one Background of its own, by default its own picture blurred. In Blur it replaces the Layout's blur, so there is one backdrop.
    - Background gains an Image kind: a Media Library image filling the Candidate's Canvas (cover, centred, whatever its aspect, 0022), with no Transform. The picture blurred covers the Canvas too, at its shape.
  - **An Overlay can be Behind the Main Track** (`behind`).
    - It is drawn over the Segment's Background and under its picture, so it shows only where the picture doesn't cover the frame or is taken away.
    - It stays in Timeline time, apart from the Segments' cuts. During a Transition each side crossfades with the Behind Overlays already in it.
    - It sits on a new Behind Track under the Video Track, handled as the Overlay Track is (lanes, hide, mute, lock, Magnetic timeline, Ripple delete, Split all).
    - Being part of the Main Track's picture, it is under the Candidate's Grade and every Adjustment Layer.
- **The preview composites the Matte on a canvas.**
  - The Matte's pieces play on hidden videos following the decks (0006). Their frame is worked out from the deck's time, by the item's Matte frame rate and its pieces' length, which the Preview Plan gives with each piece (0001; amended by ticket 10).
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
- **The cost is paid once per piece of Source time shown.** Measured by `backend/tests/test_matte_model.py` (`MATTE_MODEL=1`, tickets 09 and 13) on 2026-10-22: an Apple M1 with 8 GB, ffmpeg 9.0.2, onnxruntime 1.31.0, onnx 1.23.2. The clip was 12 s of a 1920×1080 25 fps podcast, with two to four people at a table and cuts between wide and close shots. The machine was loaded by other sessions (load average about 4 in 13's run, 7 to 15 in 09's), so every figure is ±20% (09's ±30%).
  - **Throughput at 1280×720** (piece 0, 250 frames, decode and encode included), ticket 13:
    - CoreML MLProgram on the fixed-shape copy (`RvmMatter`): 13.8 frames a second (0.066 s a frame in the matter, frame conversion included; the model alone 0.035 s). A 10 s piece of 25 fps video takes about 18 s, about 1.8× real time. The first run at a size writes its copy and loads it in about 1.7 s.
    - CPU (where CoreML can't be had): 6.3 frames a second (0.14 s a frame in the matter). A piece takes about 40 s, 4× real time.
    - **CoreML's Matte is the CPU's:** a mean of 0.02 of 255 from it, the kept area within 0.01% on every frame (a few edge pixels differ by up to 60). So the two keep one `version`, `rvm-mnv3-2`, and their pieces may sit side by side in one Matte. Bumping it would only throw away the Mattes already made.
    - The copy gives the inputs fixed shapes (the frame's and the recurrent states', as the model gives them back from a first frame), makes the downsample ratio a constant, and is saved after onnxruntime's basic optimisation. It is written beside the model (`rvm_mobilenetv3_fp32.fixed-1280x720.onnx`), one for each Matte size (an item under 1280 px keeps its own size), and removed with the model.
    - Measured in ticket 09, and why the copy: CoreML ahead of the CPU in onnxruntime's default NeuralNetwork format (ticket 02's choice) ran at about 2.7 frames a second, and **its Matte is wrong:** blobby, keeping chairs, the table and the wall between the speakers (a mean of 29 of 255 from the CPU's, with the kept area up from 24% to 35%). It is just as wrong with CoreML on the CPU only, so the conversion is at fault, not precision. That is why `version` became `rvm-mnv3-2`: Mattes made by it are never read. MLProgram on the model as downloaded (dynamic shapes) is right but slower than the CPU (3.4 frames a second).
  - **A render** of a 6.45 s Clip (1080×1920) of that Source, through the API with the real matter (ticket 13):
    - Plain: 1.8 s.
    - With Background removal on its Segment and its Matte ready: 4.6 s, about 0.4 s more per Clip second (the Matte's decode, its feather and the blurred Background).
    - With the Matte still to make, from the save to the render done: 23 s, about 3.4 s more per Clip second (51 s and 7.6 s on the CPU, in 09). This is the one 10 s piece the Clip reads.
  - **Left for later:** the piece loop is serial (decode, model, encode), and on CoreML about half the matter's time per frame is outside the model (the frame's conversion, with ffmpeg's decode and encode alongside); overlapping them would gain more now that the model is fast. A smaller `downsample_ratio` (0.25 at 1280) works on a coarser picture inside, so it wasn't taken.
