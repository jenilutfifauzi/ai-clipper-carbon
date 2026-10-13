# 14: Split & Blur layouts per scene

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 37, 48–51; Render Planner layout rules).

**What to build:** Each scene in a Clip gets its own layout:
- two faces → **Split**: two 1080×960 panels stacked, left face on top, each with its own camera;
- three or more faces, or none → **Blur**: the wide shot centred over a blurred background;
- one face → **Track**, from ticket 13.

Scenes shorter than 1 second are merged so the layout doesn't flicker. A layout override from Review replaces the automatic choice for every scene. An already-vertical Source is passed through.

**Blocked by:** 13 (Track layout with face tracking).

**Status:** done

- [x] The face count per scene comes from 5 sampled frames. 1 face gives Track, 2 give Split, 0 or 3+ give Blur.
- [x] Scenes shorter than 1 s are merged into a neighbouring scene before layouts are chosen.
- [x] A Track, Split, or Blur override applies to every scene. A forced Split with fewer than two faces splits the frame into its left and right halves.
- [x] A vertical Source is passed through without reframing.
- [x] The Renderer composes vertical stacking for Split and a blurred background for Blur. Layouts switch at scene boundaries within a single process.
- [x] Seam B tests cover:
  - the layout for 0, 1, 2, and 3+ faces;
  - the override on every scene;
  - short-scene merging;
  - Split panel order;
  - passthrough.
- [x] Seam A test: the 2-face fixture renders a 1080×1920 Clip whose Render Plan uses Split.
- [ ] Manual visual check on real two-person and three-person wide scenes.

## Comments

**2026-10-14: implemented, not committed (awaiting owner review).** `make test`: 220 passed (11 new Seam B tests in `test_planner.py`, 2 new Seam A tests in `test_render.py`), about 73 s. Real re-renders of three Clips of Job `1d5d363bec2e` were checked frame by frame (below). The last box stays open: the episode has no three-person shots (see the real check).

Built:
- `backend/app/planner.py`:
  - `plan_render(..., scenes, faces, layout=Layout.AUTO, camera)` takes the Candidate's layout override (`app.candidates.Layout`);
  - `_merge_short`, `_face_count`, `_choose`, `_split`, `_blur`;
  - `_follow`, a Smooth Camera on each axis for any panel, now used by Track as well;
  - `Panel.blur` (default false), which marks Blur's background;
  - `_passthrough` became `_fitted`, which Blur's foreground uses as well.
