# AI Clipper v1 — local podcast-to-shorts clipper

Status: ready-for-agent
Created: 2026-10-13

## Problem Statement

I run Indonesian-language podcasts (episodes of 30 minutes to 3 hours, sometimes mixed with English). Each episode is edited and moves between close-ups and wide shots of 1–3 people. Once an episode is live on YouTube, I want to turn its best moments into vertical short clips for TikTok, Instagram Reels, and YouTube Shorts.

Doing this by hand is slow:
- finding the strong moments in hours of conversation;
- cutting them on clean word boundaries;
- reframing 16:9 footage to 9:16 (especially two-person wide shots);
- writing accurate Indonesian captions;
- writing a hook and platform descriptions for every clip.

The open-source project I'm basing this on (openshorts) doesn't fit, for five reasons:
- **Too heavy.** It needs torch, YOLO, Docker, and cloud and social features I don't need.
- **Weak transcription for Indonesian.** It uses Whisper `small`, at about 18% WER on Indonesian. Clip selection and captions both depend on that transcript.
- **Fully automatic.** It renders every candidate, which wastes scarce compute on clips I'd reject.
- **No steering.** I can't point the AI at my channel's taste.
- **No measurement.** I can't tell whether its picks are actually good.

All of this also has to run on my own Apple M1 with 8 GB of RAM.

## Solution

A local web app on my Mac, used only by me, that works in two stages.

**Analyze stage**
- I paste the YouTube URL of a published episode.
- The app fetches the video (up to 1080p) and YouTube's Indonesian auto-captions. This takes seconds and replaces a long local transcription.
- Gemini proposes clip **Candidates**, using my **Channel Profile**, an optional per-job **Brief**, and examples from my past clips.

**Review**
- I see the Candidates ranked by score, each with the AI's reasoning. I can preview any of them instantly from the source video, without waiting for a render.
- I adjust boundaries by clicking words in the transcript, or mark my own ranges as new clips.
- I can edit each clip's hook text and force a layout (Track, Split, or Blur).
- I approve the clips I want.

**Render stage**
Only approved clips are rendered. Each clip:
- re-transcribes just its own audio locally for accurate burned captions;
- picks a layout per scene (one face is tracked smoothly, two faces are stacked top and bottom, three or more are shown wide over a blurred background);
- shows the hook text for the first 3 seconds;
- is exported as a 1080×1920 MP4 I can play and download, with copyable descriptions per platform.

**Evaluation**
- An evaluation harness compares the AI's picks against clips I posted in the past.
- Improving clip selection is the first priority. The rest of the product is built only after selection passes a measured quality gate.

**Later (Milestone 5)**
- Uploading a master file directly, transcribed fully on my machine in the background.

## User Stories

### Creating a Job and ingesting the episode

1. As a podcaster, I want to paste the YouTube URL of a published episode, so that I can start clipping without downloading anything manually.
2. As a podcaster, I want the app to fetch the video at no more than 1080p, so that downloads stay fast and don't fill my 46 GB of free disk.
3. As a podcaster, I want the app to prefer an H.264 download, so that the source plays in my browser for previews without a separate proxy file.
4. As a podcaster, I want the app to use YouTube's Indonesian auto-captions as the transcript, so that a 3-hour episode is ready for analysis in seconds instead of about 1.5 hours.
5. As a podcaster, I want the app to fall back to a full local transcription when an episode has no auto-captions, so that every episode can still be clipped.
6. As a podcaster, I want to set the clip duration range per Job (default 20–90 seconds), so that clips fit the platforms and my format.
7. As a podcaster, I want to give an optional Brief per Job (for example "find the funny moments" or "focus on business tips"), so that I can steer one episode differently from my usual profile.
8. As a podcaster, I want to turn burned captions on or off per Job, so that I can produce clean versions when needed.
9. As a podcaster, I want the transcript language to default to Indonesian with a per-Job override, so that code-switched episodes aren't misdetected.
10. As a podcaster, I want to watch live progress for each stage (download, transcript, analyze, review, ASR, render), so that I know what the app is doing during long jobs.
11. As a podcaster, I want Jobs to run one at a time while others wait in a queue, so that my 8 GB Mac doesn't grind to a halt.
12. As a podcaster, I want a failed Job to resume from its last completed stage, so that I never re-download or re-transcribe a 3-hour episode because a later step failed.
13. As a podcaster, I want a Job to pause in a "waiting for quota" state when Gemini's free tier is exhausted, so that the Job resumes later instead of failing.
14. As a podcaster, I want a clear error when a video can't be downloaded, with a hint to update the downloader, so that I can fix YouTube breakages myself.
15. As a podcaster, I want to see my recent Jobs and their status on the home page, so that I can return to work in progress.
16. As a podcaster, I want to delete a Job together with all its files, so that I can reclaim disk space.
17. As a podcaster, I want to see disk usage and get a warning when less than 10 GB is free, so that I don't run out of space mid-job.

