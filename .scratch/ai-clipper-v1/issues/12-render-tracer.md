# 12: Render tracer: approved Candidate → downloadable Clip

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 38–39, 41, 57–60, 73; Render Planner and Renderer modules).

**What to build:** I select Candidates and press "Render selected". Renders run in a background queue while I keep reviewing. Each Candidate becomes a Clip:
- 1080×1920 H.264, using a static centre crop for now (later tickets add tracking, layouts, captions, and hook);
- loudness-normalized, fast-start;
- with a poster image.

Clips appear as cards with a player, title, reasoning, copy-description buttons, and a download button. Editing a rendered Candidate and rendering again replaces its Clip. A CLI command renders Candidates without the UI.

This ticket creates the Render Planner (pure; Seam B) and the Renderer.

**Blocked by:** 11 (Review UI).

**Status:** done

- [x] The render action queues the selected Candidates. The Job shows `rendering` while renders are pending and returns to `review` afterwards.
- [x] The Render Planner produces a Render Plan, here with a single static centre crop, and the plan is saved with the Job's artifacts.
- [x] The Renderer runs one ffmpeg process per Clip, encoding with `h264_videotoolbox` and falling back to `libx264`. Audio is AAC normalized to −14 LUFS. Output is a fast-start MP4 plus a poster JPEG.
- [x] Clips are listed by score and can be played and downloaded in the browser.
- [x] Changing a rendered Candidate and rendering again replaces its Clip.
- [x] Seam A tests:
  - ffprobe reports 1080×1920 and a duration matching the Candidate within a small tolerance;
  - an audio stream and a poster are present;
  - re-rendering replaces the output.
- [x] Seam B harness is in place: a Render Planner test with synthetic input yields a centred static crop.
- [x] A CLI render command works for a given Job and Candidate ids.

## Comments

**2026-10-14: implemented, not committed (awaiting owner review).** `make test`: 193 passed (8 new Seam A tests in `test_render.py`, 15 new Seam B tests in `test_planner.py`), about 53 s. `npm run build` and `npm run typecheck` pass. A real CLI render and a browser check were done on Job `1d5d363bec2e` (below).

Built:
- `backend/app/planner.py`: the Render Planner. `plan_render(start, end, source) -> RenderPlan`.
- `backend/app/renderer.py`: the Renderer (ffmpeg), with `Renderer.render(source, plan, video, poster, progress) -> encoder` and `stop()`.
- `backend/app/clips.py`: `Clip`, `ClipStatus` (`queued`|`rendering`|`done`|`error`), `RenderedClip`, `clip_files()`.
- `backend/app/rendering.py`: the render queue. It has `Renders.request` / `run` / `recover` / `stop`, `ranked_clips`, `NothingToRender` and `RENDERABLE`.
- `jobs.py`: the `rendering` status, `clips.json`, and `JobStore.load_clips` / `change_clips`.
- `worker.py`, `main.py` and `pipeline.py` changed as described below. `pipeline.py` now refuses to run a Job in `rendering` (JobConflict), so `reanalyze`, `retry` and the eval can't replace Candidates that are queued to render.
- `api.py`: the render and clips routes, `clips` on the Job detail, and `EDITABLE` now includes `rendering`.
- `config.py`: `RenderTuning` (`Settings.render`).
- `cli.py`: `render`; in the Makefile, `make render JOB=… [CANDIDATES="…"]`.
- Frontend:
  - `pages/job/Clips.tsx` (new);
  - "Render selected" in `Review.tsx`;
  - `JobPage.tsx` follows renders;
  - a `Render` stage in `stages.ts`, plus a `rendering` badge;
  - `api.ts` gets the types, `render`, `listClips`, and a `mediaUrl` that encodes each path segment and takes an optional `?v=`;
  - `buttonClass()` in `Button.tsx`, used for the download link;
  - `postingCopy()` exported from `CandidateEditor.tsx`.

**Render Plan** (`clips/<candidate-id>.plan.json`, written when the render starts, so it is there even when the render fails):
- `RenderPlan {start, end (Source timeline), source_width, source_height, fps, width 1080, height 1920, scenes, captions, hook}`.
- `scenes`: `ScenePlan {start, end (Clip timeline), layout: track|split|blur|passthrough, panels}`.
- `Panel {area: Box (where it sits in the output), crop_width, crop_height, path: [CropPoint {at, x, y}]}`. The crop stays put between change points.
- `captions: [CaptionEvent {text, start, end, words: [CaptionWord], area}]` and `hook: HookEvent {lines, start, end, area} | null` exist with the spec's fields but are always empty for now.
- **This ticket's rules:**
  - **Landscape or square Source:** one `track` scene with a full-height 9:16 crop.
    - Sizes and offsets are even, because 4:2:0 video can't be cut at odd pixels.
    - The crop is centred to the nearest even pixel.
    - For example, 1920×1080 gives 608×1080 at x=656.
  - **Portrait Source:** `passthrough`. The whole frame is fitted into 1080×1920 and centred, so 3:4 gets bars above and below.
