# 13: Track layout with face tracking

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 42–47; Scene Detector, Face Detector, Render Planner).

**What to build:** Close-up scenes in rendered Clips follow the speaker's face smoothly. This needs:
- scene detection over the clip range;
- face detection on downscaled frames;
- a Speaker Tracker that picks whom to follow;
- a Smooth Camera that moves the crop.

The resulting crop path is written as change points that drive the crop at runtime, still in a single ffmpeg process.

**Blocked by:** 12 (Render tracer).

**Status:** done

- [x] The Scene Detector uses ffmpeg's scene-change filter over the clip range and returns Scenes.
- [x] The Face Detector runs MediaPipe Tasks (BlazeFace short-range, CPU) on frames decoded at 640 px width, every 3rd frame.
- [x] The Speaker Tracker:
  - matches a detection to an existing ID when centres are within 15% of frame width;
  - scores each ID by face area with 0.85 decay;
  - gives the current target ×3 stickiness;
  - requires a 30-frame cooldown before switching;
  - resets at each scene cut.
- [x] The Smooth Camera:
  - uses a 25% crop-width dead-zone;
  - accepts a large jump only after 3 consecutive confirming detections;
  - moves as a critically damped spring;
  - snaps to target at scene start;
  - interpolates between detected frames;
  - holds its last position while the face is missing.
- [x] The Renderer applies the crop path through runtime commands at the change points, still in one process.
- [x] Seam B tests cover:
  - no per-frame jump above a set pixel limit;
  - no overshoot on a step change;
  - the dead-zone suppressing small moves;
  - a single-frame outlier being ignored while 3 confirmations are accepted;
  - snapping at scene start;
  - holding on face loss;
  - stickiness and cooldown.
- [x] Seam A test: for the 1-face fixture, the Render Plan keeps the detected face inside the crop on every sampled frame.
- [x] Manual visual check on a real close-up scene.

## Comments

**2026-10-14: implemented, not committed (awaiting owner review).** `make test`: 207 passed (13 new Seam B tests in `test_planner.py`, 1 new Seam A test in `test_render.py`), about 64 s. A real re-render of two Clips of Job `1d5d363bec2e` was checked frame by frame (below).