### Channel Profile and taste

18. As a podcaster, I want to define a Channel Profile once (niche, audience, clip style, things to avoid), so that every Job reflects my channel's taste without retyping it.
19. As a podcaster, I want to edit the Channel Profile at any time and have new Jobs use it, so that the AI keeps up as my channel evolves.
20. As a podcaster, I want my past clips (from episodes not used for evaluation) given to the AI as examples, so that it learns what I actually consider clip-worthy.
21. As a podcaster, I want titles, hooks, descriptions, and hashtags written in the transcript's language, so that they're ready to post for my Indonesian audience.

### Candidates

22. As a podcaster, I want roughly one Candidate per 8–10 minutes of episode (at least 3), so that I get enough options without noise.
23. As a podcaster, I want Candidates ranked by predicted score, so that I review the most promising first.
24. As a podcaster, I want to see why each Candidate was chosen (reason, hook strength, emotion, retention notes, score breakdown), so that I can judge it quickly.
25. As a podcaster, I want the AI to consider the whole episode when choosing, so that it understands context and callbacks and doesn't pick several Candidates on the same topic.
26. As a podcaster, I want Candidates not to overlap each other, so that I don't review the same moment twice.
27. As a podcaster, I want Candidates to start and end on word boundaries with a natural lead-in and tail, so that clips don't cut words in half.
28. As a podcaster, I want every Candidate to respect the Job's duration range, so that I don't have to trim clips that are too long or too short.
29. As a podcaster, I want each Candidate to come with a proposed hook text of at most 2 short lines, so that I have a strong opener ready.
30. As a podcaster, I want a title and copyable TikTok, Instagram, and Shorts descriptions with hashtags per Candidate, so that posting takes seconds.

### Review

31. As a podcaster, I want to preview any Candidate instantly from the source video, so that I can judge it without waiting for a render.
32. As a podcaster, I want to see the transcript around a Candidate, so that I understand what's being said before and after it.
33. As a podcaster, I want to click a word in the transcript to set a Candidate's start or end, so that adjusting boundaries is fast and precise.
34. As a podcaster, I want adjusted boundaries to snap to word boundaries, so that my edits never cut a word.
35. As a podcaster, I want to mark any transcript range as a new manual clip, so that I can include moments the AI missed.
36. As a podcaster, I want to edit a Candidate's hook text before rendering, so that the burned hook says exactly what I want.
37. As a podcaster, I want to force a clip's layout to Track, Split, or Blur (default Auto), so that I can rescue clips where automatic framing would be wrong.
38. As a podcaster, I want to select which Candidates to render, so that compute is spent only on clips I'll post.
39. As a podcaster, I want rendering to run in the background while I keep reviewing, so that I'm never blocked.
40. As a podcaster, I want my review edits saved immediately, so that closing the browser loses nothing.
41. As a podcaster, I want to change a rendered clip's boundaries, hook, or layout and render it again, so that I can fix a clip without starting over.

### Rendering

