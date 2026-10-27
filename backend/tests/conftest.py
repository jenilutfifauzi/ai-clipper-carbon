import json
import subprocess
import sys
import time
import wave
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import emoji
from app.config import QuotaTuning, SelectionTuning, Settings, TranscriptionTuning, load_settings
from app.main import create_app
from app.ports import Ports
from app.transcript import Word
from emojifiles import write_emoji_images
from fakes import FakeLlm, FakeTranscriber, FakeVideoSource

FIXTURES = Path(__file__).parent / "fixtures"

# Phrases spoken into the speech fixture, each starting at its slot and followed by a pause of
# at least a second. Tests chunk it every ~3.5 s, which lands inside the second and third phrases,
# so the chunks only avoid cutting words if they end in the pauses.
PHRASES = [(0.5, "halo semua"), (3.0, "apa kabar hari ini"), (5.5, "terima kasih banyak")]
SPEECH_SECS = 8.0
TUNING = TranscriptionTuning(chunk_secs=3.5, cut_search_secs=1.5, budget_secs=5, budget_factor=0)
SELECTION = SelectionTuning(llm_retry_secs=0.001)
# No pacing; quota waits of 0.05 s doubling to at most 0.2 s, and 0.01 s on top of a suggested wait.
QUOTA = QuotaTuning(request_interval_secs=0, wait_secs=0.05, max_wait_secs=0.2, retry_margin_secs=0.01, give_up_secs=30)

# The episode for Selection tests: 62 minutes, so the Detail prompt also shows h:mm:ss labels, with a
# 6-Word caption line every 4 s. Each Word lasts 0.5 s and each line ends in 1 s of silence, so line
# k starts at 4k s, its Words start at 4k, 4k + 0.5, ... and end at 4k + 0.5, ..., 4k + 3.
EPISODE_SECS = 62 * 60
LINE_SECS = 4
FILLER = [
    "iya bener banget sih menurut gue",
    "jadi waktu itu kita lagi ngobrol",
    "terus abis itu ya udah gitu",
    "nah itu yang bikin seru sih",
    "kalau dipikir pikir emang aneh ya",
    "oke kita lanjut ke topik berikutnya",
]
# Lines a Score pass would notice, by line number.
MOMENTS = {
    180: "gue pernah rugi lima ratus juta",
    495: "ternyata rahasia sukses dia cuma satu",
    770: "jujur waktu itu gue nangis banget",
}


@dataclass(frozen=True)
class Episode:
    video: Path
    captions: Path


@dataclass(frozen=True)
class Speech:
    video: Path
    # The spoken words, each phrase's span shared out evenly between its words.
    words: list[Word]


@pytest.fixture(scope="session", autouse=True)
def emoji_images(tmp_path_factory) -> Iterator[Path]:
    """Text Layers draw emoji from the stand-ins of emojifiles.py, not from `make setup`'s images."""
    with pytest.MonkeyPatch.context() as patch:
        folder = write_emoji_images(tmp_path_factory.mktemp("emoji"))
        patch.setattr(emoji, "images_dir", folder)
        yield folder


@pytest.fixture
def settings(tmp_path, request) -> Settings:
    """Settings for a test, with the Gemini provider whatever .env says; `@pytest.mark.tuning(...)`
    overrides fields of TUNING, and `@pytest.mark.quota(...)` fields of QUOTA. The Reference Set is
    `tmp_path / "references.yaml"`, which doesn't exist until the test writes it."""
    marker = request.node.get_closest_marker("tuning")
    tuning = replace(TUNING, **marker.kwargs) if marker else TUNING
    marker = request.node.get_closest_marker("quota")
    quota = replace(QUOTA, **marker.kwargs) if marker else QUOTA
    return replace(
        load_settings(),
        llm_provider="gemini",
        data_dir=tmp_path / "data",
        reference_set=tmp_path / "references.yaml",
        transcription=tuning,
        selection=SELECTION,
        quota=quota,
    )


