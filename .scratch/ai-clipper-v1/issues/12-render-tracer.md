# 12: Render tracer: approved Candidate → downloadable Clip

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 38–39, 41, 57–60, 73; Render Planner and Renderer modules).

**What to build:** I select Candidates and press "Render selected". Renders run in a background queue while I keep reviewing. Each Candidate becomes a Clip:
- 1080×1920 H.264, using a static centre crop for now (later tickets add tracking, layouts, captions, and hook);
- loudness-normalized, fast-start;
- with a poster image.

Clips appear as cards with a player, title, reasoning, copy-description buttons, and a download button. Editing a rendered Candidate and rendering again replaces its Clip. A CLI command renders Candidates without the UI.

This ticket creates the Render Planner (pure; Seam B) and the Renderer.

**Blocked by:** 11 (Review UI).

**Status:** ready-for-agent

- [ ] The render action queues the selected Candidates. The Job shows `rendering` while renders are pending and returns to `review` afterwards.
- [ ] The Render Planner produces a Render Plan, here with a single static centre crop, and the plan is saved with the Job's artifacts.
- [ ] The Renderer runs one ffmpeg process per Clip, encoding with `h264_videotoolbox` and falling back to `libx264`. Audio is AAC normalized to −14 LUFS. Output is a fast-start MP4 plus a poster JPEG.
- [ ] Clips are listed by score and can be played and downloaded in the browser.
- [ ] Changing a rendered Candidate and rendering again replaces its Clip.
- [ ] Seam A tests:
  - ffprobe reports 1080×1920 and a duration matching the Candidate within a small tolerance;
  - an audio stream and a poster are present;
  - re-rendering replaces the output.
- [ ] Seam B harness is in place: a Render Planner test with synthetic input yields a centred static crop.
- [ ] A CLI render command works for a given Job and Candidate ids.