42. As a podcaster, I want close-up scenes cropped to 9:16 following the speaker's face, so that the subject always stays in frame.
43. As a podcaster, I want the virtual camera to ignore small head movements, so that the framing doesn't jitter.
44. As a podcaster, I want the camera to ignore a single spurious detection and follow only confirmed moves, so that it never jumps to a false face.
45. As a podcaster, I want camera moves to be smooth and never overshoot, so that clips look professionally framed.
46. As a podcaster, I want the camera to snap to the new subject at a scene cut, so that the first frame of each scene is already framed.
47. As a podcaster, I want the camera to hold its last position when the face is briefly lost, so that the frame doesn't drift.
48. As a podcaster, I want two-person wide shots shown as two stacked panels (left person on top), so that both speakers are visible and large.
49. As a podcaster, I want shots with three or more people, or no faces, shown wide over a blurred background, so that nothing important is cropped out.
50. As a podcaster, I want very short scenes (under 1 second) merged into their neighbours, so that the layout doesn't flicker.
51. As a podcaster, I want an already-vertical source passed through without reframing, so that it isn't cropped needlessly.
52. As a podcaster, I want burned captions produced from a fresh local transcription of just the clip's audio, so that on-screen words are accurate even where YouTube's captions were wrong.
53. As a podcaster, I want captions in short UPPERCASE lines (about 16 characters or 1.4 seconds per line) with the active word highlighted in orange, so that they're readable and engaging.
54. As a podcaster, I want captions placed on the seam in split layout and in the lower third otherwise, so that they never cover faces.
55. As a podcaster, I want captions and hook to stay inside platform safe zones (not in the top ~12%, bottom ~20%, or right ~12%), so that platform UI doesn't hide them.
56. As a podcaster, I want the hook shown at the top for the first 3 seconds in a dark semi-transparent box, so that viewers are grabbed immediately.
57. As a podcaster, I want each clip exported as 1080×1920 H.264 with loudness-normalized audio and fast-start, so that it uploads cleanly and plays instantly.
58. As a podcaster, I want a poster image per clip, so that I can recognise clips at a glance.
59. As a podcaster, I want rendered clips listed by score with their AI analysis, so that I post the best first.
60. As a podcaster, I want to play and download each rendered clip from the browser, so that publishing is quick.

### Evaluation (selection quality gate)

61. As the owner, I want to record my past clips (episode URL, start, end, note, role "eval" or "fewshot") in a Reference Set file, so that the AI's picks can be measured against my real choices.
62. As the owner, I want Reference Set episodes marked "eval" kept separate from "fewshot" episodes, so that evaluation scores aren't inflated by the AI having seen the answers.
63. As the owner, I want one command that analyzes all eval episodes and reports recall, so that each prompt change is measured the same way.
64. As the owner, I want a top-5 report per eval episode (title, time range, reasoning, preview link), so that I can judge postability by hand.
65. As the owner, I want every eval run saved with the prompt version that produced it, so that I can compare iterations.
66. As the owner, I want a clear pass/fail against the gate (recall ≥ 60% and at least 3 of the top 5 postable), so that I know when selection is good enough to move on.
67. As the owner, I want an optional audio-signal mode that sends Candidate audio to the AI, so that if text-only selection fails the gate after about 5 iterations, laughter, tone, and energy can be added and re-tested.

### Interface

68. As a podcaster, I want a dark theme by default with a light theme available, so that the app is comfortable at any time.
69. As a podcaster, I want the app usable at phone width, so that I can check progress from my phone on the same network.
70. As a podcaster, I want animations to respect my reduced-motion setting, so that the interface stays comfortable.

### Setup and maintenance

71. As the owner, I want a single setup command that installs dependencies and downloads models and fonts, so that the project is easy to bootstrap.
72. As the owner, I want a single command to update the YouTube downloader, so that I can recover quickly when YouTube changes.
73. As the owner, I want a command-line way to run the analyze and render stages without the UI, so that the pipeline can be developed and debugged on its own.
74. As the owner, I want the install to exclude torch and other heavy ML frameworks, so that the environment stays small.

### Upload (Milestone 5)

75. As a podcaster, I want to upload a master file from my browser with a progress bar, so that I can clip episodes before or without YouTube.
76. As a podcaster, I want an uploaded file transcribed fully on my machine in the background, so that it reaches review without YouTube captions.

## Implementation Decisions

### Runtime and architecture
- **Environment.** Native macOS on Apple Silicon only. Python 3.12 managed by uv on the backend; a Vite + React 18 + TypeScript + Tailwind v4 frontend served by the backend.
- **Users and network.** Single user on localhost. No authentication.
- **Job execution.** One Job runs at a time; stages within a Job run strictly in sequence, so heavy tools never share RAM.
- **Out of v1.** Docker.
- **Persistence.** Each Job is stored as a directory with a JSON state file and per-stage artifacts. A Job resumes from its last completed stage. No database.
- **Configuration** comes from environment variables:
  - Gemini API key and model;
  - Whisper model;
  - ffmpeg binary path (must point at Homebrew `ffmpeg-full`, because the standard formula has dropped libass);
  - data directory;
  - optional "cookies from browser" for the downloader;
  - audio-signal flag for selection.