@pytest.fixture(scope="session")
def fixture_video(tmp_path_factory) -> Path:
    """A 2-second 320x180, 25 fps H.264 test pattern with a sine tone."""
    path = tmp_path_factory.mktemp("fixtures") / "source.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=440",
        "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(path),
    ]
    subprocess.run(command, check=True)
    return path


def say(text: str, path: Path, rate: int) -> None:
    """`text` spoken in Indonesian into a mono 16-bit WAV at `rate`: macOS `say`, or espeak-ng (`apt install espeak-ng`)."""
    if sys.platform == "darwin":
        subprocess.run(
            ["say", "-v", "Damayanti", "-o", str(path), "--file-format=WAVE", f"--data-format=LEI16@{rate}", text],
            check=True,
        )
        return
    raw = path.with_suffix(".espeak.wav")
    subprocess.run(["espeak-ng", "-v", "id", "-w", str(raw), text], check=True)
    ffmpeg = [str(load_settings().ffmpeg_bin), "-v", "error", "-y", "-i", str(raw), "-ar", str(rate), "-ac", "1", "-c:a", "pcm_s16le", str(path)]
    subprocess.run(ffmpeg, check=True)


@pytest.fixture(scope="session")
def speech(tmp_path_factory) -> Speech:
    """An 8-second test pattern with the PHRASES spoken by macOS `say` (trimmed of silence) in their slots."""
    folder = tmp_path_factory.mktemp("speech")
    rate = 16000
    spoken = [folder / f"phrase{i}.wav" for i in range(len(PHRASES))]
    for path, (_, text) in zip(spoken, PHRASES):
        say(text, path, rate)

    audio = np.zeros(int(SPEECH_SECS * rate), dtype=np.int16)
    words = []
    for path, (start, text) in zip(spoken, PHRASES):
        with wave.open(str(path)) as wav:
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
        loud = np.flatnonzero(np.abs(samples) > 300)
        samples = samples[loud[0] : loud[-1] + 1]
        at = int(start * rate)
        audio[at : at + len(samples)] = samples
        texts = text.split()
        step = len(samples) / rate / len(texts)
        words += [Word(t, round(start + i * step, 3), round(start + (i + 1) * step, 3)) for i, t in enumerate(texts)]

    track = folder / "speech.wav"
    with wave.open(str(track), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(audio.tobytes())
    video = folder / "speech.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-i", str(track),
        "-t", str(SPEECH_SECS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(video),
    ]
    subprocess.run(command, check=True)
    return Speech(video, words)


def caption_track(path: Path, lines: list[tuple[float, str]]) -> Path:
    """Write a json3 track with a 3-second caption event per (start, text) line, its Words 0.5 s apart."""
    events = []
    for start, text in lines:
        words = text.split()
        segs = [{"utf8": words[0]}] + [{"utf8": f" {word}", "tOffsetMs": 500 * i} for i, word in enumerate(words) if i]
        events.append({"tStartMs": round(1000 * start), "dDurationMs": 3000, "segs": segs})
    path.write_text(json.dumps({"events": events}))
    return path


@pytest.fixture(scope="session")
def episode(tmp_path_factory) -> Episode:
    """The 62-minute episode: a 16x16, 1 fps black video and its json3 caption track."""
    folder = tmp_path_factory.mktemp("episode")
    lines = [(LINE_SECS * k, MOMENTS.get(k, FILLER[k % len(FILLER)])) for k in range(EPISODE_SECS // LINE_SECS)]
    captions = caption_track(folder / "episode.json3", lines)
    video = folder / "episode.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "color=c=black:s=16x16:r=1",
        "-t", str(EPISODE_SECS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(video),
    ]
    subprocess.run(command, check=True)
    return Episode(video, captions)


@pytest.fixture
def from_episode(video_source, episode) -> None:
    """The Video Source returns the 62-minute episode."""
    video_source.video = episode.video
    video_source.caption_track = episode.captions


@pytest.fixture
def video_source(settings, fixture_video) -> FakeVideoSource:
    return FakeVideoSource(fixture_video, FIXTURES / "captions.json3", settings.ffprobe_bin)


@pytest.fixture
def transcriber(speech) -> FakeTranscriber:
    return FakeTranscriber(speech.words)


@pytest.fixture
def llm() -> FakeLlm:
    return FakeLlm()


@pytest.fixture
def client(settings, video_source, transcriber, llm):
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as client:
        try:
            yield client
        finally:
            video_source.release()
            transcriber.release()
            transcriber.stop()


def cue_text(cue: dict) -> str:
    """What a Cue of a plan's JSON shows: its lines, one under the other."""
    return "\n".join(" ".join(word["text"] for word in line) for line in cue["lines"])


def cue_words(cue: dict) -> list[dict]:
    """The Words of a Cue of a plan's JSON, line after line."""
    return [word for line in cue["lines"] for word in line]


def wait_for(client: TestClient, job_id: str, *statuses: str, timeout: float = 5) -> dict:
    """Poll the API until the Job reaches one of `statuses`, and return it."""
    deadline = time.monotonic() + timeout
    while (job := client.get(f"/api/jobs/{job_id}").json())["status"] not in statuses:
        assert time.monotonic() < deadline, f"Job stayed {job['status']}, expected one of {statuses}"
        time.sleep(0.01)
    return job


@pytest.fixture
def wait_for_status(client) -> Callable[..., dict]:
    """`wait_for` on the `client` app."""
    return lambda job_id, *statuses, timeout=5: wait_for(client, job_id, *statuses, timeout=timeout)


# Off the Mac these are known to differ with the ffmpeg that distros ship (6.1 on Ubuntu 24.04; the Mac's is
# newer): pixel values a few levels off (a PNG's range, a blend or a grade), a frame more or fewer in a
# retimed copy, and render-time budgets set on a faster machine. xfail, not skip, so that a host where they
# pass says so (non-strict).
LINUX_KNOWN_DIFFERENCES = {
    "test_overlay_blend_modes.py::test_a_half_transparent_multiply_overlay_counts_the_frame_beneath_once": "blend rounding",
    "test_overlay_grades.py::test_an_overlays_grade_changes_its_picture_but_not_its_border_nor_the_segment_under_it": "grade rounding",
    "test_segment_backgrounds.py::test_an_image_of_another_aspect_covers_the_frame_behind_a_cut_out_segment": "a PNG's colour range",
    "test_background_removal.py::test_a_cut_out_segment_under_a_transition_keeps_its_timing": "a frame more in a transition",
    "test_render.py::test_a_cue_placed_and_scaled_alone_is_burned_at_its_place_and_the_next_at_the_styles": "libass rendering",
    "test_retimed_copies.py::test_at_4x_the_render_shows_the_same_frames_as_the_preview_copy": "frames of a retimed copy",
    "test_reversed_source_segments.py::test_a_split_scene_renders_both_panels_backwards_and_in_step_from_the_sources_copy": "frames of a reversed copy",
    "test_transitions.py::test_a_join_of_each_new_look_renders_within_its_budget_of_a_fade": "a render-time budget",
    "test_resilience.py::test_other_jobs_run_while_a_job_waits_for_quota": "timing on a loaded host",
    "test_resilience.py::test_quota_errors_that_go_on_too_long_put_the_job_in_error": "timing on a loaded host",
}


def pytest_collection_modifyitems(config, items):
    if sys.platform == "darwin":
        return
    for item in items:
        reason = LINUX_KNOWN_DIFFERENCES.get(f"{item.path.name}::{item.name}")
        if reason:
            item.add_marker(pytest.mark.xfail(reason=f"known difference off the Mac, with the distro's ffmpeg: {reason}", strict=False))
