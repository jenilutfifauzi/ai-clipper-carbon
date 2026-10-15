"""The Media Library: videos, music and images uploaded for the Advanced Edit
(.scratch/advanced-edit/issues/03-media-library.md). Seam A, through the API with the real ffmpeg."""

import subprocess
from pathlib import Path

import pytest

from app import media
from app.config import load_settings


def make(path: Path, *args: str) -> bytes:
    subprocess.run([str(load_settings().ffmpeg_bin), "-v", "error", "-y", *args, str(path)], check=True)
    return path.read_bytes()


@pytest.fixture(scope="session")
def files(tmp_path_factory) -> dict[str, bytes]:
    """A 2 s 320x240 video at 25 fps with a tone, a 1 s WAV tone, a PNG, a 181 s video (too long), and
    a GIF and a FLAC (formats that aren't taken)."""
    folder = tmp_path_factory.mktemp("media")
    lavfi = ("-f", "lavfi", "-i")
    return {
        "video": make(folder / "clip.mov", *lavfi, "testsrc=size=320x240:rate=25:duration=2", *lavfi,
                      "sine=frequency=440:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest"),
        "audio": make(folder / "song.wav", *lavfi, "sine=frequency=330:duration=1"),
        "image": make(folder / "still.png", *lavfi, "color=c=blue:size=64x48", "-frames:v", "1"),
        "long": make(folder / "long.mp4", *lavfi, "color=c=black:size=32x32:rate=1:duration=181", "-c:v", "libx264",
                     "-preset", "ultrafast"),
        "gif": make(folder / "moving.gif", *lavfi, "testsrc=size=32x32:rate=5:duration=1"),
        "flac": make(folder / "song.flac", *lavfi, "sine=frequency=330:duration=1"),
    }


def upload(client, data: bytes, name: str):
    return client.post("/api/media", files={"file": (name, data, "application/octet-stream")})


def test_videos_audio_and_images_are_uploaded_normalized_listed_and_served(client, settings, files):
    assert client.get("/api/media").json() == []

    video = upload(client, files["video"], "intro.mov")
    assert video.status_code == 201, video.text
    video = video.json()
    assert (video["kind"], video["name"], video["width"], video["height"], video["has_audio"]) == ("video", "intro", 320, 240, True)
    assert video["duration"] == pytest.approx(2, abs=0.1)
    served = client.get(f"/api/media/{video['id']}")
    assert served.status_code == 200 and served.headers["content-type"] == "video/mp4"
    proxy = client.get(f"/api/media/{video['id']}/proxy")
    assert proxy.status_code == 200 and len(proxy.content) < len(served.content)
    assert client.get(f"/api/media/{video['id']}/thumbnail").content.startswith(b"\xff\xd8")
    # Normalized for the Renderer: H.264 and AAC at 30 fps.
    probe = subprocess.run(
        [str(settings.ffprobe_bin), "-v", "error", "-show_entries", "stream=codec_name,r_frame_rate", "-of", "csv=p=0",
         str(settings.data_dir / "media" / f"{video['id']}.mp4")],
        capture_output=True, text=True, check=True,
    ).stdout.split()
    assert sorted(probe) == ["aac,0/0", "h264,30/1"]

    audio = upload(client, files["audio"], "song.wav").json()
    assert (audio["kind"], audio["has_audio"], audio["width"]) == ("audio", True, None)
    assert audio["duration"] == pytest.approx(1, abs=0.1)
    assert client.get(f"/api/media/{audio['id']}").headers["content-type"] == "audio/mp4"
    assert client.get(f"/api/media/{audio['id']}/proxy").status_code == 404

    image = upload(client, files["image"], "still.png").json()
    assert (image["kind"], image["width"], image["height"], image["duration"]) == ("image", 64, 48, None)
    assert client.get(f"/api/media/{image['id']}").content.startswith(b"\x89PNG")

    assert [item["id"] for item in client.get("/api/media").json()] == [video["id"], audio["id"], image["id"]]


def test_files_that_cant_be_media_are_refused(client, files, monkeypatch):
    assert upload(client, b"plain text, not media", "notes.mp4").status_code == 422
    # Only the formats the Media Library takes, whatever the file's name says.
    for name, renamed in (("gif", "moving.mp4"), ("flac", "song.mp3")):
        refused = upload(client, files[name], renamed)
        assert refused.status_code == 422 and "MP4, MOV or WebM" in refused.json()["detail"], name
    assert "3 minutes" in upload(client, files["long"], "long.mp4").json()["detail"]
    monkeypatch.setitem(media.MAX_BYTES, media.MediaKind.AUDIO, 1000)
    assert "MB" in upload(client, files["audio"], "song.wav").json()["detail"]
    assert client.get("/api/media").json() == []


def test_media_is_deleted_with_its_files(client, settings, files):
    video = upload(client, files["video"], "intro.mov").json()
    folder = settings.data_dir / "media"
    assert sorted(path.name for path in folder.iterdir() if path.name != "media.json") == [
        f"{video['id']}.jpg", f"{video['id']}.mp4", f"{video['id']}.proxy.mp4", f"{video['id']}.strips",
    ]
    assert client.delete(f"/api/media/{video['id']}").status_code == 204
    assert client.get("/api/media").json() == []
    assert [path.name for path in folder.iterdir()] == ["media.json"]
    assert client.get(f"/api/media/{video['id']}").status_code == 404
    assert client.delete(f"/api/media/{video['id']}").status_code == 404
