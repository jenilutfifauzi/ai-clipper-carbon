# AI Clipper

A local macOS app that turns a long podcast episode into short vertical clips. Give it a YouTube URL
or upload the master file. It builds a word-level transcript (YouTube's captions, or Whisper on your
Mac), and an LLM proposes Candidates: the moments most likely to work as Shorts, Reels or TikToks.
You review them in the browser, in a clip editor with a live 9:16 preview: trim on a timeline or
word by word, correct the captions, style them from presets, time and animate the hook, pick a
layout per scene, or add your own clip. Then it renders each selected Candidate as a 1080×1920 Clip
with a speaker-tracking crop, burned captions and the hook.

Everything except the LLM call runs on your machine. The plan and design notes are in
[`docs/PLAN.md`](docs/PLAN.md). The spec (`spec.md`, which defines terms such as Job, Candidate, Clip
and Reference Set) and one file per ticket are in `.scratch/ai-clipper-v1/`.

## Prerequisites

- **A Mac with Apple Silicon.** Whisper runs on MLX, and Clips are encoded with VideoToolbox.
  8 GB of memory is enough (see [Memory on an 8 GB Mac](#memory-on-an-8-gb-mac)).
- **Homebrew packages:** `brew install ffmpeg-full deno`
  - `ffmpeg-full`, not `ffmpeg`. The standard formula has had no libass (burned captions) since
    January 2026. `ffmpeg-full` is keg-only, so the app points at
    `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` (`FFMPEG_BIN` in `.env`).
  - `deno` is what yt-dlp uses to solve YouTube's JavaScript challenges.
- **[uv](https://docs.astral.sh/uv/getting-started/installation/)** for Python. It installs
  Python 3.12 itself.
- **Node.js 22** (22.12 or later; 20.19+ also works) with npm, for the frontend.

## Setup

```sh
git clone <this repo> ai-clipper && cd ai-clipper
make setup        # Python and npm dependencies, the face model, the caption fonts, an ffmpeg check
cp .env.example .env
```

`make setup` stops with an install hint if uv, npm, `ffmpeg-full` or deno is missing. The Whisper
model (about 1.6 GB) is downloaded from Hugging Face the first time something is transcribed.
Run `make check-ffmpeg` at any time to confirm the `ass` and `scdet` filters and `h264_videotoolbox`.

### `.env`

`.env.example` documents every setting. The ones that matter:

| Setting | What it does |
|---|---|
| `LLM_PROVIDER` | `gemini` (Google's API) or `openai` (any OpenAI-compatible Chat Completions API, DeepSeek by default). |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | For `gemini`. A free-tier key comes from https://aistudio.google.com/apikey. |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | For `openai`. A DeepSeek key comes from https://platform.deepseek.com/api_keys. |
| `LLM_THINKING` | DeepSeek only, `enabled` or `disabled`. Thinking is slower and billed as output; compare with `make eval`. |
| `LLM_REQUEST_INTERVAL_SECS` | The minimum gap between two LLM requests. Empty means 13 s for Gemini and 1 s for `openai`. |
| `WHISPER_MODEL` | The mlx-whisper model for local transcription. |
| `DATA_DIR` | Where Jobs live (default `./data`). |
| `YTDLP_COOKIES_FROM_BROWSER` | A browser (`chrome`, `safari`, `firefox`) to borrow YouTube cookies from when downloads fail with 403. |
| `SELECTION_AUDIO_SIGNAL` | `true` also sends each shortlisted Window's audio to Gemini (needs `LLM_PROVIDER=gemini`). |

**Which LLM.**
- **Gemini's free tier** allows 5 requests a minute, which the 13 s pacing keeps under. It also
  allows only about **20 requests a day** per model. One episode takes one Score request per 8
  Windows plus one Detail request: a 40-minute episode uses about 4, and a 3-hour one about 14.
  So a day on the free tier covers a few episodes, or one `make eval` over a small Reference Set.
- **DeepSeek** (`LLM_PROVIDER=openai`) is paid but cheap, has no daily cap, and runs at 1 s pacing.
  Each eval report records which provider ran, so running `make eval` once per provider compares them.

When the quota runs out or the provider is overloaded (429 or 503), a Job doesn't fail. It moves to
**Waiting for quota**, shows when it will try again, and resumes by itself. The wait starts at 60 s
and doubles up to 15 minutes, or follows the wait the error suggests. Other Jobs run meanwhile. A Job
gives up only after 24 hours of this, which takes in a daily-quota reset.

## Running

```sh
make dev     # backend on http://127.0.0.1:8000 (reloads on change) + Vite on http://localhost:5173
```

Open **http://localhost:5173**. Ctrl-C stops both servers.

```sh
make build   # builds frontend/dist; the backend then serves the app itself at http://127.0.0.1:8000
```

With a build, `cd backend && uv run uvicorn --factory app.main:create_app` serves everything on
port 8000, without Vite.

**From your phone**, on the same network: build first, then start the backend with
`--host 0.0.0.0` added, and open `http://<your Mac's IP>:8000`. The app has no login, so anyone on
the network can use it while it listens there. Over plain http the browser has no Clipboard API,
so the copy buttons fall back to the older `execCommand("copy")`.

## Daily workflow

1. **Start a Job** on Home. Paste a YouTube URL, or choose **Upload a file** and drop the master
   (MP4 or MOV in H.264, HEVC or ProRes, or anything ffmpeg reads). You can add a **Brief**, such as
   "find the funny moments", and set the clip length range, the language and captions.
2. **Watch it progress.** The Job page shows each stage live: Download (or Upload), Transcript,
   Analyze, then Review. With YouTube captions the transcript is instant. An upload, or a video
   without captions, is transcribed by Whisper on your Mac, at about 1–2× realtime on an M1.
3. **Review the Candidates.** The list is ranked by predicted score. Open one to edit it:
   - **Preview.** The Clip as it will look, with its captions and hook drawn live over the framed
     video (**Source** shows the episode instead). Until the clip is prepared, the preview uses the
     episode transcript and one scene. **Prepare clip** transcribes and analyses it, as a render
     would.
   - **Text.** Click a caption word to correct it, remove it, or start a new line there.
   - **Style.** Pick a style preset (Default, Yellow pop, Box highlight, Minimal, or your own) and
     change any of it for this clip:
     - captions: font, size, colours, outline, shadow, highlight, position, case, and how lines break;
     - the hook's look and animation.

     **Save as new** keeps the look as a preset for every Job.
   - **Hook.** The text (it says whether it fits on 2 lines), when it comes on and how long it stays.
   - **Clip.** The clip's layout (Auto, Track, Split or Blur), and the transcript: click words to set
     the start or end, or to mark a new clip.
   - **Timeline.** Drag the clip's edges (they snap to words), click a caption line to edit it,
     drag or resize the hook, and click a scene to give it its own layout.
   - Switch on **Render this clip**.

   Every change is saved as you make it. Below the editor are the AI's reasons and the posting
   copy, each with a copy button.
4. **Render.** Click **Render selected**. Clips render one at a time while you keep reviewing. Each
   Clip card has the 9:16 player, the title and reason, a **Download** button and copy buttons for
   the title and the TikTok, Instagram and Shorts descriptions. A Candidate edited after its render
   shows **Render again**.

The header's sun/moon button switches between light and dark. The app follows your system until you
pick one, and your choice is remembered in this browser.

**Channel Profile.** One profile (niche, audience, clip style, things to avoid) steers every new
Job's selection. It has no page yet. Read it with `curl localhost:8000/api/profile`, and set it with:

```sh
curl -X PUT localhost:8000/api/profile -H 'content-type: application/json' \
  -d '{"niche": "business podcasts", "audience": "...", "clip_style": "...", "avoid": "..."}'
```

## Using with Claude Code (MCP)

The backend is also an MCP server, at `http://127.0.0.1:8000/mcp`, so an agent such as Claude Code
can do everything the app does: start Jobs (from a YouTube URL or a file on your Mac), wait for them,
read the Transcript, pick and edit Candidates (hook, Kicker, layout, style, Text Layers, music,
Overlays, Segments, Transitions, Word Edits), render, and hand you the Clips' file paths.

With the backend running (`make dev`), Claude Code started in this repo finds it through `.mcp.json`
and asks once to use it. From anywhere else, add it with:

```sh
claude mcp add --transport http ai-clipper http://127.0.0.1:8000/mcp
```

Then ask, for example: "Make three clips from <url> about money, each with a Title, and render
them." The server's instructions tell the agent the workflow and the app's words (`GLOSSARY.md` is
its `ai-clipper://glossary` resource). Its edits show in the open browser as they are saved; an edit
made in the browser at the same moment can be saved over, and the other way round.

It answers only on localhost (other Hosts are refused) and, like the API, has no login. Its tools
read the files you name by path, as you could.

## Command line

The pipeline runs without the UI too. Each command prints progress and exits non-zero on failure.

| Command | What it does |
|---|---|
| `make analyze URL=<youtube-url>` | Download, transcribe and select Candidates. `ARGS=--transcribe-locally` ignores YouTube's captions; `ARGS='--brief "find the funny moments"'` adds a Brief. |
| `make reanalyze JOB=<job-id>` | Select Candidates again from the Job's Transcript (no download), after a prompt or profile change. It keeps Candidates you edited, selected or added. |
| `make retry JOB=<job-id>` | Resume a failed, interrupted or quota-waiting Job from the stage it stopped in. |
| `make render JOB=<job-id> [CANDIDATES="<id> …"]` | Render Clips, by default of the selected Candidates. It prints duration, render time, encoder and size per Clip. |
| `make test` | The backend test suite. `make test-whisper` adds the slow real-Whisper test. |

Job ids are the folder names in `data/jobs/`, and appear in the Job page's URL.

## Measuring selection: the Reference Set and the gate

Prompt changes are measured against clips you actually posted, not judged by eye.

1. **Write the Reference Set.** Copy `eval/references.example.yaml` to `eval/references.yaml` and
   list clips you posted from past episodes, with `url`, `start`, `end`, `note` and `role`:
   - `role: eval` clips are what the AI is scored on. List every clip you posted from those episodes.
   - `role: fewshot` clips, from other episodes, are shown to the AI as examples of your taste.

   An episode has one role only. Aim for 2–3 eval episodes plus a few fewshot ones. The file is
   committed, so each report can be traced to what it measured.
2. **Run `make eval`.** It selects Candidates for each eval episode with the current prompts,
   reusing a Job that already has the episode's Transcript. A reference counts as **found** when one
   Candidate covers at least half of it. The report goes to
   `eval/reports/<prompt version>/<UTC time>/`:
   - `report.md`: recall, each reference found or missed, and the top 5 per episode with links;
   - `report.json`: the same data, plus every Candidate;
   - `postable.yaml`: for you to fill in.
3. **Judge the top 5.** Watch each eval episode's top 5 in `report.md`, and write in
   `postable.yaml` how many you would post (0–5).
4. **Run `make gate`** (the newest report; or `make gate REPORT=eval/reports/v3/<time>`). The gate
   passes at recall ≥ 60% with at least 3 of the top 5 postable on every eval episode.

To iterate, change `backend/app/prompts.py`, bump `PROMPT_VERSION`, then run `make eval` and
`make gate` again. Reports are committed next to the change that produced them. If the gate still
fails after about 5 iterations, try `SELECTION_AUDIO_SIGNAL=true` (with `LLM_PROVIDER=gemini`). It
sends each shortlisted Window's audio to Gemini's Detail pass, so it can hear laughter, tone, energy
and pacing. Its reports go under `eval/reports/<version>-audio/`, and each one is compared with the
best text-only report (in `report.md` and in `make gate`'s output). On a long episode the audio
adds about 32 tokens a second, so a paid Gemini tier is the practical choice. Ticket 08 (`.scratch/ai-clipper-v1/issues/08-selection-gate.md`)
records the iterations so far.

## Troubleshooting

- **YouTube downloads fail** (403, "Sign in to confirm", a format or extraction error): YouTube
  changed something. Run `make update-ytdlp`, which upgrades yt-dlp in the lock file and the
  environment. Then click **Retry** on the Job, or run `make retry JOB=…`. If 403s continue, set
  `YTDLP_COOKIES_FROM_BROWSER=chrome` (or your browser) in `.env`.
- **"Waiting for quota"** or 503/429 messages: nothing to do, the Job resumes by itself. On Gemini's
  free tier, the daily cap may mean the next attempt is tomorrow. Switch to DeepSeek to continue now.
  The Job keeps the Windows it already scored.
- **A Job failed**: its page shows the error and **Retry from <stage>**. Earlier stages are kept,
  so a retry never downloads or transcribes again unnecessarily.
- **`make dev` exits at start**: usually a port in use. Check with `lsof -i :8000 -i :5173`. If one
  server dies at start, the other keeps running until Ctrl-C.
- **No burned captions, or an ffmpeg error about `ass`**: `FFMPEG_BIN` points at an ffmpeg without
  libass. Install `ffmpeg-full` and run `make check-ffmpeg`.
- **An uploaded file plays as "Preparing file" for a while**: a master the browser can't play
  (ProRes, HEVC, PCM audio, MKV, …) gets a 720p preview copy first. Rendering still uses the master.

### Memory on an 8 GB Mac

- **Close Chrome (and other heavy apps) during full transcription.** Whisper large-v3-turbo needs
  about 2 GB on top of the app. With a browser full of tabs, the Mac swaps, and transcription drops
  from about 2× realtime to 1× or slower. Follow progress from Safari or your phone instead.
- Only one heavy step runs at a time: downloads, transcription and renders share a single worker
  queue. So starting several Jobs is fine; they wait their turn.
- Rendering is light (ffmpeg uses about 300 MB), and it is fine to keep reviewing while it runs.
- Disk: about 0.9 MB per second of Clip, plus the source video per Job. The disk meter on Home warns
  below 10 GB free. Delete Jobs you're done with.

## Where data lives

```
data/                        DATA_DIR, git-ignored
  profile.json               the Channel Profile
  presets.json               your style presets (the built-in ones are in the code)
  uploads/                   uploads in progress (cleared at start)
  jobs/<job-id>/
    job.json                 status, options, history, Source metadata
    source.mp4 | master.*    the downloaded video, or the uploaded master
    preview.mp4              a browser-playable copy, for uploads that need one
    transcript.json          word-level Transcript
    selection.json           the LLM run: Window scores, shortlist, raw answers
    candidates.json          the Candidates, with your review edits
    words/, analysis/        per-clip Whisper words and scene/face analysis, cached for re-renders
    clips.json, clips/       the Clips (<id>.mp4, poster <id>.jpg, the Render Plan <id>.plan.json)
eval/references.yaml         your Reference Set (committed)
eval/reports/                eval reports and postable judgements (committed)
backend/models/, backend/assets/fonts/
                             face model and caption fonts from `make setup` (git-ignored)
~/.cache/huggingface/        the Whisper model
```

Deleting a Job (the trash button on Home) removes its folder. Nothing else outside `DATA_DIR` is
written per Job.
