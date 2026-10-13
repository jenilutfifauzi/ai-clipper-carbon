UV := uv --directory backend
NPM := npm --prefix frontend
FFMPEG_FULL := /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg

.PHONY: setup prerequisites check-ffmpeg dev build test test-whisper analyze reanalyze retry eval gate update-ytdlp

# Install backend and frontend dependencies, download models and font, check ffmpeg.
setup: prerequisites
	$(UV) sync
	$(NPM) ci
	$(UV) run python scripts/download_assets.py
	$(UV) run python scripts/check_ffmpeg.py

prerequisites:
	@command -v uv >/dev/null || { echo "uv is missing: https://docs.astral.sh/uv/getting-started/installation/"; exit 1; }
	@command -v npm >/dev/null || { echo "Node.js (20.19+ or 22.12+, with npm) is missing: https://nodejs.org/"; exit 1; }
	@missing=""; \
	[ -x "$(FFMPEG_FULL)" ] || missing="$$missing ffmpeg-full"; \
	command -v deno >/dev/null || missing="$$missing deno"; \
	if [ -n "$$missing" ]; then \
		echo "Missing Homebrew packages:$$missing"; \
		echo "Install them with: brew install ffmpeg-full deno"; \
		exit 1; \
	fi

# Report whether the configured ffmpeg has the ass and scdet filters and h264_videotoolbox.
check-ffmpeg:
	@$(UV) run python scripts/check_ffmpeg.py

# Run the backend (http://127.0.0.1:8000, reloading on change) and the Vite dev server
# (http://localhost:5173, which proxies /api and /media to the backend) together. Ctrl-C stops both.
dev:
	@trap 'kill 0' INT TERM; \
	$(UV) run uvicorn --factory app.main:create_app --reload & \
	$(NPM) run dev & \
	wait

# Build the frontend into frontend/dist. The backend serves it at http://127.0.0.1:8000 when it exists.
build:
	$(NPM) run build

test:
	$(UV) run pytest

# Transcribe generated speech with the real Whisper model (slow, ~2 GB RAM).
test-whisper:
	$(UV) run pytest -m whisper

# Download a YouTube episode, build its Transcript and select Candidates, without the UI: make analyze URL=...
# Extra CLI options go in ARGS, e.g. ARGS=--transcribe-locally to ignore YouTube's captions,
# or ARGS='--brief "find the funny moments"' to steer Selection for this episode.
analyze:
	@[ -n "$(URL)" ] || { echo "Usage: make analyze URL=<youtube-url> [ARGS=--transcribe-locally]"; exit 1; }
	$(UV) run python -m app.cli analyze "$(URL)" $(ARGS)

# Select Candidates again from an existing Job's Transcript (no download), e.g. after a prompt change.
# Replaces the Job's Candidates, except those edited, selected or added in review: make reanalyze JOB=<job-id>
reanalyze:
	@[ -n "$(JOB)" ] || { echo "Usage: make reanalyze JOB=<job-id>"; exit 1; }
	$(UV) run python -m app.cli reanalyze "$(JOB)"

# Resume a Job that failed, was interrupted or is waiting for Gemini's quota, from the stage it
# stopped in, without the UI: make retry JOB=<job-id>
retry:
	@[ -n "$(JOB)" ] || { echo "Usage: make retry JOB=<job-id>"; exit 1; }
	$(UV) run python -m app.cli retry "$(JOB)"

# Measure Selection against the Reference Set in eval/references.yaml (format: eval/references.example.yaml).
# Selects Candidates for every eval episode with the current prompts, reusing Jobs that already have
# the episode's Transcript, and writes a new report to eval/reports/<prompt version>/<UTC time>/.
eval:
	$(UV) run python -m app.cli eval

# Check an eval report against the gate once its postable.yaml is filled in (default: the newest report):
# make gate [REPORT=eval/reports/v1/2026-10-13T14-30-00Z]
gate:
	$(UV) run python -m app.cli gate $(if $(REPORT),"$(abspath $(REPORT))")

# Upgrade yt-dlp (and its pinned extras) in uv.lock and the environment.
update-ytdlp:
	$(UV) sync --upgrade-package yt-dlp
	$(UV) run yt-dlp --version