Built:
- `backend/app/analysis.py` (new): `Analyzer(ffmpeg, model, AnalysisTuning)` with `analyze(source, metadata, start, end, progress) -> ClipAnalysis` and `stop()`. Inside it:
  - **Scene Detector** (`detect_scenes`): one ffmpeg pass with `scdet=threshold=10` over the range (input `-ss`/`-t`, so times are on the Clip's timeline). It parses `lavfi.scd.time` from stderr and returns back-to-back `Scene`s. Short scenes are not merged yet (ticket 14).
  - **Face Detector** (`detect_faces`): ffmpeg decodes `framestep=3,scale=640:<even height>` as raw RGB to a pipe, one frame at a time (about 0.7 MB). MediaPipe Tasks `FaceDetector` runs on it (BlazeFace short-range, `Delegate.CPU`, `RunningMode.VIDEO`, `min_detection_confidence` 0.5). Boxes are scaled back to Source pixels. Frame k is at `k × 3 / fps` s; Sources are assumed constant frame rate. MediaPipe is imported inside the function, so the app starts as fast as before.
  - The two passes are separate. A single combined decode measured no faster, because the detector is the bottleneck.
  - `stop()` kills the running ffmpeg and raises `RenderStopped`, like the Renderer. `Renders.stop()` stops both.
- `backend/app/planner.py`:
  - input types `Scene`, `Face` (x, y, width, height, score; `centre_x`/`centre_y`) and `FrameFaces` (at, faces);
  - `reframes(source)`;
  - `plan_render(start, end, source, scenes=None, faces=None, camera=CameraTuning())`, still pure;
  - `_track_faces` and `_follow_speaker` (the Speaker Tracker), `_camera_path` and `_spring` (the Smooth Camera).
- `backend/app/renderer.py`: the crop moves through `sendcmd` (below). `_check` now accepts any number of scenes, as long as each has one panel of the same size.
- `backend/app/rendering.py`: analysis before planning, with its cache (`Renders._analysis`). Progress: analysis is the first third of a Clip's percent when it runs. The plan is now written after the analysis.
- `backend/app/config.py`: `AnalysisTuning` (`Settings.analysis`) and `CameraTuning` (`Settings.camera`).
- `backend/tests/fixtures/portrait.jpg` (25 KB): MediaPipe's `portrait_small.jpg`, Apache 2.0, a public-domain US government photo. Noted in `THIRD_PARTY_NOTICES.md`.

**Analysis artifacts and caching.**
- Each Clip's analysis is saved as `analysis/<start ms>-<end ms>.json` in the Job directory. It holds `ClipAnalysis {start, end (Source timeline), tuning, scenes, frames: [{at, faces: [{x, y, width, height, score}]}]}`, with times in seconds into the Clip and boxes in Source pixels. The two real Clips' files are 20 KB and 66 KB.
- A render reuses the file when the Candidate's `start`/`end` and the current `AnalysisTuning` both match. Otherwise it analyses again and overwrites the file.
- So a hook or layout edit never re-detects. A bounds edit does, and an old range's file stays until the Job is deleted. Changing `CameraTuning` needs no new analysis: re-rendering re-plans from the cached detections.
- Portrait Sources are passed through and not analysed.

**Speaker Tracker** (per Scene; it starts afresh at every cut because the planner gives it only that Scene's frames):
- **Matching.** A detection takes the identity of the nearest identity's last centre when that centre is less than 15% of the frame's width away (Euclidean distance, greedy nearest-first, one detection per identity). Otherwise it gets a new identity.
- **Score.** Each sampled frame, every score is multiplied by 0.85, then each identity seen gains its face area as a share of the frame.
- **Target.** The first face seen becomes the target; if several are seen, the highest-scoring one. Another *visible* face takes over when its score is more than 3× the target's and at least 30 Source frames (1.2 s at 25 fps) have passed since the target last changed. That includes the first pick.
- **Losing the target.** A lost target's score decays, so someone else takes over after roughly a second. While the target isn't seen, the camera gets no detection.

**Smooth Camera** (`_camera_path`, along one axis: x for Track):
- **Dead-zone.** It is 25% of the crop's width wide, centred on the goal (±76 px for a 608 px crop). A face inside it doesn't move the goal. When the face leaves it, the goal moves to the face.
- **Jumps.** A detection more than half the dead-zone (76 px) from where the face was last seen is a jump. A jump counts only after 3 detections in a row have jumped the same way. So one or two wrong detections are ignored, and a move made of small steps is followed at once.
  - First attempt: every move out of the dead-zone needed 3 confirmations that agreed within the zone. On the real footage that lagged so far behind animated speakers that close-ups were cut off. It was changed after that.
- **Spring.** The camera moves as an exact critically damped spring (ω = 10 /s: 95% of the way in about 0.47 s), capped at 1.5 crop widths per second (about 36 px a frame at 1080p25). It also stops at the goal rather than passing it, which matters when the goal changes mid-move. Per-frame positions between the sampled frames come from the spring.
- **Scene start.** Each Scene starts already centred on its target's first known position, looking ahead if the first sampled frames have no face. A Scene with no faces gets the centre crop.
- **Face lost.** The goal stays put: the camera finishes any confirmed move, then holds.
- **Plan output.** The positions are rounded to even pixels and clamped to the frame. A `CropPoint` is emitted only on frames where x changes, the first one at the Scene's start.

**Renderer.** All the scenes' points are joined into one `sendcmd=c='<at> crop@p0 x <x>\;…'` placed before `crop@p0`, in the same single ffmpeg process.
- Only coordinates that change get a command.
- Each command is sent a quarter of a frame early, so float rounding can't make it a frame late.
- The commands go inline in the filtergraph, so there is no temporary file. The two real Clips needed 94 and 252 points.

**Parameters** live in `CameraTuning` and `AnalysisTuning`; everything in them is a spec value except:
- the confidence of 0.5;
- the scdet threshold of 10 (cuts on this episode score 16–22);
- ω = 10;
- the speed cap of 1.5 crops/s.

ω was compared at 6, 8, 10 and 12 by replaying the real detections: lower values cut off more faces on fast moves, higher values snap.

**For ticket 14.**
- **Shared detections.** Scenes and per-frame faces are already planner input, so the 5-sample face count per Scene reads `faces` with no extra detection.
- **Split.** `_track_faces` gives each Scene stable identities with scores. Split can take the two top-scoring identities, order them by x (left on top), and run `_camera_path` per panel on that identity's centres, with the panel's crop size. The camera is one-dimensional, so a 1080×960 panel whose crop is shorter than the frame can run a second one for y.
- **Renderer.** Name the crops `crop@p0`, `crop@p1` and so on, and build the `sendcmd` per panel. `_check`'s same-size rule then gives way to per-scene layouts.
- **Scene merging.** Merging scenes under 1 s belongs in the planner (it has a Seam B test). Today the camera snaps at every cut, including a 0.34 s tail scene in the 70 s Clip.

**Tests.**
- **Seam B**, synthetic tracks at 1920×1080, 25 fps, sampled every 0.12 s:
  - a smooth glide is followed and settles within the dead-zone, with moves on non-sampled frames;
  - a confirmed 250 px jump starts exactly at the third detection, is monotonic, never passes the target, eases in and out, and stays ≤ 40 px per frame;
  - four successive steps are never overshot;
  - a ±70 px wobble gives one point, and a 90 px drift is followed;
  - one or two wrong detections are ignored;
  - each Scene starts on its face, even one first seen late;
  - holding: after loss, after a move cut short by loss, and with no faces at all;
  - stickiness at 2.5× area, a 4× switch only after the cooldown, the cooldown also delaying a switch back, and a reset per Scene;
  - same face within 15% (followed after 3 confirmations) versus another person at 900 px (followed only once the score has decayed, more than 0.5 s later);
  - a JSON round trip.
- **Seam A.** The fixture is generated at test time: a 1280×720, 6 s video of the portrait's head (400×500, the face box about 176 px) gliding 600 px over 5 s, which is farther than the 404 px crop is wide. The test checks:
  - the 1080×1920 Clip passes the usual ffprobe checks;
  - the plan is one Track scene with more than 10 points;
  - the analysis found the face in at least 90% of the sampled frames (in practice all 50);
  - on every sampled frame, the detected box lies inside the crop, about 32 px from the edge at worst;
  - output frames at 0.2, 2.5 and 5.5 s show the face, not the background, in the middle of the picture. This proves `sendcmd` really moved the crop;
  - a hook-only re-render leaves the analysis file untouched (same mtime) and gives the same plan.
- **Mutation checks.** Each of these broke at least one test:
  - cooldown 0;
  - stickiness 1;
  - smaller and larger dead-zones;
  - 1, 2 and 4 confirmations;
  - match distance 0.1 and 0.6;
  - no speed cap;
  - ω of 2 and 1000;
  - no score decay;
  - no snap at scene start;
  - treating a missing face as the centre;
  - no per-scene reset;
  - no `sendcmd` (Seam A only).

  Not covered: the stop-at-goal clamp, because no synthetic track makes the spring cross its goal.

**Real check** (Job `1d5d363bec2e`, 1920×1080 at 25 fps, M1 with 8 GB; `python -m app.cli render 1d5d363bec2e 2f6cdf1b 3444ea04`):

| Clip | Length | Scenes | Analysis (scdet + faces) | Encode | First render | Cached re-render |
|---|---|---|---|---|---|---|
| 2f6cdf1b | 26.8 s | 3 | 4.1 s, faces in 191 of 223 sampled frames | 6.0 s | 10.1 s | 6.0 s |
| 3444ea04 | 70.4 s | 9 | 8.8 s, faces in 576 of 586 sampled frames | 14.5 s | 23.3 s | 14.4 s |

- Analysis runs at about 0.13× realtime: scdet about 1.3 s per 27 s, decode plus MediaPipe about 2.8 s.
- Peak RSS, sampled every 0.5 s: the Python process (with MediaPipe loaded) 183 MB, ffmpeg 228 MB. They never run heavy at the same time.
- **Frames.** I looked at frames at about 40 timestamps, including frame-by-frame runs over the fastest moves.
  - The close-ups keep the speaker in frame and reasonably centred.
  - A fast lean (480 → 1050 px in 2.5 s, which cut the face off under the first camera rule) now stays inside.
  - A very animated stretch (about 1000 px/s head swings at 17–19 s of 3444ea04) stays in frame on every sampled frame but one: one sampled frame clips the box by 92 of 345 px for about 0.1 s.
  - Pans are smooth (at most 36–38 px per frame) with no visible overshoot.
- Both Clips are left re-rendered in `data/jobs/1d5d363bec2e/clips/`, with their analyses in `analysis/`.

Open issues:
- **Wide two-shots.** These are Track for now: the crop follows one speaker and pans across the table (about 1 s) when the tracker switches. Ticket 14's Split fixes this.
- **Small faces.** BlazeFace short-range on 640 px frames misses small faces. A face of 117 px in 1280×720 wasn't detected; one of 176 px was, at 0.94. Faces in this episode's wide shots score only 0.5–0.6 and are sometimes missed (32 of 223 frames had none). Ticket 14's 0/1/2/3+ face count may need the full-range model, or detection on halves of the frame, for 3-person wide shots.
- **Fast moves.** Face-in-crop isn't guaranteed: a face can move faster than 3 confirmations plus the spring can follow.
- **MediaPipe's log lines.** MediaPipe and LiteRT print INFO lines to stderr when the detector is created.

**2026-10-14: verified by the owner's session.** 207 tests pass. Spec deviation accepted: only jumps beyond the dead-zone need 3 confirmations, while smooth moves are followed at once. Committed.
