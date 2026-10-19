"""Save audio (.scratch/export-settings/issues/08-save-audio.md): a Candidate's mix on its own, as WAV
or M4A, at an Export Preset's loudness, written to its Job's `exports/` as an Export file.

Seam A: through the API and the MCP with the real ffmpeg, as the Clip card's "Save audio" uses it.
"""

from pathlib import Path

import pytest

from test_keyed_volume import tone_level
from test_media_library import make, upload
from test_mcp import HALO_KABAR, anyio_backend, call, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, loudness, preview, probe, reviewed
from test_render import from_render_video, render_video  # noqa: F401
from test_retimed_copies import counter, sweep_at  # noqa: F401
from test_review import patch
from test_sped_media_segments import COVER

SOURCE_SECS = 6


def save_audio(client, job: dict, candidate: dict, **body):
    return client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/audio", json=body)


def saved(client, job: dict, candidate: dict, **body) -> dict:
    response = save_audio(client, job, candidate, **body)
    assert response.status_code == 200, response.text
    return response.json()


def stream(settings, path: Path) -> tuple[dict, dict]:
    info = probe(settings, path)
    [sound] = info["streams"]
    return sound, info["format"]


@pytest.fixture(scope="session")
def quiet_source(tmp_path_factory) -> Path:
    """The Source, a test pattern with a tone 30 dB quieter than -14 LUFS would need."""
    path = tmp_path_factory.mktemp("quiet") / "quiet.mp4"
    lavfi = ("-f", "lavfi", "-i")
    make(
        path, *lavfi, "testsrc2=size=640x360:rate=25", *lavfi, "sine=frequency=440:sample_rate=48000,volume=-30dB",
        "-t", str(SOURCE_SECS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    )
    return path


def test_the_wav_is_48khz_16bit_as_long_as_the_clip_and_the_m4a_is_aac_both_in_the_jobs_exports(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    job_dir = settings.data_dir / "jobs" / job["id"]
    length = candidate["end"] - candidate["start"]

    wav = saved(client, job, candidate, format="wav")
    path = Path(wav["path"])
    assert path == job_dir / "exports" / f"{candidate['id']}.wav"
    sound, container = stream(settings, path)
    assert (sound["codec_name"], int(sound["sample_rate"]), sound["bits_per_sample"]) == ("pcm_s16le", 48000, 16)
    assert float(container["duration"]) == pytest.approx(length, abs=0.05)
    # Loudness is the default Preset's.
    assert loudness(settings, path) == pytest.approx(-14, abs=1)
    downloaded = client.get(wav["url"])
    assert downloaded.status_code == 200 and downloaded.content == path.read_bytes()

    m4a = saved(client, job, candidate, format="m4a", export_preset_id="small")
    sound, container = stream(settings, Path(m4a["path"]))
    assert Path(m4a["path"]).name == f"{candidate['id']}.m4a"
    assert (sound["codec_name"], int(sound["sample_rate"])) == ("aac", 48000)
    assert float(container["duration"]) == pytest.approx(length, abs=0.1)
    assert client.get(m4a["url"]).status_code == 200

    # Saved again, the same name is overwritten; nothing was queued or rendered.
    before = path.stat().st_mtime_ns
    assert saved(client, job, candidate, format="wav")["path"] == str(path)
    assert path.stat().st_mtime_ns >= before
    assert sorted(p.name for p in (job_dir / "exports").iterdir()) == [f"{candidate['id']}.m4a", f"{candidate['id']}.wav"]
    after = client.get(f"/api/jobs/{job['id']}").json()
    assert after["status"] == "review"
    assert client.get(f"/api/jobs/{job['id']}/clips").json() == []


def test_archive_leaves_a_quiet_tone_quiet_and_shorts_brings_it_to_minus_14(client, settings, video_source, quiet_source):
    video_source.video = quiet_source
    job = reviewed(client)
    candidate = add(client, job, "halo", "kita")

    archived = Path(saved(client, job, candidate, format="wav", export_preset_id="archive")["path"])
    assert loudness(settings, archived) < -40
    normalized = Path(saved(client, job, candidate, format="wav", export_preset_id="shorts")["path"])
    assert loudness(settings, normalized) == pytest.approx(-14, abs=1)


def test_a_music_clips_fade_and_a_reversed_video_segments_sound_are_heard_as_in_the_clip(client, settings, counter):
    """The counter's sweep rises; reversed, it falls. A 3 s 880 Hz song fades out over its last second."""
    video = upload(client, counter.read_bytes(), "counter.mp4").json()
    song = upload(client, make(settings.data_dir / "song.wav", "-f", "lavfi", "-i", "sine=frequency=880:duration=4"), "song.wav").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(
        client, job, candidate,
        segments=[
            {"id": "back", "start": 0, "end": 2, "media": video["id"], "framing": COVER, "reverse": True},
            {"id": "e", "start": words["halo"]["start"], "end": words["kabar"]["end"]},
        ],
        music=[{"id": "m1", "media": song["id"], "start": 0, "secs": 3, "fade_out": 1}],
    )
    length = preview(client, job, candidate)["plan"]["segments"][-1]["end"]

    path = Path(saved(client, job, candidate, format="wav", export_preset_id="archive")["path"])
    assert float(stream(settings, path)[1]["duration"]) == pytest.approx(length, abs=0.05)
    # The sweep falls: 0.4 s in, the tone of 1.6 s into the video, not of 0.4 s.
    for at, played, mirrored in ((0.4, 1.6, 0.4), (1.5, 0.5, 1.5)):
        assert tone_level(settings, path, sweep_at(played), at) > 5 * tone_level(settings, path, sweep_at(mirrored), at), at
    # The song is heard whole until its fade, then fades out to nothing by 3 s.
    full = tone_level(settings, path, 880, 1.0, 0.25)
    assert tone_level(settings, path, 880, 2.5, 0.1) == pytest.approx(full / 2, rel=0.25)
    assert tone_level(settings, path, 880, 3.2, 0.25) < full / 20
    # Its full-size Retimed copy was made for it.
    assert [p.name for p in (settings.data_dir / "media" / f"{video['id']}.retimed").iterdir()] == ["reversed-full-0-2000.mp4"]


def test_a_bad_format_an_unknown_preset_or_candidate_is_refused(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")

    assert save_audio(client, job, candidate, format="mp3").status_code == 422
    refused = save_audio(client, job, candidate, format="wav", export_preset_id="nope")
    assert refused.status_code == 422 and "nope" in refused.json()["detail"]
    assert save_audio(client, job, {"id": "zz"}, format="wav").status_code == 404
    assert client.post("/api/jobs/nope/candidates/zz/audio", json={"format": "wav"}).status_code == 404


@pytest.mark.anyio
async def test_export_audio_returns_the_path_of_the_file_on_this_mac(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)

    result = await call(mcp, "export_audio", job_id=job["id"], candidate_id=candidate["id"])
    assert Path(result["path"]).is_file() and result["path"].endswith(f"{candidate['id']}.wav")
    m4a = await call(mcp, "export_audio", job_id=job["id"], candidate_id=candidate["id"], format="m4a", export_preset_id="archive")
    assert Path(m4a["path"]).is_file() and m4a["path"].endswith(".m4a")