- **How 13–16 extend it:**
  - **13:** emits several `CropPoint`s per Track panel. The Renderer turns them into `sendcmd` commands on the crop filter, which is already named `crop@p0`.
  - **14:** adds scenes from the Scene Detector, two `Panel`s for Split (areas 1080×960 at y=0 and y=960), and Blur as a background panel plus a fitted panel. It also adds the `layout` override to the planner's input (not taken yet, since nothing uses it).
  - **15/16:** fill `captions` and `hook`.
  - `renderer._check` refuses any plan it can't draw yet (more than one scene, panel or crop point; captions; a hook), so these limits fail loudly rather than silently.
  - The planner's input will grow keyword arguments (scenes, detections, words, hook, override).

**Render queue design.**
- **Shared queue.** Renders share the single Job worker queue rather than having a render thread of their own. So only one heavy tool runs at a time: yt-dlp's merge, Whisper (and later per-clip ASR and MediaPipe), or one ffmpeg encode.
- **Requesting renders.** `POST /api/jobs/{id}/render` (body `{candidate_ids?}`, default the selected Candidates) works like this:
  - Under the store lock (`change_clips`), it adds or requeues a `Clip` per Candidate in `clips.json`.
  - If the Job was in `review`, it moves it to `rendering` (stage `rendering`) and submits it to the worker.
  - It returns the Job's Clips in Candidate order: the AI's by score, then the manual ones.
  - Errors: 422 when nothing is selected, 404 for an unknown Job or Candidate, 409 unless the Job is in review or rendering.
- **When the Job's turn comes,** `Renders.run` holds the Job's run lock and renders the queued Clips one at a time, earliest request first, including any queued meanwhile.
  - Each render takes the Candidate as it is when that render starts. Review edits stay allowed during `rendering` (story 39).
  - When no Clip is left, the same locked step puts the Job back in `review`. So a request can't slip between the last render and the status change.
- **Requests while a Clip renders.** Asking for a Clip that is already queued leaves it in place. Asking for one that is rendering queues it again after (compared through `requested_at`).
- **Re-render replaces.** ffmpeg writes `.<id>.part.mp4` / `.part.jpg`, then both are renamed over `clips/<id>.mp4` / `.jpg`. The old Clip stays playable until then, and a failed re-render keeps it (`output` plus `error`).
- **Progress:** `job.message` reads "Rendering clip 2 of 3: <title>", and `job.progress` is the current Clip's percent, from ffmpeg's `-progress`.
- **Stop and restart.**
  - `Worker.stop` kills the running ffmpeg. The Clip is left `rendering`, and `Worker.start` puts it back in the queue (`Renders.recover`) and resubmits the Job.
  - A Job whose run lock another process holds (a CLI render) is left alone. The CLI renders anything the app queues meanwhile.
- **Delete** works like a queued Job: allowed unless a render holds the run lock (then 409).
- **Spotting stale Clips.** A Clip records the `start`/`end`/`hook_text`/`layout` it was rendered from. The UI compares them with the Candidate to show "Changed since this render" and a "Render again" button.

**Encoder settings** (`RenderTuning`):
- **Process count.** One encode per Clip, plus an audio-only measuring pass before it.
- **Seek and cut.** The cut uses input `-ss`/`-t`. When transcoding, this is frame-accurate: ffmpeg decodes from the previous keyframe and drops the frames before the start.
- **Video filters:** `crop@p0`, then `scale=1080:1920:flags=lanczos`, `setsar=1` and `format=yuv420p`, then `split`. The second branch is `select=gte(t,min(1 s, duration/2))` and `trim`, which gives the poster JPEG (`-q:v 3`, 1080×1920) in the same process.
- **Video encoder.** `h264_videotoolbox` at `-b:v 8M` (12M above 30 fps), `-profile:v high`, a keyframe every 2 s. If that encode fails, the same command is run with libx264 (`-preset fast -crf 20 -maxrate 12M`).
- **Audio.** Loudness normalization is **two-pass, linear**:
  - Pass 1 runs `loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json` on the range's audio. This took about 0.2 s on the fixture and about 1 s for 70 s of the real episode.
  - Pass 2 applies the measured values with `linear=true`, so it is a single gain rather than single-pass dynamic mode, which pumps and lands less exactly on the target.
  - Silent audio is not normalized.
  - The audio is then resampled to 48 kHz and encoded as AAC at 192k.
- **Container.** `-movflags +faststart`, `-map_metadata -1` and `-map_chapters -1`, so no YouTube metadata or chapters are carried over.

**API and CLI.**
- **API.**
  - `GET /api/jobs/{id}` gains `clips`.
  - `GET /api/jobs/{id}/clips` is a cheap list that the UI refetches whenever the render message changes and when the stream ends.
  - Clips are served by the existing `/media` route (`clips/<id>.mp4`, `.jpg`); the `.plan.json` is not served.
- **CLI.** `python -m app.cli render <job-id> [<candidate-id> …]` (or `make render`):
  - with no ids, it renders the selected Candidates;
  - it prints one line per Clip (duration, render time, encoder, size, path);
  - it exits 1 on an unknown Job or Candidate, or on a failed render;
  - while the app is rendering that Job, it says so and leaves the renders to the app.