- `backend/app/renderer.py`: a branch per Scene, joined by concat (below). `_check` now refuses only captions, the hook and an empty plan.
- `backend/app/rendering.py`: passes `layout=candidate.layout`. Its analysis cache also checks the face model.
- `backend/app/analysis.py`: `ClipAnalysis.model` (the model file's name, required). Analyses saved before this change fail validation and are done again.
- `backend/app/config.py`:
  - `BLAZE_FACE_MODEL` is now `blaze_face_full_range.tflite`;
  - `RenderTuning` gets `blur_shrink` 4, `blur_sigma` 10 and `blur_brightness` −0.1.
- `backend/scripts/download_assets.py` and `THIRD_PARTY_NOTICES.md`: the full-range model (below).

**Layout selection** (planner; all pure, Seam B):
- **Merging.** Cuts are first turned into Scenes. A Scene shorter than 1 s (`MIN_SCENE_SECS`) joins the Scene before it; a short first Scene joins the one after it. Runs of short shots add up, and a Clip under 1 s stays one Scene. The merged Scene's sampled frames all go to its layout, tracker and cameras.
- **Face count** (`LAYOUT_SAMPLES` = 5). The count is the median face count of 5 of the Scene's sampled frames, spread evenly through it (at 10%, 30% … 90%). A Scene with 5 sampled frames or fewer uses all of them. The median means one or two missed or false detections don't change the layout.
  - 1 face gives Track, 2 give Split, and 0 or 3+ give Blur.
  - Without `faces` (not analysed) the Scene is Track with the centre crop, as before.
- **Override.** Track, Split or Blur replaces the choice in every Scene. A forced Track with no face keeps the centre crop.
- **Split.**
  - Each panel's crop is half the frame's width at 9:8, which is 960×854 at 1080p (an upscale of 1.125).
  - In a Scene that counts 2 or more faces, `_track_faces` identities are used. The two seen in the most sampled frames (ties go to the larger total area) are ordered by mean centre x: the left one is on top (area y=0) and the right one below (y=960).
  - Each panel follows its own identity with `_follow`: x and y cameras with the ticket 13 dead-zone, confirmations and spring, and per-axis limits. The face's centre is aimed at 40% of the panel's height (`SPLIT_FACE_AT`), where the frame allows, which keeps the seam clear for captions.
  - A forced Split of a Scene that counts under 2 faces shows static halves: the left half on top and the right half below, centred vertically. On 1080p that is x=0 and x=960, y=112.
- **Blur.**
  - Panel 0 is the full-height 9:16 centre crop, `blur: true`, filling 1080×1920.
  - Panel 1 is the whole frame, fitted: 1080×608 at y=656 for 16:9.
- **Portrait Sources** are passed through whatever the override.

**Filter-graph approach** (one ffmpeg process):
- `[0:v]split=N`, then each branch runs `trim=start=…:end=…,setpts=PTS-STARTPTS` and draws its Scene. The branches end in `concat=n=N:v=1:a=0[frame]`; poster and encode follow as before. One Scene has no split, trim or concat.
  - Trim bounds are the Scene's start and end minus half a frame. The scdet cut frame (its time ±0.5 ms) is the Scene's first frame, so rounding can't move a frame across a cut.
  - Each frame passes through only its own Scene's filters. Trim drops everything else, so there is no buffering and nothing is drawn twice.
  - The audio isn't cut; it runs straight from the input with loudnorm, so it stays continuous.
- **Inside a Scene:**
  - Each panel is `sendcmd` → `crop@s<i>p<j>` → `scale` into its area → `setsar=1`.
  - Blur's background is scaled down 4×, run through `gblur=sigma=10` and `eq=brightness=-0.1`, then scaled back up.
  - The first panel is padded to 1080×1920 unless it fills it; each other panel is overlaid at its area. So Split is pad + overlay at y=960, which is the same work as `vstack`, and Blur is the background + overlay.
  - Every crop has its own `sendcmd` directly before it, with times into the Scene (point.at − scene.start, a quarter of a frame early). It is the same adjacent sendcmd→crop pattern ticket 13 validated.
- **Rejected:**
  - drawing every layout on every frame and switching with `enable=`/`streamselect`, which costs every layout's filters (blur included) on every frame;
  - one shared `sendcmd` before a split, where queued frames could make commands land early.
- **Mutation checks.** Each of these broke at least one test:
  - trim bounds +½ frame instead of −½ (Seam A: one cut frame in the old layout);
  - no `setpts` (Seam A);
  - right face on top;
  - no merging;
  - no merging of a short first Scene;
  - max instead of median;
  - no override;
  - forced Split tracking a 1-face Scene;
  - 3+ faces as Split;
  - the face centred instead of at 40%;
  - no passthrough.
- Not distinguished by the tests: 5 samples versus the median of all of a Scene's frames.

**Model choice: BlazeFace full-range.**
- **Measured on this episode's footage**, faces counted per sampled frame over five ranges (three wide two-shots, one close-up, and a mixed 42 s):

  | Model | Wide 1 | Wide 2 | Wide 3 | Close-up | Time |
  |---|---|---|---|---|---|
  | short-range, 640 px, conf. 0.5 | 0:32, 1:59, 2:35 | 1:7, 2:69 | 0:9, 1:36, 2:17, 3:1 | 1:116, 2:1 | 6.8 s |
  | full-range, 640 px, conf. 0.5 | 2:126 | 2:76 | 1:4, 2:59 | 1:117 | 8.7 s |

  - Short-range missed one or both faces in about half the wide-shot frames. These are people half-turned towards each other, about 230–300 px in 1080p. A median of 5 would have made the first wide shot Track.
  - Full-range found both faces in essentially every frame and never gave a false second face in close-ups.
  - Neither 960 px decoding nor a confidence of 0.4 helped short-range enough. 960 px didn't change full-range.
- **Cost:** about 30% more detector time, one model for all detection. Running short-range for Track and full-range for counting would mean two passes.
- **URL** (official MediaPipe models bucket, version pinned): `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite`.
  - 1,083,786 bytes. Its MD5 `XeN2/MhVJzxccgdm02UjoA==` matches GCS's `x-goog-hash` and MediaPipe's legacy `mediapipe-assets/face_detection_full_range.tflite`.
  - SHA-256 `3698b18f…2b181b`.
  - It loads in the Tasks `FaceDetector` as it is.
- `make setup` now downloads it. The old `blaze_face_short_range.tflite` file stays in an existing `backend/models/`, unused.
- **Spec deviation** (module 9 says short-range): owner to accept.

**Seam A fixtures** (generated at test time from `fixtures/portrait.jpg`):
- `two_faces`: the head twice side by side, in colour on the left and grey on the right, so that the output shows which panel holds which face.
- `face_then_two`: 3 s of a close-up, then a cut (with a background change) to the two heads.
- **The tests check:**
  - the usual ffprobe checks;
  - the Split plan's areas and crops;
  - both faces found in at least 90% of sampled frames, each inside its own panel's crop on every frame, the left one in the top panel's;
  - a colourful head in the top panel and a grey one in the bottom panel;
  - for the switch: `["track", "split"]` with the cut at 3 s;
  - `nb_frames` equal to duration × 25 (±1), and video and audio durations within 0.05 s of the Candidate;
  - the last frame before the cut tracked and the cut's first frame already split.
- `test_selected_candidates…` (testsrc2, no faces) now expects Blur.
- **Ticket 13 Seam B tests** with two faces, or a face lost for most of a Scene, now force `Layout.TRACK`: they test the Speaker Tracker, and Auto would make those Scenes Split or Blur.

**Real check** (Job `1d5d363bec2e`, 1920×1080 at 25 fps, M1 with 8 GB, `python -m app.cli render 1d5d363bec2e 2f6cdf1b 3444ea04 3cc01d0e`; 61 s for the command):

| Clip | Length | Scenes (layouts) | Analysis | Encode | Total | Ticket 13 encode |
|---|---|---|---|---|---|---|
| 2f6cdf1b | 26.8 s | 3 (track, split, track) | 5.1 s, faces in 223/223 frames | 6.4 s | 11.5 s | 6.0 s |
| 3444ea04 | 70.4 s | 8 (split/track alternating; the 0.34 s tail merged) | 10.5 s, 586/586 | 16.3 s | 26.8 s | 14.5 s |
| 3cc01d0e (Split override) | 53.0 s | 7, all split | 8.1 s, 442/442 | 13.5 s | 21.6 s | 12.4 s (centre crop) |

- A forced Blur of 2f6cdf1b's range, rendered to the scratchpad only, took 7.5 s.
- A Split encode costs about 10% more than Track.
- **Frames.** I looked at contact sheets at about 20 timestamps, and frame by frame (n = 223–228 and 136–139 / 513–516) across three cuts.
  - **Split:** each panel holds its own guest, head and shoulders, the host's on top. The panels are steady: the wide shots barely move, so most panels have 1 crop point.
  - **Switches:** layout and content change on the same frame, with no frame of the old layout over the new shot, and no flicker.
  - **Forced Split on close-ups** (3cc01d0e) shows the spec's halves. The top half holds most of the face; the bottom shows the window and a sliver of the head. That is correct by the rule, but poor: the owner may prefer Track there.
  - **Blur** (forced, scratchpad render): the wide shot sits sharp in the middle over a soft, slightly darker fill, with no edges or banding.
- **Three-person shots: not checked.** A keyframe scan of the whole episode (518 keyframes, full-range) found 1 or 2 faces in every one: no 3+ and no empty frames. Blur's rule is covered by Seam B and the forced-Blur render. A three-person episode is needed for the last box.
- Backups of the Job's pre-check `job.json`, `clips.json`, `candidates.json`, `clips/` and `analysis/` are in the session scratchpad (`backup14/`). The three Clips are left re-rendered, with their new analyses; the third, `1588860-1641840.json`, is new.

**For ticket 15** (captions):
- Place the caption per Scene layout: on the seam (y≈960) in Split, in the lower third in Track and Blur.
  - Split panels put faces at 40% of each panel. The top face sits around y≈330–380 of the output and the bottom one around 1290–1340, so a band of about 860–1060 is clear.
  - In Blur, the foreground shot spans y=656–1264. The lower third (below 1264, above the 20% bottom safe zone at 1536) is the blurred background, which is a good place.
- A caption line spanning a Scene cut may need to change position at the cut, or take the position of the Scene it starts in. Scene layouts and their times are on `RenderPlan.scenes`.
- The ASS burn should come after `concat` on `[frame]`, so that subtitles follow the output timeline and not each branch's reset timestamps.
- `_check` still refuses captions and the hook.

Open issues:
- **Two identities for one person.** Split's identities can fragment if a guest leans more than 15% of the frame's width between sightings. That panel then holds its last position. It wasn't seen on this footage.
- **Detection cost.** Full-range costs about 30% more detection time: analysis is now about 0.15–0.19× realtime.


**2026-10-14: verified by the owner's session.** 220 tests pass. The switch to the full-range BlazeFace model was made on real-footage evidence (short-range missed about half of the wide-shot faces) and is reported to the owner. The 3+-person visual check remains open until an episode with such shots is available. Committed.
