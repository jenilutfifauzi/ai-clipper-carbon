import json
import subprocess
import time
import wave
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import QuotaTuning, SelectionTuning, Settings, TranscriptionTuning, load_settings
from app.main import create_app
from app.ports import Ports
from app.transcript import Word
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


@pytest.fixture
def settings(tmp_path, request) -> Settings:
    """Settings for a test; `@pytest.mark.tuning(...)` overrides fields of TUNING, and
    `@pytest.mark.quota(...)` fields of QUOTA. The Reference Set is `tmp_path / "references.yaml"`,
    which doesn't exist until the test writes it."""
    marker = request.node.get_closest_marker("tuning")
    tuning = replace(TUNING, **marker.kwargs) if marker else TUNING
    marker = request.node.get_closest_marker("quota")
    quota = replace(QUOTA, **marker.kwargs) if marker else QUOTA
    return replace(
        load_settings(),
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


@pytest.fixture(scope="session")
def speech(tmp_path_factory) -> Speech:
    """An 8-second test pattern with the PHRASES spoken by macOS `say` (trimmed of silence) in their slots."""
    folder = tmp_path_factory.mktemp("speech")
    rate = 16000
    spoken = [folder / f"phrase{i}.wav" for i in range(len(PHRASES))]
    voices = [
        subprocess.Popen(
            ["say", "-v", "Damayanti", "-o", str(path), "--file-format=WAVE", f"--data-format=LEI16@{rate}", text]
        )
        for path, (_, text) in zip(spoken, PHRASES)
    ]
    assert all(voice.wait() == 0 for voice in voices)

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
