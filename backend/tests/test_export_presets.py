"""Export Presets (.scratch/export-settings/issues/04-tracer-export-presets.md, docs/adr/0021): the
built-in ones, shipped as data files, the owner's and the default, kept in DATA_DIR; a render takes
one for its batch, and each Clip records what it was made with.

Through the API with the real ffmpeg, as the Clips page and the Render button use them.
"""

import json
from dataclasses import replace

from fastapi.testclient import TestClient

from app.export_presets import EXPORT_PRESETS_FILE
from app.main import create_app
from app.ports import Ports
from conftest import wait_for
from test_jobs_api import create_job
from test_render import add, probe, render_video, rendered, reviewed  # noqa: F401 (a fixture)

URL = "/api/export-presets"
BUILT_IN = {
    "shorts": "Shorts / TikTok / Reels",
    "small": "Small",
    "high-quality": "High quality",
    "archive": "Archive",
}


def listed(client) -> dict:
    response = client.get(URL)
    assert response.status_code == 200, response.text
    return response.json()


def render(client, job: dict, candidate_ids: list[str] | None = None, preset: str | None = None):
    body = {} if candidate_ids is None else {"candidate_ids": candidate_ids}
    if preset is not None:
        body["export_preset_id"] = preset
    return client.post(f"/api/jobs/{job['id']}/render", json=body)