- **System prerequisites.** `ffmpeg-full` and `deno`, both via Homebrew.

### Job lifecycle (state machine)
- **Happy path:**
  1. `queued`
  2. `downloading`
  3. `transcribing`, which only does real work when no captions exist or the source was uploaded
  4. `analyzing`
  5. `review`
- **Rendering.** From `review`, approved Candidates enter a render queue. While renders are pending the Job shows `rendering`, and it returns to `review` when they finish. The Job never "completes" in a way that blocks further review or re-rendering.
- **Off-path states.**
  - `waiting_quota` can be entered from `analyzing`, and resumes automatically with backoff.
  - `error` can be entered from any stage. It records the stage and message, and can be retried from that stage.

### Modules
Each module is a deep module behind a small interface.

1. **Video Source (port).**
   - Interface: given a YouTube URL, produce a local video file, its metadata (duration, fps, width, height, codec), and the auto-caption track if one exists.
   - Download rules: at most 1080p, H.264 preferred, mp4 container. Captions are requested as Indonesian / original-language json3.
   - Implementation: yt-dlp with its default extras and Deno as the JS runtime. No cookies or PO-token provider by default; cookies-from-browser is an opt-in setting.
   - A second implementation for uploaded files arrives in Milestone 5. It returns the stored file and no captions.

2. **Transcript.** One normalized model, regardless of source:
   - language;
   - source (youtube or whisper);
   - ordered Words, each with text, start, and end;
   - Segments, used for display.

   YouTube json3 parsing rules:
   - a word's start = event start + per-word offset;
   - a word's end = the next word's start, capped by the event's end;
   - text is unpunctuated and mostly lowercase, and this is accepted.

3. **Transcriber (port).**
   - Interface: transcribe an audio range (or the whole file) in a given language, returning Words.
   - Implementation: mlx-whisper with the large-v3-turbo model, word timestamps on, conditioning on previous text off, Silero VAD run through onnxruntime.
   - A watchdog guards each chunk: a run that stalls past its time budget is retried once, then skipped with a warning recorded on the Job.
   - Used in two places: per approved clip at render time (clip range ±2 s), and for the full episode when no captions exist.
   - Measured on the target machine: about 1.9× realtime and 2.15 GB peak memory. One 5.5-minute run stalled, which is why the watchdog exists.

4. **LLM (port).**
   - Interface: two structured calls, Score and Detail, each returning a typed response validated against a schema.
   - Implementation: Gemini 3.8 Flash via the google-genai SDK, on the free tier, with exponential backoff.
   - Quota exhaustion moves the Job to `waiting_quota` instead of failing it.

5. **Selection.** Turns a Transcript, Channel Profile, Brief, and duration range into ranked Candidates.
   - **Windows.**
     - Window length is the larger of 90 s and 1.5× the maximum clip length, with 30 s overlap.
     - Window edges are snapped to Words.
   - **Score pass.**
     - Windows are sent in batches of 8 at temperature 0.2.
     - Each window gets a 0–100 score that uses the full range, based on a "2-second hook test".
   - **Shortlist** of about twice the target Candidate count.
   - **Detail pass.** Receives:
     - the full Transcript in a compact `[mm:ss] text` form;
     - the shortlisted windows;
     - the Channel Profile, the Brief, and few-shot examples.

     It returns, per Candidate:
     - start and end;
     - predicted score, hook strength, emotion, retention notes, and reason;
     - hook text (at most 2 lines, about 40 characters);
     - title;
     - TikTok, Instagram, and Shorts descriptions and hashtags, in the transcript's language.
   - **Target count:** at least 3, otherwise episode minutes ÷ 9, rounded.
   - **Post-processing:**
     - snap each Candidate to Words (search ±1.5 s, 0.35 s lead-in, 0.45 s tail);
     - remove overlaps;
     - enforce the duration range.
   - **Prompts** are adapted from openshorts' Score and Detail templates (MIT licence; a third-party notice is included). Temperatures are tuned during Milestone 2.
   - **Audio-signal mode** (off by default, behind a flag): the Detail pass also receives each shortlisted window's audio.

6. **Channel Profile.**
   - One global profile: niche, audience, clip style, things to avoid.
   - Few-shot examples are drawn from Reference Set entries with role "fewshot".

