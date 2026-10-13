# 13: Track layout with face tracking

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 42–47; Scene Detector, Face Detector, Render Planner).

**What to build:** Close-up scenes in rendered Clips follow the speaker's face smoothly. This needs:
- scene detection over the clip range;
- face detection on downscaled frames;
- a Speaker Tracker that picks whom to follow;
- a Smooth Camera that moves the crop.

The resulting crop path is written as change points that drive the crop at runtime, still in a single ffmpeg process.

**Blocked by:** 12 (Render tracer).

**Status:** ready-for-agent

- [ ] The Scene Detector uses ffmpeg's scene-change filter over the clip range and returns Scenes.
- [ ] The Face Detector runs MediaPipe Tasks (BlazeFace short-range, CPU) on frames decoded at 640 px width, every 3rd frame.
- [ ] The Speaker Tracker:
  - matches a detection to an existing ID when centres are within 15% of frame width;
  - scores each ID by face area with 0.85 decay;
  - gives the current target ×3 stickiness;
  - requires a 30-frame cooldown before switching;
  - resets at each scene cut.
- [ ] The Smooth Camera:
  - uses a 25% crop-width dead-zone;
  - accepts a large jump only after 3 consecutive confirming detections;
  - moves as a critically damped spring;
  - snaps to target at scene start;
  - interpolates between detected frames;
  - holds its last position while the face is missing.
- [ ] The Renderer applies the crop path through runtime commands at the change points, still in one process.
- [ ] Seam B tests cover:
  - no per-frame jump above a set pixel limit;
  - no overshoot on a step change;
  - the dead-zone suppressing small moves;
  - a single-frame outlier being ignored while 3 confirmations are accepted;
  - snapping at scene start;
  - holding on face loss;
  - stickiness and cooldown.
- [ ] Seam A test: for the 1-face fixture, the Render Plan keeps the detected face inside the crop on every sampled frame.
- [ ] Manual visual check on a real close-up scene.
