"""Music Clips: songs from the Media Library mixed under the Clip's own sound
(.scratch/advanced-edit/issues/04-music-clips.md).

Seam B on the planner and the encode's command, then Seam A through the API and the real ffmpeg.
"""

import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.candidates import MusicClip
from app.config import RenderTuning
from app.planner import MediaInfo, audio_events, plan_render
from app.renderer import Renderer
from app.video_source import SourceMetadata
from test_media_library import make, upload
from test_render import HEARD, add, check_clip, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
SONG = "ab" * 16
SONGS = {SONG: MediaInfo(0, 0, 30.0, True)}


def music(**fields) -> MusicClip:
    return MusicClip(**{"id": "m1", "media": SONG, "start": 1.0, "secs": 4.0, **fields})


def test_a_music_clip_is_kept_inside_the_clip_and_its_song():
    [event] = audio_events([music()], 10, SONGS)
    assert (event.start, event.end, event.offset, event.volume) == (1.0, 5.0, 0.0, 1.0)
    # Cut at the Clip's end, and at the song's.
    assert audio_events([music(start=8.0)], 10, SONGS)[0].end == 10
    assert audio_events([music(offset=28.0)], 10, SONGS)[0].end == 3.0
    # Nothing past either end, nor of a song that is gone.
    assert audio_events([music(start=10.0)], 10, SONGS) == []
    assert audio_events([music(offset=30.0)], 10, SONGS) == []
    assert audio_events([music()], 10, {}) == []
    # Fades are fitted to what is heard (test_gain.py's shared cases), so to what the Clip's end leaves.
    [cut] = audio_events([music(start=7.0, fade_in=3.0, fade_out=1.0)], 10, SONGS)
    assert (cut.fade_in, cut.fade_out) == (2.25, 0.75)


def test_the_encode_mixes_music_only_when_there_is_some(tmp_path):
    renderer = Renderer(Path("ffmpeg"), RenderTuning())
    plain = plan_render(0, 5, SOURCE)
    command = " ".join(renderer._command(Path("s.mp4"), plain, None, "libx264", tmp_path / "v.mp4", tmp_path / "p.jpg", None))
    assert "amix" not in command and "[0:a:0]aresample" in command

    mixed = plan_render(0, 5, SOURCE, music=[music(volume=0.5, fade_out=1.0)], media_info=SONGS, source_volume=0.2)
    command = renderer._command(
        Path("s.mp4"), mixed, None, "libx264", tmp_path / "v.mp4", tmp_path / "p.jpg", None, files={SONG: Path("song.m4a")}
    )
    assert command[command.index("song.m4a") - 1] == "-i"
    graph = command[command.index("-filter_complex") + 1]
    assert "[0:a:0]volume=0.2" in graph and "amix=inputs=2:duration=first:normalize=0" in graph
    assert "atrim=start=0:end=4" in graph and "adelay=1000:all=1" in graph and "afade=t=out:st=3:d=1" in graph


@pytest.fixture(scope="session")
def song(tmp_path_factory) -> bytes:
    """3 s of an 880 Hz tone."""
    return make(tmp_path_factory.mktemp("song") / "song.wav", "-f", "lavfi", "-i", "sine=frequency=880:duration=3")


def loudness_by_window(settings, video: Path, window: float = 0.1) -> np.ndarray:
    """The RMS of the Clip's sound in each `window` seconds."""
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]
    samples = np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, dtype=np.int16).astype(float)
    size = int(8000 * window)
    return np.sqrt((samples[: len(samples) // size * size].reshape(-1, size) ** 2).mean(axis=1))


def test_music_is_saved_validated_and_mixed_into_the_render(client, settings, video_source, transcriber, plain_video, song):
    video_source.video = plain_video
    transcriber.words = HEARD
    item = upload(client, song, "song.wav").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    clip = {"id": "m1", "media": item["id"], "start": 1.0, "secs": 1.0}
    for bad in ([clip | {"media": "cd" * 16}], [clip | {"volume": 3}], [clip, clip]):
        assert client.patch(candidate_url(job, candidate), json={"music": bad}).status_code == 422, bad
    image = upload(client, make(Path(settings.data_dir) / "still.png", "-f", "lavfi", "-i", "color=c=red:size=8x8", "-frames:v", "1"), "still.png")
    assert client.patch(candidate_url(job, candidate), json={"music": [clip | {"media": image.json()["id"]}]}).status_code == 422

    # Only the music is heard: the Clip's own sound is muted.
    candidate = patch(client, job, candidate, music=[clip], source_volume=0)
    assert candidate["edited"] and candidate["music"][0]["volume"] == 1
    planned = preview(client, job, candidate)["plan"]
    assert planned["source_volume"] == 0 and [(e["start"], e["end"]) for e in planned["audio"]] == [(1.0, 2.0)]

    # The song can't be deleted while the Candidate uses it.
    refused = client.delete(f"/api/media/{item['id']}")
    assert refused.status_code == 409
    assert refused.json()["detail"]["uses"] == [{"job_id": job["id"], "candidate_id": candidate["id"], "title": candidate["title"] or f"Clip {candidate['id']}"}]

    render(client, job)
    [output] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, output, candidate)
    assert output["output"]["music"] == candidate["music"] and output["output"]["source_volume"] == 0
    levels = loudness_by_window(settings, job_dir / output["output"]["video"])
    quiet, heard = levels.max() * 0.05, levels.max() * 0.5
    assert (levels[2:8] < quiet).all() and (levels[11:19] > heard).all() and (levels[22:26] < quiet).all()


def test_a_render_without_music_measures_and_mixes_as_before(client, settings, video_source, transcriber, plain_video):
    """The Clip's own sound at its own volume, normalized as before (loudness within 1 LU of -14)."""
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    render(client, job)
    [output] = rendered(client, job)["clips"]
    job_dir = settings.data_dir / "jobs" / job["id"]
    check_clip(settings, job_dir, output, candidate)
    levels = loudness_by_window(settings, job_dir / output["output"]["video"])
    assert (levels > levels.max() * 0.5).mean() > 0.9