7. **Review operations.**
   - **Update a Candidate:** start and end (re-snapped to Words), hook text, layout override (Auto, Track, Split, or Blur), selected flag.
   - **Add a manual Candidate** from a transcript range. It is snapped, marked "manual", has no AI score, and appears in the list.
   - **Render the selected Candidates.** This queues them.
   - **Re-render** happens whenever a rendered Candidate's boundaries, hook, or layout change and it is rendered again.

8. **Scene Detector.**
   - Uses ffmpeg's scene-change filter over the clip range.
   - Scenes shorter than 1 s are merged into a neighbouring scene.

9. **Face Detector.**
   - MediaPipe Tasks Face Detector (BlazeFace short-range model, CPU), on frames decoded by ffmpeg at 640 px width, every 3rd frame.
   - MediaPipe 1.1.0 only offers the Tasks API.
   - MediaPipe brings `opencv-contrib-python`. No other OpenCV package may be installed.

10. **Render Planner** (pure; also the second test seam).
    - **Input:** the clip time range, source dimensions and fps, Scenes, face detections over time (boxes per sampled frame), caption Words, hook text, and layout override.
    - **Output:** a Render Plan, written to the Job's artifacts for inspection. It contains:
      - the Layout of each scene;
      - per panel, the crop path as a list of change points;
      - caption events (line text, timing, active-word highlight timing, position);
      - the hook event (text, 0–3 s, position).
    - **Layout per scene**, from 5 sampled frames:
      - 1 face → Track (full 9:16 crop);
      - 2 faces → Split (two 1080×960 panels stacked, left face on top, each panel with its own camera);
      - 3+ or 0 faces → Blur (wide shot centred over a blurred background).
      - A layout override replaces the automatic choice for every scene.
      - An already-vertical source is passed through.
    - **Speaker Tracker:**
      - a detection matches an existing face ID when centres are within 15% of frame width;
      - each ID's score = face area with 0.85 decay;
      - the current target gets a ×3 stickiness bonus;
      - switching target needs a 30-frame cooldown;
      - the tracker resets at each scene cut.
    - **Smooth Camera:**
      - a dead-zone of 25% of crop width;
      - a large jump is accepted only after 3 consecutive confirming detections;
      - motion is a critically damped spring (no overshoot);
      - the camera snaps to target at scene start;
      - positions are interpolated between detected frames;
      - the last position is held while the face is missing.
    - **Captions:**
      - lines of at most about 16 characters or 1.4 s, in UPPERCASE;
      - black outline, active word in `#FF9F0A`;
      - placed on the panel seam in Split and in the lower third in Track and Blur.
    - **Safe zones** for captions and hook: nothing in the top ~12%, bottom ~20%, or right ~12% of the frame.
    - **Hook:** at most 2 lines, at the top just below the safe zone, white Montserrat text in a dark semi-transparent box, shown 0–3 s.

