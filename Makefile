UV := uv --directory backend
FFMPEG_FULL := /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg

.PHONY: setup prerequisites check-ffmpeg dev test test-whisper analyze reanalyze update-ytdlp

# Install backend dependencies, download models and font, check ffmpeg.
setup: prerequisites
	$(UV) sync
	$(UV) run python scripts/download_assets.py
	$(UV) run python scripts/check_ffmpeg.py

prerequisites:
	@command -v uv >/dev/null || { echo "uv is missing: https://docs.astral.sh/uv/getting-started/installation/"; exit 1; }
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

dev:
	$(UV) run uvicorn --factory app.main:create_app --reload

test:
	$(UV) run pytest

# Transcribe generated speech with the real Whisper model (slow, ~2 GB RAM).
test-whisper:
	$(UV) run pytest -m whisper

# Download a YouTube episode, build its Transcript and select Candidates, without the UI: make analyze URL=...
# Extra CLI options go in ARGS, e.g. ARGS=--transcribe-locally to ignore YouTube's captions.
analyze:
	@[ -n "$(URL)" ] || { echo "Usage: make analyze URL=<youtube-url> [ARGS=--transcribe-locally]"; exit 1; }
	$(UV) run python -m app.cli analyze "$(URL)" $(ARGS)

# Select Candidates again from an existing Job's Transcript (no download), e.g. after a prompt change.
# Replaces the Job's Candidates: make reanalyze JOB=<job-id>
reanalyze:
	@[ -n "$(JOB)" ] || { echo "Usage: make reanalyze JOB=<job-id>"; exit 1; }
	$(UV) run python -m app.cli reanalyze "$(JOB)"

# Upgrade yt-dlp (and its pinned extras) in uv.lock and the environment.
update-ytdlp:
	$(UV) sync --upgrade-package yt-dlp
	$(UV) run yt-dlp --version