def size_of(settings, job: dict, clip: dict) -> tuple[int, int]:
    info = probe(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"])
    [picture] = [stream for stream in info["streams"] if stream["codec_type"] == "video"]
    return picture["width"], picture["height"]


def test_the_four_presets_are_built_in_and_shorts_is_the_default(client):
    presets = listed(client)

    assert {preset["id"]: preset["name"] for preset in presets["presets"]} == BUILT_IN
    assert all(preset["builtin"] for preset in presets["presets"])
    assert presets["default"] == "shorts"
    assert "h264" in presets["available"]
    settings = {preset["id"]: preset["settings"] for preset in presets["presets"]}
    # The default renders as every Clip did before Export Presets.
    assert settings["shorts"] == {
        "codec": "h264", "resolution": 1080, "fps": None, "quality": "recommended", "bitrate": None, "loudness": -14,
    }
    assert settings["small"] == settings["shorts"] | {"resolution": 720, "quality": "smallest"}
    assert settings["high-quality"] == settings["shorts"] | {"codec": "hevc", "resolution": 1440, "quality": "high"}
    assert settings["archive"] == settings["shorts"] | {"codec": "hevc", "resolution": 2160, "quality": "high", "loudness": None}


def test_a_clip_rendered_with_small_is_720p_and_says_so_and_the_default_replaces_it(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    presets = {preset["id"]: preset for preset in listed(client)["presets"]}

    response = render(client, job, preset="small")
    assert response.status_code == 200, response.text
    [queued] = response.json()
    assert queued["export_preset_id"] == "small"
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert size_of(settings, job, clip) == (720, 1280)
    output = clip["output"]
    assert (output["export_preset_id"], output["export"], output["bitrate_fallback"]) == ("small", presets["small"]["settings"], False)

    # Left out, the Preset is the default; the Clip is replaced.
    assert render(client, job, [candidate["id"]]).json()[0]["export_preset_id"] == "shorts"
    [again] = rendered(client, job)["clips"]
    assert size_of(settings, job, again) == (1080, 1920)
    assert (again["output"]["export_preset_id"], again["output"]["export"]) == ("shorts", presets["shorts"]["settings"])
    assert again["output"]["video"] == output["video"] and again["output"]["at"] > output["at"]


def test_an_unknown_preset_is_refused_and_nothing_is_queued(client):
    job = reviewed(client)
    add(client, job, "halo", "kabar")

    response = render(client, job, preset="nope")
    assert response.status_code == 422, response.text
    assert "nope" in response.json()["detail"]
    assert client.get(f"/api/jobs/{job['id']}").json()["status"] == "review"


def test_a_candidate_queued_with_one_preset_and_asked_again_with_another_renders_with_the_latest(client, settings, video_source):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    # Another Job's download holds the worker, so the render waits its turn.
    other = hold_worker(client, video_source)

    assert render(client, job, preset="high-quality").json()[0]["status"] == "queued"
    [queued] = render(client, job, preset="small").json()
    assert (queued["status"], queued["export_preset_id"]) == ("queued", "small")

    video_source.release()
    wait_for(client, other["id"], "review")
    [clip] = rendered(client, job)["clips"]
    assert clip["output"]["export_preset_id"] == "small"
    assert size_of(settings, job, clip) == (720, 1280)
    # Export Settings are never compared: the Clip is of the Candidate's Revision as it still is.
    [now] = [c for c in client.get(f"/api/jobs/{job['id']}").json()["candidates"] if c["id"] == candidate["id"]]
    assert clip["output"]["revision"] == now["revision"]


def hold_worker(client, video_source) -> dict:
    """Another Job, whose download holds the worker until `video_source.release()`."""
    video_source.hold()
    other = create_job(client)
    wait_for(client, other["id"], "downloading")
    return other


def mine(settings, **given) -> None:
    """The owner's Presets as DATA_DIR keeps them: "Mine" with `given` settings, or none without."""
    path = settings.data_dir / EXPORT_PRESETS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    presets = [{"id": "mine", "name": "Mine", "settings": given}] if given else []
    path.write_text(json.dumps({"default": "shorts", "presets": presets}))


def test_a_clip_renders_with_its_preset_as_it_is_when_the_render_starts_or_the_default_once_deleted(client, settings, video_source):
    mine(settings, resolution=1080)
    job = reviewed(client)
    add(client, job, "halo", "kabar")

    other = hold_worker(client, video_source)
    render(client, job, preset="mine")
    mine(settings, resolution=720)
    video_source.release()
    wait_for(client, other["id"], "review")
    [clip] = rendered(client, job)["clips"]
    assert size_of(settings, job, clip) == (720, 1280)
    assert clip["output"]["export"]["resolution"] == 720

    other = hold_worker(client, video_source)
    render(client, job, preset="mine")
    mine(settings)
    video_source.release()
    wait_for(client, other["id"], "review")
    [clip] = rendered(client, job)["clips"]
    assert size_of(settings, job, clip) == (1080, 1920)
    # It records the Preset it was made with, the default, not the deleted one, and its settings.
    assert (clip["output"]["export_preset_id"], clip["output"]["export"]["resolution"]) == ("shorts", 1080)
    # Deleted, the Preset can no longer be asked for.
    assert render(client, job, preset="mine").status_code == 422


def test_a_clip_rendered_before_presets_reads_and_renders_again_with_the_default(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    render(client, job, preset="small")
    rendered(client, job)
    # As clips.json was before Export Presets.
    path = settings.data_dir / "jobs" / job["id"] / "clips.json"
    [old] = json.loads(path.read_text())
    del old["export_preset_id"]
    for key in ("export_preset_id", "export", "bitrate_fallback"):
        del old["output"][key]
    path.write_text(json.dumps([old]))

    [clip] = client.get(f"/api/jobs/{job['id']}/clips").json()
    assert (clip["export_preset_id"], clip["output"]["export_preset_id"], clip["output"]["export"]) == (None, None, None)
    assert clip["output"]["bitrate_fallback"] is False
    render(client, job, [candidate["id"]])
    [clip] = rendered(client, job)["clips"]
    assert size_of(settings, job, clip) == (1080, 1920)
    assert clip["output"]["export_preset_id"] == "shorts"


# The Export Presets sheet (.scratch/export-settings/issues/05): the owner's Presets made, changed and
# deleted, the default chosen, and sizes estimated.

SHORTS = {"codec": "h264", "resolution": 1080, "fps": None, "quality": "recommended", "bitrate": None, "loudness": -14}


def made(client, name: str, **settings) -> dict:
    response = client.post(URL, json={"name": name, "settings": SHORTS | settings})
    assert response.status_code == 201, response.text
    return response.json()


def test_an_owners_preset_is_made_changed_and_deleted_and_survives_a_restart(settings, video_source, transcriber, llm, client):
    preset = made(client, "Review copy", resolution=720, codec="hevc")

    assert (preset["name"], preset["builtin"], preset["settings"]["resolution"]) == ("Review copy", False, 720)
    assert preset["id"] not in BUILT_IN
    # Listed after the built-in ones.
    assert listed(client)["presets"][-1] == preset

    changed = client.put(f"{URL}/{preset['id']}", json={"name": "Review", "settings": SHORTS | {"fps": 60}})
    assert changed.status_code == 200, changed.text
    assert changed.json() == preset | {"name": "Review", "settings": SHORTS | {"fps": 60}}
    # Another app on the same data directory reads them as they were left.
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as restarted:
        assert listed(restarted)["presets"][-1] == changed.json()

    assert client.delete(f"{URL}/{preset['id']}").status_code == 204
    assert preset["id"] not in {p["id"] for p in listed(client)["presets"]}
    assert client.delete(f"{URL}/{preset['id']}").status_code == 404
    assert client.put(f"{URL}/{preset['id']}", json={"name": "x", "settings": SHORTS}).status_code == 404


def test_a_builtin_preset_cant_be_changed_or_deleted_and_a_duplicate_of_it_can(client):
    presets = {preset["id"]: preset for preset in listed(client)["presets"]}

    response = client.put(f"{URL}/archive", json={"name": "Archive", "settings": SHORTS})
    assert response.status_code == 409 and "built in" in response.json()["detail"]
    response = client.delete(f"{URL}/archive")
    assert response.status_code == 409 and "built in" in response.json()["detail"]
    assert {preset["id"]: preset for preset in listed(client)["presets"]}["archive"] == presets["archive"]

    # Duplicating one is making a Preset of its settings, which can then be changed.
    copy = made(client, "Archive copy", **presets["archive"]["settings"])
    assert client.put(f"{URL}/{copy['id']}", json={"name": "Archive copy", "settings": SHORTS}).status_code == 200


def test_any_preset_can_be_made_the_default_and_deleting_it_makes_shorts_the_default_again(client):
    preset = made(client, "Mine", resolution=720)

    response = client.put(f"{URL}/default", json={"preset_id": "small"})
    assert response.status_code == 200, response.text
    assert listed(client)["default"] == "small"
    assert client.put(f"{URL}/default", json={"preset_id": preset["id"]}).status_code == 200
    assert listed(client)["default"] == preset["id"]
    assert client.put(f"{URL}/default", json={"preset_id": "nope"}).status_code == 404

    client.delete(f"{URL}/{preset['id']}")
    assert listed(client)["default"] == "shorts"


def test_settings_off_the_lists_are_refused(client):
    for wrong in ({"codec": "prores"}, {"resolution": 900}, {"fps": 48}, {"bitrate": {"mode": "cbr", "kbps": 50}},
                  {"bitrate": {"mode": "vbr", "kbps": 300_000}}, {"loudness": -20}):
        response = client.post(URL, json={"name": "Wrong", "settings": SHORTS | wrong})
        assert response.status_code == 422, wrong
    assert client.post(URL, json={"name": "", "settings": SHORTS}).status_code == 422
    assert client.post(URL, json={"name": "Extra", "settings": SHORTS, "id": "mine"}).status_code == 422
    assert all(preset["builtin"] for preset in listed(client)["presets"])


def estimate(client, secs: float, source_fps: float, aspect: str | None = None, **settings) -> int:
    body = {"settings": SHORTS | settings, "secs": secs, "fps": source_fps} | ({"aspect": aspect} if aspect else {})
    response = client.post(f"{URL}/estimate", json=body)
    assert response.status_code == 200, response.text
    return response.json()["bytes"]


def test_the_estimate_is_the_target_bitrate_and_the_sound_over_the_duration(client):
    # Recommended at 1080p and 30 fps: 8 Mb/s, and 192 kb/s of sound; a minute is 61.44 MB.
    assert estimate(client, 60, 30) == 61_440_000
    # A rate under 30 counts as 30; above it, the bitrate follows it.
    assert estimate(client, 60, 24) == 61_440_000
    assert estimate(client, 60, 60) == (16_000 + 192) * 1000 * 60 // 8
    # A frame rate of the settings' own is the one the Clip is made at, whatever the Source's.
    assert estimate(client, 60, 30, fps=60) == estimate(client, 60, 60)
    # HEVC High at 1440p: 16 Mb/s x (1440x2560)/(1080x1920) x 0.6 = 17.067 Mb/s.
    assert estimate(client, 10, 30, codec="hevc", resolution=1440, quality="high") == round((17_067 + 192) * 1000 * 10 / 8)
    # A bitrate of the settings' own replaces the tier.
    assert estimate(client, 8, 30, bitrate={"mode": "cbr", "kbps": 6000}) == (6000 + 192) * 1000
    assert client.post(f"{URL}/estimate", json={"settings": SHORTS | {"codec": "prores"}, "secs": 1, "fps": 30}).status_code == 422
    assert client.post(f"{URL}/estimate", json={"settings": SHORTS, "secs": -1, "fps": 30}).status_code == 422


def test_the_estimate_counts_the_pixels_of_the_batchs_aspect(client):
    # 16:9 at 1080p is 1920x1080, as many pixels as 9:16; 1:1 is 1080x1080 and 4:5 1080x1350, fewer.
    assert estimate(client, 60, 30, aspect="16:9") == estimate(client, 60, 30, aspect="9:16") == estimate(client, 60, 30)
    assert estimate(client, 60, 30, aspect="1:1") == round((8000 * 1080 / 1920 + 192) * 1000 * 60 / 8)
    assert estimate(client, 60, 30, aspect="4:5") == round((8000 * 1350 / 1920 + 192) * 1000 * 60 / 8)
    assert client.post(f"{URL}/estimate", json={"settings": SHORTS, "secs": 1, "fps": 30, "aspect": "3:2"}).status_code == 422


def test_a_codec_without_an_encoder_in_ffmpeg_is_not_available(settings, video_source, transcriber, llm):
    lacking = replace(settings, render=replace(settings.render, av1_encoders=("libnoav1",)))
    with TestClient(create_app(lacking, Ports(video_source, transcriber, llm))) as client:
        assert "av1" not in listed(client)["available"]
        assert "h264" in listed(client)["available"]