11. **Renderer.**
    - Executes a Render Plan as a single ffmpeg process:
      - crop driven by runtime commands at the change points;
      - vertical stacking for Split;
      - a blurred background for Blur;
      - burned ASS subtitles using the bundled Montserrat ExtraBold font (OFL licence; SF Pro's licence forbids use in video).
    - Encoding: `h264_videotoolbox`, falling back to `libx264`.
    - Audio: AAC, loudness-normalized to −14 LUFS.
    - Output: fast-start MP4 at 1080×1920 plus a poster JPEG.

12. **HTTP API** (contract).
    - **Jobs**
      - Create a Job from a URL (Milestones 1–4) or a multipart upload (Milestone 5). Options: brief, min/max seconds, captions on/off, language.
      - List Jobs, and get one Job with its Candidates and Clips.
      - Server-sent events per Job, each carrying stage, percent, status, and message.
      - Delete a Job and its files.
    - **Candidates**
      - Update a Candidate.
      - Add a manual Candidate.
      - Render the selected Candidates.
    - **Profile:** get or put the Channel Profile.
    - **System:** get disk usage.
    - **Media:** serve files with HTTP range support, for in-browser preview and playback.

13. **Frontend.**
    - **Pages:**
      - Home: URL input, Brief, options, recent Jobs, disk meter;
      - Job: stage progress, then Review, then rendered Clips;
      - Channel Profile.
    - **Review** shows the Candidate list next to a preview player and a Transcript Picker.
    - **Candidate row:** score, hook editor, layout override, select toggle.
    - **Clip card:** 9:16 player, title, reasoning, copy-description buttons, download.
    - **Design tokens** (black, white, orange `#FF9F0A`; dark default, light alternative) are used from Milestone 3. Full Apple-style glass polish arrives in Milestone 6.
    - The UI may use the system font, since it runs locally. Video uses Montserrat.

14. **Evaluation Harness.**
    - **Reference Set entries:** episode URL, start, end, note, role ("eval" or "fewshot").
    - **Found:** a reference clip counts as found when some Candidate covers at least 50% of the reference clip's duration.
    - **Recall** = found ÷ total, over eval episodes.
    - **Report** per run: recall, plus a top-5 list per episode for manual judgement, saved with a prompt version identifier.
    - **Gate:** recall ≥ 60% and at least 3 of the top 5 judged postable.
    - **If the gate fails after about 5 prompt iterations:** enable audio-signal mode and re-test. If it still fails, proceed with the best version and record the result.

### Dependencies
- **Backend:**
  - web: FastAPI, uvicorn, python-multipart;
  - media and models: yt-dlp (default extras), mlx-whisper, onnxruntime, MediaPipe;
  - LLM: google-genai;
  - utilities: pydantic, numpy, python-dotenv, a YAML parser.
- **Excluding torch.**
  - mlx-whisper declares torch, but torch is only used by its model-conversion module. It is excluded through a uv dependency override.
  - numba and scipy stay, because word-timestamp alignment needs them.
  - Milestone 0 must verify that transcription works without torch installed.
- **Dropped from the original plan:** faster-whisper, PySceneDetect, opencv-python-headless.
- **Resolution check.** A dry-run resolution for Python 3.12 on arm64 succeeded without conflicts (numpy 2.5.x, MediaPipe 1.1.0, mlx-whisper 0.4.3).

### Milestones and exit criteria

| Milestone | Scope | Exit criteria |
|---|---|---|
| M0 | Scaffold: repository, environment, setup and update commands, model and font downloads, third-party notices | Setup succeeds; Whisper imports without torch; ffmpeg has subtitle and scene filters |
| M1 | Video Source (URL), Transcript, Transcriber, CLI analyze-to-transcript | A real podcast transcript is stored from both sources and resumable |
| M2 | Selection, Channel Profile, few-shot, Evaluation Harness | Gate passed, or the gate-failure procedure executed |
| M3 | HTTP API, queue, events, functional UI for Home, Review, and Profile | URL to Review works end-to-end in the browser |
| M4 | Scene Detector, Face Detector, Render Planner, Renderer, render queue, layout override | Clips render with Track, Split, and Blur layouts, captions, and hook |
| M5 | Upload source with streaming and progress, full local transcription | An uploaded Job reaches Review |
| M6 | Glass polish, light/dark themes, responsive layout, README | Dark, light, and phone-width screenshots |

## Testing Decisions

### What makes a good test
- It exercises behaviour through one of the two agreed seams and asserts only on externally observable results:
  - Job states and events;
  - Candidate and Clip data returned by the API;
  - the Render Plan;
  - properties of output files as reported by ffprobe.
- It never asserts on private helpers, internal call order, or intermediate data structures.
- Fakes exist only at external boundaries (the three ports). Everything inside, including real ffmpeg and real MediaPipe, runs for real.

### Seam A: Job lifecycle through the HTTP API (primary seam)
- **Fakes:**
  - Video Source returns a short fixture video (a few seconds, with 1-face and 2-face scenes) plus a fixture json3 caption track;
  - LLM returns recorded Score and Detail responses;
  - Transcriber returns canned Words.
- **Behaviour covered:**
  - creating a Job and the expected sequence of stage events;
  - reaching `review` with Candidates ranked by score;
  - Candidates snapped to word boundaries even when the recorded LLM response gives off-word times;
  - overlap removal;
  - duration bounds;
  - target count;
  - json3 parsing, observed through the Words the API returns;
  - updating boundaries (re-snapped), hook text, and layout override;
  - adding a manual Candidate;
  - rendering selected Candidates, with output checked by ffprobe (1080×1920, duration within range, audio stream present, poster exists);
  - re-rendering after an edit;
  - resuming after an injected failure without calling Video Source or Transcriber again;
  - a quota error from the LLM fake leading to `waiting_quota`, then recovery;
  - falling back to full transcription when the source has no captions;
  - deleting a Job removing its files;
  - the disk usage endpoint;
  - range requests on media.

### Seam B: Render Planner (pure)
Synthetic inputs (scene lists and face-detection tracks), no video. Behaviour covered:
- Layout choice for 0, 1, 2, and 3+ faces;
- layout override applied to every scene;
- vertical-source passthrough;
- merging scenes shorter than 1 s;
- Smooth Camera:
  - no per-frame jump above a set pixel limit;
  - no overshoot on a step change;
  - dead-zone suppresses small moves;
  - a single-frame outlier is ignored while 3 confirmations are accepted;
  - snap at scene start;
  - hold on face loss;
- Speaker Tracker stickiness and cooldown;
- Split panels ordered left face on top;
- caption line-length and duration limits;
- UPPERCASE text and active-word timing;
- caption position on the seam in Split and in the lower third otherwise;
- every caption and hook inside the safe zones;
- hook limited to 0–3 s and 2 lines.

### Not part of the test suite
- **The Evaluation Harness** is a quality-measurement tool. It runs against real Gemini and real YouTube and needs human judgement.
- **Manual smoke checks per milestone:**
  - fetching captions from a real public Indonesian podcast;
  - the Transcriber watchdog on 5–10 minutes of real audio;
  - visual frame checks of Track, Split, and Blur on real episodes;
  - browser walkthroughs of submit, progress, review, render, and download.

### Prior art
None. The repository is empty, so these seams set the pattern for later work.

## Out of Scope

- Docker or any containerised deployment.
- Multi-user use, authentication, and hosting on a server.
- Running more than one Job at a time.
- Posting to social platforms, dubbing, thumbnail studio, AI effects, billing, the cloud features, MCP, and Remotion rendering from openshorts.
- torch, YOLO, TransNetV2, or any other heavy ML framework.
- Manual caption-text editing and manual crop positioning (only the layout override is in scope).
- Active-speaker detection from mouth movement.
- Selectable caption style presets.
- Downloads above 1080p.
- Cookies or PO-token providers enabled by default.
- The Gemini paid tier.
- Pairing an uploaded master file with YouTube captions (offset alignment). Uploads are always transcribed locally in full.
- Editing AI-generated titles and descriptions in the UI. They are copy-only in v1.
- Platforms other than macOS on Apple Silicon.

## Further Notes

- **Vocabulary**, to be used consistently in code, UI copy, and tickets:
  - **Job:** one episode being processed.
  - **Source:** the episode video.
  - **Transcript / Words:** the normalized text with per-word timing.
  - **Window:** a transcript slice scored by the AI.
  - **Candidate:** a proposed clip awaiting review.
  - **Clip:** a rendered output.
  - **Channel Profile** and **Brief:** standing and per-Job steering.
  - **Reference Set:** past clips used for evaluation and few-shot examples.
  - **Layout:** Track, Split, or Blur.
  - **Scene:** a shot between cuts.
  - **Render Plan:** the planner's output.
  - **Hook:** the opening overlay text.
- **Facts verified during planning (2026-10-13):**
  - YouTube Indonesian auto-captions in json3 carry per-word start offsets, and downloading them works today.
  - Homebrew's standard ffmpeg lacks libass; `ffmpeg-full` includes libass, fontconfig, freetype, harfbuzz, videotoolbox, and the scene filter.
  - MediaPipe 1.1.0 is Tasks-only and depends on `opencv-contrib-python`.
  - On the Gemini free tier, prompts and responses are used by Google and may be read by human reviewers. The owner has accepted this.
- **Before Milestone 0, the owner provides:**
  - a Gemini API key;
  - the Reference Set (2–3 eval episodes plus a few fewshot episodes, all published on YouTube);
  - approval to install `ffmpeg-full` and `deno` via Homebrew.
- **Test fixtures need real faces.** MediaPipe needs real faces to detect, so the fixture video should be a few seconds cut from the owner's own podcast (one close-up scene and one two-person wide scene). Fixtures must stay small.
- **Defaults chosen during spec-writing (not discussed explicitly; revisit if wrong):**
  - the definition of "found" as covering ≥50% of the reference clip's duration;
  - manual Candidates have no AI score and no generated metadata;
  - AI titles and descriptions are copy-only;
  - the watchdog retries a stalled chunk once, then skips it.
- **Memory on the 8 GB machine** is tight (about 5 GB of swap in use with a browser and editor open). A full-episode transcription should show a hint to close heavy apps.