**UI.**
- "Render selected" sits next to "N selected" in the Candidates panel.
- The Job page shows a fifth stage, Render, with the per-clip message and percent, and the status badge reads "Rendering". The review stays mounted and editable throughout.
- When the renders finish, only the Clips are refetched, so the open editor isn't reset.
- Below the review, a Clips panel lists the Clips in score order. Each card has:
  - a 9:16 `<video>` with the poster, and a `?v=<rendered at>` cache-buster;
  - title, duration, size, score and reason;
  - the render state (queued, rendering n%, or failed with the error);
  - "Changed since this render";
  - Download (an `<a download="<title>.mp4">`);
  - Render again or Try again;
  - copy buttons for the title and the TikTok, Instagram and Shorts copy (AI Candidates only).

**Tests.**
- **Seam A** (`test_render.py`). The Source is a 6 s 640×360 test pattern with a tone and the fixture json3 captions, with manual Candidates. ffprobe and file checks cover: 1080×1920 h264, an AAC stream, duration within 0.1 s of the Candidate, `moov` before `mdat`, integrated loudness −14 ± 1 LUFS (ebur128), and a 1080×1920 mjpeg poster. The tests cover:
  - the Render Plan's centre crop, and history `… review, rendering, review`;
  - Clips in Candidate order, served by `/media` with a 206, and only the finished files left behind;
  - re-rendering after a bounds and hook edit replaces the same file with the new duration;
  - a render queued behind another Job's held download: `rendering` is observable, and edits, a repeated request and an added Candidate are all accepted meanwhile;
  - the render uses the Candidate as edited while queued;
  - validation errors (422, 404, 409);
  - an encoder that fails: the Clip records an error and nothing half-written is left; then the fallback to libx264;
  - restart recovery of a Job left `rendering` with a Clip mid-render;
  - the CLI;
  - a 3:4 portrait Source passed through between black bars.
- **Seam B** (`test_planner.py`):
  - the 1920×1080 centre crop;
  - odd and unusual sizes, for which the crop must be even, inside the frame, full-height, 9:16 and centred within 1 px;
  - portrait passthrough areas;
  - a JSON round trip;
  - an invalid range.
- **Mutation checks.** Each of these breaks a test:
  - edits refused during rendering;
  - no recovery at start-up;
  - no faststart;
  - no requeue of a finished Clip;
  - no passthrough.

**Real check** (Job `1d5d363bec2e`, 1920×1080 at 25 fps, 41 min; M1 with 8 GB; dev servers running):
- `make render JOB=1d5d363bec2e CANDIDATES="2f6cdf1b 3444ea04"`:

  | Clip | Length | Render time | Size |
  |---|---|---|---|
  | 2f6cdf1b | 26.8 s | 5.9 s | 19.5 MB |
  | 3444ea04 | 70.4 s | 14.0 s | 65.8 MB |

  - That is about 4.5–5× realtime with h264_videotoolbox, and 21 s for the whole command.
  - Peak memory: ffmpeg's RSS was about 290 MB.
  - ffprobe: 1080×1920 h264 at about 5.6 Mb/s, plus AAC at 48 kHz and 192k. Integrated loudness was −13.9 LUFS.
- **Browser** (ego-browser, http://localhost:5173/jobs/1d5d363bec2e):
  - Both Clips were listed. "Render selected" (3 selected) showed Rendering with "Rendering clip 1 of 3: …" and a percent, and returned to Ready for review.
  - That run re-rendered the two Clips (6.3 s and 14.6 s) and rendered the manual 53 s clip (12.4 s, 50.7 MB).
  - A Clip played in the card (1080×1920).
  - The Job's Clips are left in `data/jobs/1d5d363bec2e/clips/`. Its pre-check `candidates.json` and `job.json` are backed up in the session scratchpad.
- **Frames.** I extracted frames and looked at them. They are sharp and correctly proportioned, with no stretch. As expected for a static centre crop, close-ups cut the speaker at the left edge, and the wide two-shot shows the table between the two guests. Ticket 13 (Track) and ticket 14 (Split/Blur) fix this.
- The manual clip's `split` override is rendered as the centre crop for now. Its `RenderedClip.layout` records `split`, so it will show as current, not "changed", until 14 lands. Re-render it after 14.

Open issues:
- **The poster** is the frame at 1 s, which can catch a blink or a cut. It could be chosen better later (the hook is visible at 1 s once ticket 16 lands).
- **Orphaned Clips.** If Selection runs again and replaces an unselected Candidate that has a Clip, the Clip is orphaned. It is listed last as "Clip of a Candidate no longer listed", and its files stay until the Job is deleted.
- **No cancel.** A queued render can't be cancelled.
- **Disk.** About 0.9 MB per second of Clip at 8 Mb/s.
- **Errors appear in the editor.** A failed "Render selected" or "Render again" request shows its error in the editor panel's alert, not next to the button that was pressed.
- **`make dev` reload.** A backend file change kills a running render, which then resumes at the next start.
- **Not covered by a test:** requesting a Clip again while it is being rendered. It would need a held render.

**2026-10-14: verified by the owner's session.** 193 tests pass. Committed.
