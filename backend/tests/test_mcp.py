"""Seam A through MCP (.scratch/mcp-server/): the tools, called by an MCP client connected in-process
to the app's MCP server, on the app with fake ports, its Worker running. The tools go through the
app's real routes. One test posts to /mcp over HTTP."""

import json
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp import Client

from app import uploads
from app.config import load_settings
from app.main import create_app
from app.ports import Ports
from fontfiles import RESTRICTED, font_file
from test_jobs_api import URL

# tests/fixtures/captions.json3's Words "halo" to "kabar", and "kita" to "soal" (Source time).
HALO_KABAR = (0.1, 1.6)
KITA_SOAL = (1.6, 2.6)
# The tool list is sent to the agent's context with every conversation: keep it within this. Raised
# from 68_500 for Shapes (shapes/08): merge_candidate_items' `shapes` and the Shape Kinds named in
# their one-line schema; the rest of what an agent needs about Shapes is in the server's instructions.
# Raised from 69_000 for Export Presets (export-settings/04): render_clips' `export_preset_id`.
TOOLS_BUDGET_BYTES = 69_250
INITIALIZE = {
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "0"}},
}
MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
async def mcp(client):
    async with Client(client.app.state.mcp) as session:
        yield session


async def call(mcp: Client, tool: str, **arguments) -> dict:
    result = await mcp.call_tool(tool, arguments)
    [content] = result.content
    assert not result.is_error, content.text
    return json.loads(content.text)


async def fails(mcp: Client, tool: str, **arguments) -> str:
    result = await mcp.call_tool(tool, arguments)
    assert result.is_error, result.content
    return result.content[0].text


async def reviewed(mcp: Client, **options) -> dict:
    job = await call(mcp, "create_job_from_url", url=URL, options=options)
    waited = await call(mcp, "wait_for_job", job_id=job["id"], timeout_secs=30)
    assert waited["reached"] and waited["job"]["status"] == "review", waited
    return waited["job"]


async def manual(mcp: Client, job: dict, start: float, end: float, **changes) -> dict:
    candidate = await call(mcp, "add_candidate", job_id=job["id"], start=start, end=end)
    if changes:
        return await call(mcp, "edit_candidate", job_id=job["id"], candidate_id=candidate["id"], changes=changes)
    return candidate


def make(path: Path, *args: str) -> Path:
    subprocess.run([str(load_settings().ffmpeg_bin), "-v", "error", "-y", *args, str(path)], check=True)
    return path


# 01: the endpoint and Job tools


def test_mcp_answers_at_mcp_beside_the_frontend_and_only_to_local_hosts(settings, video_source, transcriber, llm, tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html>")
    app = create_app(replace(settings, frontend_dir=dist), Ports(video_source, transcriber, llm))
    with TestClient(app, base_url="http://127.0.0.1:8000") as client:
        response = client.post("/mcp", json=INITIALIZE, headers=MCP_HEADERS)
        assert response.status_code == 200, response.text
        assert '"serverInfo":{"name":"AI Clipper"' in response.text
        assert client.post("/mcp", json=INITIALIZE, headers={**MCP_HEADERS, "Host": "evil.example"}).status_code == 421
        assert client.get("/jobs/abc").text == "<!doctype html>"
        assert client.get("/mcp/other").status_code == 404


@pytest.mark.anyio
async def test_a_job_made_through_mcp_reaches_review_and_is_listed_without_its_transcript(mcp):
    job = await reviewed(mcp)

    got = await call(mcp, "get_job", job_id=job["id"])
    assert got["status"] == "review" and got["source"] == URL
    assert "transcript" not in got and "history" not in got and "profile" not in got
    assert got["candidates"] == [] and got["clips"] == []
    assert [listed["id"] for listed in (await call(mcp, "list_jobs"))["jobs"]] == [job["id"]]


@pytest.mark.anyio
async def test_api_errors_come_back_as_tool_errors_with_their_message(mcp):
    assert "No Job nope" in await fails(mcp, "get_job", job_id="nope")
    job = await reviewed(mcp)
    assert "only a Job in error can be retried" in await fails(mcp, "retry_job", job_id=job["id"])

    assert await call(mcp, "delete_job", job_id=job["id"]) == {"deleted": job["id"]}
    assert (await call(mcp, "list_jobs"))["jobs"] == []


# 02: waiting


@pytest.mark.anyio
async def test_waiting_follows_a_job_with_progress_and_times_out(mcp, video_source):
    video_source.hold()
    job = await call(mcp, "create_job_from_url", url=URL)

    waited = await call(mcp, "wait_for_job", job_id=job["id"], timeout_secs=5, until=["downloading"])
    assert waited["reached"] and waited["job"]["status"] == "downloading"
    result = await mcp.call_tool("wait_for_job", {"job_id": job["id"], "timeout_secs": 5}, read_timeout_seconds=10)
    assert json.loads(result.content[0].text)["reached"] is False

    video_source.release()
    notes = []

    async def progress(progress: float, total: float | None, message: str | None) -> None:
        notes.append(message)

    result = await mcp.call_tool("wait_for_job", {"job_id": job["id"], "timeout_secs": 30}, progress_callback=progress)
    assert json.loads(result.content[0].text)["job"]["status"] == "review"
    assert any(note and note.startswith("transcribing") for note in notes), notes
    # Already there: at once.
    assert (await call(mcp, "wait_for_job", job_id=job["id"]))["reached"]
    assert "No Job nope" in await fails(mcp, "wait_for_job", job_id="nope")


# 03: Jobs from a file on this Mac


@pytest.mark.anyio
async def test_a_job_from_a_file_on_this_mac_reaches_review_and_leaves_the_file(mcp, settings, fixture_video, tmp_path):
    master = tmp_path / "Episode 12.mp4"
    master.write_bytes(fixture_video.read_bytes())

    job = await call(mcp, "create_job_from_file", path=str(master), options={"captions": False})
    waited = await call(mcp, "wait_for_job", job_id=job["id"], timeout_secs=30)

    assert waited["job"]["status"] == "review", waited
    assert waited["job"]["source"] == "Episode 12.mp4"
    assert master.read_bytes() == fixture_video.read_bytes()
    assert not list((settings.data_dir / uploads.UPLOADS_DIR).iterdir())


@pytest.mark.anyio
async def test_a_missing_file_or_a_folder_makes_no_job(mcp, settings, tmp_path):
    assert "No file" in await fails(mcp, "create_job_from_file", path=str(tmp_path / "missing.mp4"))
    assert "No file" in await fails(mcp, "create_job_from_file", path=str(tmp_path))
    assert (await call(mcp, "list_jobs"))["jobs"] == []


# 04: reviewing Candidates


@pytest.mark.anyio
async def test_the_transcript_is_read_a_page_at_a_time(mcp):
    job = await reviewed(mcp)

    page = await call(mcp, "get_transcript", job_id=job["id"], end=2, words=True)
    assert [line["text"] for line in page["lines"]] == ["halo semua apa kabar", "kita ngobrol soal"]
    assert [word["text"] for word in page["words"]] == ["halo", "semua", "apa", "kabar", "kita", "ngobrol", "soal"]
    assert page["next_start"] == 2.6
    rest = await call(mcp, "get_transcript", job_id=job["id"], start=page["next_start"])
    assert [line["text"] for line in rest["lines"]] == ["Podcast ya"] and rest["next_start"] is None


@pytest.mark.anyio
async def test_candidates_are_added_edited_and_dry_run_through_mcp(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    edited = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Halo *semua*", "hook_kicker": "EPS 12", "selected": True})
    assert (edited["hook_text"], edited["hook_kicker"], edited["selected"], edited["edited"]) == ("Halo *semua*", "EPS 12", True, True)
    [listed] = (await call(mcp, "get_job", job_id=job["id"]))["candidates"]
    assert listed["hook_text"] == "Halo *semua*" and "descriptions" not in listed

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba dulu"}, dry_run=True)
    assert plan["hook"]["lines"] == ["Coba dulu"]
    assert [word["text"] for word in plan["words"]][:2] == ["halo", "semua"] and "at" in plan["words"][0]
    assert (await call(mcp, "get_candidate", **ids))["hook_text"] == "Halo *semua*"  # not saved

    message = await fails(mcp, "edit_candidate", **ids, changes={"start": 5, "end": 1})
    assert "end" in message.lower() or "start" in message.lower()
    assert "hook_kicker" in await fails(mcp, "edit_candidate", **ids, changes={"hook_kicker": "x" * 40})
    assert "has no Candidate nope" in await fails(mcp, "edit_candidate", job_id=job["id"], candidate_id="nope", changes={})


@pytest.mark.anyio
async def test_tracking_and_line_height_are_style_overrides_that_show_in_the_dry_run(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    # One line untracked; spaced out, too wide for one.
    hook = {"hook_text": "Jangan lakukan ini"}
    plain = await call(mcp, "edit_candidate", **ids, changes=hook, dry_run=True)
    assert plain["hook"]["lines"] == ["Jangan lakukan ini"]
    spaced = await call(mcp, "edit_candidate", **ids, changes={**hook, "style_overrides": {"hook": {"tracking": 12}}}, dry_run=True)
    assert spaced["hook"]["lines"] == ["Jangan", "lakukan ini"]

    merged = await call(mcp, "merge_candidate_items", **ids, style_overrides={"caption": {"tracking": -2}, "hook": {"tracking": 12, "line_height": 1.2}})
    assert merged["style_overrides"]["caption"] == {"tracking": -2} and merged["style_overrides"]["hook"] == {"tracking": 12, "line_height": 1.2}
    assert (await call(mcp, "edit_candidate", **ids, changes=hook, dry_run=True))["hook"]["lines"] == ["Jangan", "lakukan ini"]
    assert "tracking" in await fails(mcp, "merge_candidate_items", **ids, style_overrides={"hook": {"tracking": 500}})
    assert "line_height" in await fails(mcp, "merge_candidate_items", **ids, style_overrides={"hook": {"line_height": 0}})


@pytest.mark.anyio
async def test_the_hook_and_caption_shadow_and_box_padding_are_style_overrides(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    # 728 px wide: one line, but not inside a box padded 60 px either side.
    hook = {"hook_text": "Racun bisa bunuh kamu"}
    assert (await call(mcp, "edit_candidate", **ids, changes=hook, dry_run=True))["hook"]["lines"] == [hook["hook_text"]]
    padded = await call(mcp, "edit_candidate", **ids, changes={**hook, "style_overrides": {"hook": {"padding_x": 60}}}, dry_run=True)
    assert len(padded["hook"]["lines"]) == 2

    # A shadow is merged by its fields; old-shaped ones are read in today's.
    await call(mcp, "merge_candidate_items", **ids, style_overrides={"hook": {"shadow": {"blur": 8, "distance": 6}, "padding_x": 60}})
    merged = await call(mcp, "merge_candidate_items", **ids, style_overrides={"hook": {"shadow": {"angle": 90}}, "caption": {"shadow": 3}})
    assert merged["style_overrides"]["hook"] == {"shadow": {"blur": 8, "distance": 6, "angle": 90}, "padding_x": 60}
    assert merged["style_overrides"]["caption"]["shadow"]["distance"] == pytest.approx(3 * 2**0.5)
    assert len((await call(mcp, "edit_candidate", **ids, changes=hook, dry_run=True))["hook"]["lines"]) == 2
    assert "blur" in await fails(mcp, "merge_candidate_items", **ids, style_overrides={"hook": {"shadow": {"blur": 500}}})
    assert "padding_y" in await fails(mcp, "merge_candidate_items", **ids, style_overrides={"caption": {"padding_y": -1}})


@pytest.mark.anyio
async def test_candidates_of_a_job_not_in_review_cant_be_edited(mcp, video_source):
    video_source.hold()
    job = await call(mcp, "create_job_from_url", url=URL)
    try:
        assert "while it is in review" in await fails(mcp, "add_candidate", job_id=job["id"], start=0.1, end=1.6)
    finally:
        video_source.release()


# 05: rendering


@pytest.mark.anyio
async def test_selected_candidates_render_into_clips_with_their_paths(mcp):
    job = await reviewed(mcp)
    assert "Select at least one Candidate" in await fails(mcp, "render_clips", job_id=job["id"])
    candidate = await manual(mcp, job, *HALO_KABAR, selected=True)

    queued = (await call(mcp, "render_clips", job_id=job["id"]))["clips"]
    assert [clip["candidate_id"] for clip in queued] == [candidate["id"]]
    waited = await call(mcp, "wait_for_job", job_id=job["id"], timeout_secs=60)
    assert waited["reached"] and waited["job"]["status"] == "review"

    [clip] = (await call(mcp, "list_clips", job_id=job["id"]))["clips"]
    assert clip["status"] == "done", clip
    assert Path(clip["video_path"]).is_file() and Path(clip["poster_path"]).is_file()
    assert clip["duration"] == pytest.approx(candidate["end"] - candidate["start"], abs=0.05)
    # Rendered from this Revision: a Clip is stale once its Candidate's is another.
    assert clip["revision"] == candidate["revision"]


@pytest.mark.anyio
async def test_a_render_takes_an_export_preset_which_its_clip_records(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR, selected=True)
    assert "No Export Preset nope" in await fails(mcp, "render_clips", job_id=job["id"], export_preset_id="nope")

    await call(mcp, "render_clips", job_id=job["id"], candidate_ids=[candidate["id"]], export_preset_id="small")
    waited = await call(mcp, "wait_for_job", job_id=job["id"], timeout_secs=60)
    assert waited["reached"] and waited["job"]["status"] == "review"
    [clip] = (await call(mcp, "list_clips", job_id=job["id"]))["clips"]
    assert clip["status"] == "done", clip
    assert clip["export_preset_id"] == "small"
    assert (clip["export"]["resolution"], clip["export"]["codec"], clip["export"]["quality"]) == (720, "h264", "smallest")


# 06: Style Presets, assets and the Channel Profile


@pytest.mark.anyio
async def test_presets_are_saved_replaced_and_deleted_but_not_builtin_ones(mcp):
    presets = (await call(mcp, "list_presets"))["presets"]
    builtin = next(preset for preset in presets if preset["builtin"])
    assert set(builtin) == {"id", "name", "builtin"}

    saved = await call(mcp, "save_preset", preset={"name": "Mine", "caption": {"size": 90}})
    assert saved["caption"]["size"] == 90
    renamed = await call(mcp, "save_preset", preset_id=saved["id"], preset={"name": "Mine 2"})
    assert renamed["name"] == "Mine 2"
    assert "built in" in await fails(mcp, "save_preset", preset_id=builtin["id"], preset={"name": "x"})
    assert "built in" in await fails(mcp, "delete_preset", preset_id=builtin["id"])
    await call(mcp, "delete_preset", preset_id=saved["id"])
    assert saved["id"] not in {preset["id"] for preset in (await call(mcp, "list_presets"))["presets"]}


async def text_presets(mcp: Client, **options) -> dict[str, dict]:
    return {preset["id"]: preset for preset in (await call(mcp, "list_presets", kind="text", **options))["presets"]}


def used_for_new_titles(presets: dict[str, dict]) -> str:
    [default] = [preset_id for preset_id, preset in presets.items() if preset["default"]]
    return default


@pytest.mark.anyio
async def test_text_presets_are_saved_renamed_and_deleted_and_one_is_used_for_new_titles(mcp):
    presets = await text_presets(mcp)
    assert {"text", "title", "label", "subtitle"} <= presets.keys()
    assert presets["title"]["builtin"] and "style" not in presets["title"]
    assert used_for_new_titles(presets) == "text"
    assert (await text_presets(mcp, include_styles=True))["title"]["style"]["font"] == "anton"

    style = {"font": "anton", "size": 120, "colour": "#ff0000", "plate": {"shape": "block"}}
    saved = await call(mcp, "save_preset", kind="text", preset={"name": "Brand", "style": style}, use_for_new_titles=True)
    assert (saved["name"], saved["builtin"], saved["default"], saved["style"]["colour"]) == ("Brand", False, True, "#FF0000")
    assert used_for_new_titles(await text_presets(mcp)) == saved["id"]
    renamed = await call(mcp, "save_preset", kind="text", preset_id=saved["id"], preset={"name": "Brand 2"})
    assert (renamed["name"], renamed["style"]) == ("Brand 2", saved["style"])
    restyled = await call(mcp, "save_preset", kind="text", preset_id=saved["id"], preset={"name": "Brand 2", "style": {"size": 90}})
    assert (restyled["style"]["size"], restyled["style"]["font"]) == (90, "montserrat-extrabold")

    assert "built in" in await fails(mcp, "save_preset", kind="text", preset_id="title", preset={"name": "x"})
    assert "built in" in await fails(mcp, "delete_preset", kind="text", preset_id="title")
    assert "style" in await fails(mcp, "save_preset", kind="text", preset={"name": "No style"})
    assert "style" in await fails(mcp, "save_preset", preset={"name": "Mixed up", "style": style})
    assert "No Text Preset" in await fails(mcp, "save_preset", kind="text", preset_id="nope", use_for_new_titles=True)

    # A built-in one is used for new titles by its id alone.
    assert (await call(mcp, "save_preset", kind="text", preset_id="label", use_for_new_titles=True))["default"]
    await call(mcp, "save_preset", kind="text", preset_id=saved["id"], use_for_new_titles=True)
    assert await call(mcp, "delete_preset", kind="text", preset_id=saved["id"]) == {"deleted": saved["id"]}
    presets = await text_presets(mcp)
    assert saved["id"] not in presets and used_for_new_titles(presets) == "text"


@pytest.mark.anyio
async def test_a_text_layer_given_without_a_style_takes_the_one_used_for_new_titles_and_keeps_it(mcp):
    style = {"font": "anton", "size": 120, "colour": "#FF0000", "plate": {"shape": "block", "colour": "#FFFFFF", "opacity": 1}}
    brand = await call(mcp, "save_preset", kind="text", preset={"name": "Brand", "style": style}, use_for_new_titles=True)
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    layers = (await call(mcp, "merge_candidate_items", **ids, text_layers=[
        {"id": "plain", "text": "Judul", "start": 0, "secs": 1},
        {"id": "bigger", "text": "Judul", "start": 0, "secs": 1, "style": {"size": 150, "plate": {"opacity": 0.5}}},
    ]))["text_layers"]
    assert layers[0]["style"] == brand["style"]
    assert layers[1]["style"] == brand["style"] | {"size": 150, "plate": brand["style"]["plate"] | {"opacity": 0.5}}
    # A change to one it has keeps its own style.
    [changed, _] = (await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "plain", "style": {"colour": "#00FF00"}}]))["text_layers"]
    assert changed["style"] == brand["style"] | {"colour": "#00FF00"}
    [replaced] = (await call(mcp, "edit_candidate", **ids, changes={"text_layers": [{"id": "new", "text": "Baru", "start": 0, "secs": 1}]}))["text_layers"]
    assert replaced["style"] == brand["style"]

    # Changing or deleting the Preset leaves the layer as it is.
    await call(mcp, "save_preset", kind="text", preset_id=brand["id"], preset={"name": "Brand", "style": {"size": 60}})
    await call(mcp, "delete_preset", kind="text", preset_id=brand["id"])
    assert (await call(mcp, "get_candidate", **ids))["text_layers"] == [replaced]
    # Then built-in Text is used for new titles.
    text = (await text_presets(mcp, include_styles=True))["text"]
    [plain] = (await call(mcp, "edit_candidate", **ids, changes={"text_layers": [{"id": "t", "text": "x", "start": 0, "secs": 1}]}))["text_layers"]
    assert plain["style"] == text["style"]


@pytest.mark.anyio
async def test_logos_and_media_are_added_from_files_and_media_in_use_is_kept(mcp, tmp_path):
    song = make(tmp_path / "song.wav", "-f", "lavfi", "-i", "sine=frequency=330:duration=1")
    logo = make(tmp_path / "logo.png", "-f", "lavfi", "-i", "color=c=blue:size=64x48", "-frames:v", "1")
    text = tmp_path / "notes.txt"
    text.write_text("not media")

    item = await call(mcp, "add_asset", kind="media", path=str(song))
    added = await call(mcp, "add_asset", kind="logo", path=str(logo))
    assert song.is_file() and logo.is_file()
    assets = await call(mcp, "list_assets")
    assert [m["id"] for m in assets["media"]] == [item["id"]]
    assert [l["id"] for l in assets["logos"]] == [added["id"]]
    faces = {face["id"]: face for face in assets["fonts"]}
    assert faces["montserrat-extrabold"]["weight"] == 800 and faces["montserrat-extrabold"]["typographic_family"] == "Montserrat"
    assert "PNG, JPEG or WebP" in await fails(mcp, "add_asset", kind="logo", path=str(text))
    assert await fails(mcp, "add_asset", kind="media", path=str(text))

    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    await call(mcp, "merge_candidate_items", job_id=job["id"], candidate_id=candidate["id"],
               music=[{"id": "song", "media": item["id"], "start": 0, "secs": 1}])
    message = await fails(mcp, "delete_asset", kind="media", asset_id=item["id"])
    assert "Used by clips" in message and candidate["id"] in message
    assert await call(mcp, "delete_asset", kind="logo", asset_id=added["id"]) == {"deleted": added["id"]}


@pytest.mark.anyio
async def test_a_font_is_imported_from_a_file_listed_with_its_licence_and_kept_while_a_style_names_it(mcp, tmp_path):
    font = tmp_path / "Brand[wght].ttf"
    font.write_bytes(font_file("Brand", variable=True, fs_type=RESTRICTED))

    added = await call(mcp, "add_asset", kind="font", path=str(font))
    assert [(face["id"], face["weight"]) for face in added["faces"]] == [("brand-regular", 400), ("brand-bold", 700)]
    assert len(added["warnings"]) == 2 and "may not be embedded" in added["warnings"][0]
    assert (await call(mcp, "add_asset", kind="font", path=str(font)))["faces"] == []
    listed = (await call(mcp, "list_assets", kind="fonts"))["fonts"]
    bold = next(face for face in listed if face["id"] == "brand-bold")
    assert bold["typographic_family"] == "Brand" and bold["restricted"] and bold["licence"] == "Brand is licensed under the Test Licence"
    text = tmp_path / "notes.txt"
    text.write_text("not a font")
    assert "TTF, OTF or TTC" in await fails(mcp, "add_asset", kind="font", path=str(text))

    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    await call(mcp, "merge_candidate_items", job_id=job["id"], candidate_id=candidate["id"], style_overrides={"caption": {"font": "brand-bold"}})
    message = await fails(mcp, "delete_asset", kind="font", asset_id="brand-bold")
    assert candidate["id"] in message and "caption style" in message
    assert await call(mcp, "delete_asset", kind="font", asset_id="brand-regular") == {"deleted": "brand-regular"}
    assert "comes with the app" in await fails(mcp, "delete_asset", kind="font", asset_id="anton")


@pytest.mark.anyio
async def test_the_channel_profile_round_trips(mcp):
    profile = {"niche": "bisnis", "audience": "founder muda", "clip_style": "lucu", "avoid": "politik"}
    assert await call(mcp, "set_channel_profile", profile=profile) == profile
    assert await call(mcp, "get_channel_profile") == profile


# 07: Advanced Edit items


@pytest.mark.anyio
async def test_items_are_merged_by_key_and_removed_keeping_the_others(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    merged = await call(mcp, "merge_candidate_items", **ids, text_layers=[
        {"id": "title", "text": "Judul", "start": 0, "secs": 1, "transform": {"y": 300}},
        {"id": "label", "text": "Label", "start": 0.5, "secs": 0.5},
    ])
    assert [(layer["id"], layer["text"]) for layer in merged["text_layers"]] == [("title", "Judul"), ("label", "Label")]
    merged = await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "text": "Judul baru"}])
    title = merged["text_layers"][0]
    assert (title["id"], title["text"], title["transform"]["y"]) == ("title", "Judul baru", 300)  # the rest kept
    assert "secs" in await fails(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "new", "text": "x"}])

    await call(mcp, "merge_candidate_items", **ids, word_edits=[{"at": 0.1, "text": "Halo"}])
    merged = await call(mcp, "merge_candidate_items", **ids, word_edits=[{"at": 0.1, "text": "HALO"}, {"at": 0.5, "text": "Semua"}])
    assert [(edit["at"], edit["text"]) for edit in merged["word_edits"]] == [(0.1, "HALO"), (0.5, "Semua")]

    await call(mcp, "merge_candidate_items", **ids, style_overrides={"caption": {"size": 90}, "hook": {"size": 100}})
    merged = await call(mcp, "merge_candidate_items", **ids, style_overrides={"caption": {"colour": "#FFEE00"}})
    assert merged["style_overrides"]["caption"] == {"size": 90, "colour": "#FFEE00"}
    assert merged["style_overrides"]["hook"] == {"size": 100}

    removed = await call(mcp, "remove_candidate_items", **ids, kind="text_layers", keys=["label"])
    assert [layer["id"] for layer in removed["text_layers"]] == ["title"]
    removed = await call(mcp, "remove_candidate_items", **ids, kind="word_edits", keys=[0.5])
    assert [edit["at"] for edit in removed["word_edits"]] == [0.1]
    removed = await call(mcp, "remove_candidate_items", **ids, kind="style_overrides", keys=["caption.size"])
    assert removed["style_overrides"]["caption"] == {"colour": "#FFEE00"}
    assert "no text_layers item" in await fails(mcp, "remove_candidate_items", **ids, kind="text_layers", keys=["nope"])

    message = await fails(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "media": "0" * 32, "start": 0, "secs": 1}])
    assert f"no song or video with sound {"0" * 32}" in message


@pytest.mark.anyio
async def test_a_text_layers_style_and_transform_are_merged_field_by_field_and_the_dry_run_lists_its_picture(mcp, client):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    style = {
        "font": "anton", "size": 120, "colour": "#FFE600", "stroke_width": 6, "stroke_colour": "#112233", "line_height": 1.3, "align": "left",
        "plate": {"shape": "block", "colour": "#FFFFFF", "opacity": 0.9, "radius": 30, "padding_x": 40, "padding_y": 20},
    }
    [made] = (await call(mcp, "merge_candidate_items", **ids, text_layers=[
        {"id": "title", "text": "Judul", "start": 0, "secs": 1, "transform": {"x": 300, "y": 400}, "style": style},
    ]))["text_layers"]

    [changed] = (await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "style": {"colour": "#ff0000"}}]))["text_layers"]
    assert changed == made | {"style": made["style"] | {"colour": "#FF0000"}}
    [changed] = (await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "style": {"plate": {"opacity": 0.5}}}]))["text_layers"]
    assert changed["style"]["plate"] == made["style"]["plate"] | {"opacity": 0.5}
    assert changed["transform"] == made["transform"]
    # The shadow by its own fields too, and Strips, tracking and spacing.
    shadow = {"colour": "#330000", "opacity": 0.8, "blur": 6, "distance": 10, "angle": 45}
    [changed] = (await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "style": {
        "shadow": shadow, "tracking": -2, "line_height": 0.9, "plate": {"shape": "strips"},
    }}]))["text_layers"]
    assert changed["style"]["shadow"] == shadow and changed["style"]["plate"]["shape"] == "strips"
    assert (changed["style"]["tracking"], changed["style"]["line_height"]) == (-2, 0.9)
    [changed] = (await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "style": {"shadow": {"angle": 135}}}]))["text_layers"]
    assert changed["style"]["shadow"] == shadow | {"angle": 135}
    assert changed["style"]["plate"] == made["style"]["plate"] | {"opacity": 0.5, "shape": "strips"}
    for bad in ({"blur": -1}, {"opacity": 1.2}):
        assert "shadow" in await fails(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "style": {"shadow": bad}}])
    # The dry run lists its lines, its box and the picture the Clip burns.
    [shown] = (await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True))["text_layers"]
    assert shown["lines"] == ["Judul"]
    bounds = shown["bounds"]
    assert abs(bounds["x"] + bounds["width"] / 2 - 300) <= 1 and abs(bounds["y"] + bounds["height"] / 2 - 400) <= 1
    picture = client.get(shown["picture"])
    assert picture.status_code == 200 and picture.headers["content-type"] == "image/png"
    # Scaled and turned, its box stands twice as large on end about its centre, its lines as they were.
    [turned] = (await call(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "transform": {"scale": 2, "rotation": 90, "opacity": 0.5}}]))["text_layers"]
    assert turned["transform"] == made["transform"] | {"scale": 2, "rotation": 90, "opacity": 0.5}
    [stood] = (await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True))["text_layers"]
    assert stood["lines"] == ["Judul"]
    assert abs(stood["bounds"]["width"] - 2 * bounds["height"]) <= 2 and abs(stood["bounds"]["height"] - 2 * bounds["width"]) <= 2
    assert abs(stood["bounds"]["x"] + stood["bounds"]["width"] / 2 - 300) <= 1 and abs(stood["bounds"]["y"] + stood["bounds"]["height"] / 2 - 400) <= 1
    # A wrap width and a fixed height merged into its style: the dry run lists the lines it wraps to.
    [boxed] = (await call(mcp, "merge_candidate_items", **ids, text_layers=[
        {"id": "title", "text": "Judul yang panjang sekali", "style": {"wrap_width": 400, "fixed_height": 500}, "transform": {"scale": 1, "rotation": 0}},
    ]))["text_layers"]
    assert boxed["style"] == changed["style"] | {"wrap_width": 400, "fixed_height": 500}
    [shown] = (await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True))["text_layers"]
    assert len(shown["lines"]) > 1 and " ".join(shown["lines"]) == "Judul yang panjang sekali"
    assert (shown["bounds"]["width"], shown["bounds"]["height"]) == (400, 500)

    assert "stretched" in await fails(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "transform": {"stretch_x": 2}}])
    assert "flipped" in await fails(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "transform": {"flip_v": True}}])
    # The shape before Text Styles is refused with what replaced it.
    assert "style" in await fails(mcp, "merge_candidate_items", **ids, text_layers=[{"id": "title", "outline": 2}])
    assert "style" in await fails(mcp, "edit_candidate", **ids, changes={"text_layers": [made | {"box": True}]})


@pytest.mark.anyio
async def test_an_overlays_transform_and_crop_are_merged_field_by_field_and_the_dry_run_lists_its_box(mcp, tmp_path):
    # 320x180 fits as 1080x607.5: at 0.5, 540x304.
    picture = make(tmp_path / "wide.png", "-f", "lavfi", "-i", "color=c=red:size=320x180", "-frames:v", "1")
    item = await call(mcp, "add_asset", kind="media", path=str(picture))
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    await call(mcp, "merge_candidate_items", **ids, overlays=[
        {"id": "o1", "media": item["id"], "start": 0, "secs": 1, "transform": {"x": 300, "y": 500, "scale": 0.5, "opacity": 0.8}},
    ])
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "transform": {"rotation": 90}}])
    transform = merged["overlays"][0]["transform"]
    assert (transform["x"], transform["y"], transform["scale"], transform["opacity"], transform["rotation"]) == (300, 500, 0.5, 0.8, 90)
    assert "size" in await fails(mcp, "edit_candidate", **ids, changes={"overlays": [{"id": "o1", "media": item["id"], "start": 0, "secs": 1, "size": 540}]})

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    # Turned a quarter, its 540x304 box stands 304x540 about its centre.
    whole = {"x": 0, "y": 0, "width": 320, "height": 180}
    assert plan["overlays"] == [
        {"id": "o1", "media": item["id"], "start": 0, "end": 1, "bounds": {"x": 148, "y": 230, "width": 304, "height": 540}, "rotation": 90,
         "crop": whole, "opacity": 0.8},
    ]

    # The Crop is merged field by field too, and the dry run gives what it keeps in the item's pixels.
    await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "crop": {"left": 0.25}}])
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "crop": {"bottom": 0.5}}])
    assert merged["overlays"][0]["crop"] == {"left": 0.25, "top": 0, "right": 0, "bottom": 0.5}
    assert merged["overlays"][0]["transform"]["rotation"] == 90
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert plan["overlays"][0]["crop"] == {"x": 80, "y": 0, "width": 240, "height": 90}


@pytest.mark.anyio
async def test_a_video_segments_framing_is_merged_field_by_field(mcp, tmp_path):
    video = make(tmp_path / "broll.mp4", "-f", "lavfi", "-i", "color=c=red:size=320x180:rate=30:duration=2", "-c:v", "libx264")
    item = await call(mcp, "add_asset", kind="media", path=str(video))
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    await call(mcp, "merge_candidate_items", **ids, segments=[
        {"id": "e", "start": candidate["start"], "end": candidate["end"]},
        {"id": "v", "media": item["id"], "start": 0, "end": 1, "framing": {"transform": {"scale": 0.5}}},
    ])
    await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "v", "framing": {"transform": {"rotation": 90}}}])
    merged = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "v", "framing": {"background": {"kind": "colour", "colour": "#112233"}}}])
    framing = merged["segments"][1]["framing"]
    assert (framing["transform"]["scale"], framing["transform"]["rotation"]) == (0.5, 90)
    assert framing["background"] == {"kind": "colour", "colour": "#112233"}
    assert "framing" in await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "e", "framing": {"transform": {"scale": 2}}}])

    # The dry run gives the video's Scene its picture as resolved, as an Overlay's: 540x304 turned a quarter.
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    episode, video = plan["scenes"]
    assert "bounds" not in episode
    assert (video["layout"], video["bounds"], video["rotation"], video["opacity"]) == (
        "media", {"x": 388, "y": 690, "width": 304, "height": 540}, 90, 1,
    )
    assert video["crop"] == {"x": 0, "y": 0, "width": 320, "height": 180}


@pytest.mark.anyio
async def test_old_shape_overlay_and_segment_fields_are_refused_by_merge_with_what_replaced_them(mcp, tmp_path):
    picture = make(tmp_path / "wide.png", "-f", "lavfi", "-i", "color=c=red:size=320x180", "-frames:v", "1")
    item = await call(mcp, "add_asset", kind="media", path=str(picture))
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "media": item["id"], "start": 0, "secs": 1}])

    for old in ({"size": 300}, {"x": 100, "y": 200}, {"opacity": 0.5}):
        message = await fails(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", **old}])
        assert "now in its transform" in message, (old, message)
    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "e", "start": 0.1, "end": 1.6, "fit": "fill"}])
    assert "fit of a Segment is now its framing" in message, message


@pytest.mark.anyio
async def test_an_overlays_border_and_shadow_are_merged_field_by_field_and_turned_off_with_null(mcp, tmp_path):
    picture = make(tmp_path / "wide.png", "-f", "lavfi", "-i", "color=c=red:size=320x180", "-frames:v", "1")
    item = await call(mcp, "add_asset", kind="media", path=str(picture))
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}

    await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "media": item["id"], "start": 0, "secs": 1, "radius": 0.25}])
    # Turned on from a field or two, the rest at their defaults; then changed a field at a time.
    await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "border": {"width": 6}, "shadow": {"y": 30}}])
    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "border": {"colour": "#ff0000"}, "shadow": {"blur": 10}}])
    [overlay] = merged["overlays"]
    assert (overlay["radius"], overlay["border"]) == (0.25, {"width": 6, "colour": "#FF0000"})
    assert overlay["shadow"] == {"blur": 10, "x": 0, "y": 30, "colour": "#000000", "opacity": 0.5}
    assert "width" in await fails(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "border": {"width": 41}}])

    # 540x304: a quarter of 304 is 76 px.
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    [view] = plan["overlays"]
    assert (view["radius"], view["border"], view["shadow"]) == (76, overlay["border"], overlay["shadow"])

    merged = await call(mcp, "merge_candidate_items", **ids, overlays=[{"id": "o1", "border": None}])
    assert (merged["overlays"][0]["border"], merged["overlays"][0]["shadow"]["y"]) == (None, 30)


# Shapes (.scratch/shapes/issues/08-agent-shapes.md)

# A pill behind a title: a rectangle 600x120 rounded to its half, centred where the title is.
PILL = {
    "id": "pill", "start": 0, "secs": 1, "transform": {"x": 540, "y": 960},
    "style": {"kind": "rectangle", "width": 600, "height": 120, "fill": "#112233", "radius": 0.5},
}


@pytest.mark.anyio
async def test_a_pill_is_added_under_a_text_layer_in_one_edit_and_the_dry_run_shows_both(mcp, client):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    title = {"id": "title", "text": "Judul", "start": 0, "secs": 1, "transform": {"x": 540, "y": 960}}

    # And an arrow under it, pointing right: 300 long, 10 thick, its head 40 tall.
    arrow = {"id": "arrow", "start": 0, "secs": 1, "transform": {"x": 540, "y": 1200}, "style": {"kind": "arrow", "width": 300, "stroke_width": 10}}
    edited = await call(mcp, "edit_candidate", **ids, changes={"text_layers": [title], "shapes": [PILL, arrow]})
    pill, _ = edited["shapes"]
    assert (pill["id"], pill["style"]["radius"], pill["style"]["fill"]) == ("pill", 0.5, "#112233")
    assert [layer["id"] for layer in edited["text_layers"]] == ["title"]

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    [shape, pointer], [text] = plan["shapes"], plan["text_layers"]
    assert (shape["id"], shape["start"], shape["end"]) == ("pill", 0, 1)
    assert shape["bounds"] == {"x": 240, "y": 900, "width": 600, "height": 120}
    assert pointer["bounds"] == {"x": 390, "y": 1180, "width": 300, "height": 40}
    assert text["id"] == "title" and abs(text["bounds"]["x"] + text["bounds"]["width"] / 2 - 540) <= 1
    for shown in (shape, text):
        picture = client.get(shown["picture"])
        assert picture.status_code == 200 and picture.headers["content-type"] == "image/png"
    assert shape["picture"] != text["picture"]


@pytest.mark.anyio
async def test_a_shapes_style_and_transform_are_merged_field_by_field_and_shapes_are_removed_by_id(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    shadow = {"colour": "#330000", "opacity": 0.8, "blur": 6, "distance": 10, "angle": 45}
    look = PILL["style"] | {"stroke_colour": "#FFFFFF", "stroke_width": 8, "shadow": shadow}
    [made] = (await call(mcp, "merge_candidate_items", **ids, shapes=[PILL | {"style": look}]))["shapes"]

    [changed] = (await call(mcp, "merge_candidate_items", **ids, shapes=[{"id": "pill", "style": {"fill": "#ff0000"}}]))["shapes"]
    assert changed == made | {"style": made["style"] | {"fill": "#FF0000"}}
    [changed] = (await call(mcp, "merge_candidate_items", **ids, shapes=[{"id": "pill", "style": {"shadow": {"angle": 135}}}]))["shapes"]
    assert changed["style"]["shadow"] == shadow | {"angle": 135} and changed["style"]["fill"] == "#FF0000"
    [changed] = (await call(mcp, "merge_candidate_items", **ids, shapes=[{"id": "pill", "transform": {"rotation": 90}}]))["shapes"]
    assert changed["transform"] == made["transform"] | {"rotation": 90}
    # An outline alone: its fill turned off with null, its stroke kept.
    [changed] = (await call(mcp, "merge_candidate_items", **ids, shapes=[{"id": "pill", "style": {"fill": None}}]))["shapes"]
    assert (changed["style"]["fill"], changed["style"]["stroke_width"]) == (None, 8)

    await call(mcp, "merge_candidate_items", **ids, shapes=[PILL | {"id": "bar"}])
    removed = await call(mcp, "remove_candidate_items", **ids, kind="shapes", keys=["pill"])
    assert [shape["id"] for shape in removed["shapes"]] == ["bar"]
    assert "no shapes item" in await fails(mcp, "remove_candidate_items", **ids, kind="shapes", keys=["nope"])


@pytest.mark.anyio
async def test_a_figure_with_no_stroke_merged_into_a_line_or_an_arrow_is_drawn_in_its_fills_colour(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    white = PILL | {"style": PILL["style"] | {"fill": "#FFFFFF"}}
    await call(mcp, "merge_candidate_items", **ids, shapes=[white, white | {"id": "kept"}, white | {"id": "red"}])

    # As the editor switches one: 12 px thick, white as it showed, not the default black stroke.
    [arrow, kept, red] = (await call(mcp, "merge_candidate_items", **ids, shapes=[{"id": "pill", "style": {"kind": "arrow"}}]))["shapes"]
    assert arrow["style"] | {"kind": "rectangle", "stroke_width": 0, "stroke_colour": "#000000"} == kept["style"]
    assert (arrow["style"]["kind"], arrow["style"]["stroke_width"], arrow["style"]["stroke_colour"]) == ("arrow", 12, "#FFFFFF")
    # What the merge gives of its stroke is kept.
    [_, _, red] = (await call(mcp, "merge_candidate_items", **ids, shapes=[{"id": "red", "style": {"kind": "line", "stroke_colour": "#ff0000"}}]))["shapes"]
    assert (red["style"]["stroke_width"], red["style"]["stroke_colour"]) == (12, "#FF0000")
    [_, kept, _] = (await call(mcp, "merge_candidate_items", **ids, shapes=[{"id": "kept", "style": {"kind": "line", "stroke_width": 4}}]))["shapes"]
    assert (kept["style"]["stroke_width"], kept["style"]["stroke_colour"]) == (4, "#FFFFFF")
    # A line that has a stroke keeps it when switched to an arrow.
    [_, kept, _] = (await call(mcp, "merge_candidate_items", **ids, shapes=[{"id": "kept", "style": {"kind": "arrow"}}]))["shapes"]
    assert (kept["style"]["kind"], kept["style"]["stroke_width"]) == ("arrow", 4)


@pytest.mark.anyio
async def test_a_shape_the_model_refuses_is_a_clear_tool_error(mcp):
    job = await reviewed(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    nothing = PILL | {"style": {"fill": None}}

    assert "nothing to draw" in await fails(mcp, "edit_candidate", **ids, changes={"shapes": [nothing]})
    assert "nothing to draw" in await fails(mcp, "merge_candidate_items", **ids, shapes=[nothing])
    await call(mcp, "merge_candidate_items", **ids, shapes=[PILL])
    assert "nothing to draw" in await fails(mcp, "merge_candidate_items", **ids, shapes=[{"id": "pill", "style": {"fill": None}}])
    assert "stretched" in await fails(mcp, "merge_candidate_items", **ids, shapes=[{"id": "pill", "transform": {"stretch_x": 2}}])
    assert "flipped" in await fails(mcp, "merge_candidate_items", **ids, shapes=[{"id": "pill", "transform": {"flip_h": True}}])
    assert "kind" in await fails(mcp, "merge_candidate_items", **ids, shapes=[{"id": "pill", "style": {"kind": "hexagon"}}])
    # A line or an arrow is all stroke: none with no stroke_width, its thickness.
    line = {"id": "pill", "style": {"kind": "line", "stroke_width": 0}}
    assert "a line is all stroke" in await fails(mcp, "merge_candidate_items", **ids, shapes=[line])
    arrow = PILL | {"id": "arrow", "style": {"kind": "arrow", "stroke_width": 0}}
    assert "an arrow is all stroke" in await fails(mcp, "edit_candidate", **ids, changes={"shapes": [arrow]})
    assert "secs" in await fails(mcp, "merge_candidate_items", **ids, shapes=[{"id": "new", "style": {"fill": "#FFFFFF"}}])
    # Nothing was saved by the refusals.
    [kept] = (await call(mcp, "get_candidate", **ids))["shapes"]
    assert kept["style"]["fill"] == "#112233" and kept["transform"]["stretch_x"] == 1


# 08: agent guidance


@pytest.mark.anyio
async def test_the_tools_fit_their_budget_and_the_glossary_is_a_resource(mcp):
    tools = (await mcp.list_tools()).tools
    size = len(json.dumps([tool.model_dump(mode="json", exclude_none=True) for tool in tools]))
    assert size < TOOLS_BUDGET_BYTES, size
    assert {tool.name for tool in tools} >= {"create_job_from_url", "wait_for_job", "edit_candidate", "render_clips"}
    # The Shape Kinds are named where a Shape is given.
    [edit] = [tool for tool in tools if tool.name == "edit_candidate"]
    for kind in ("rectangle", "ellipse", "triangle", "parallelogram", "trapezoid", "line", "arrow"):
        assert kind in json.dumps(edit.input_schema), kind
    # The instructions say what a Shape's stroke is when not given, and when switched to a line.
    shapes = mcp.instructions[mcp.instructions.index("- A Shape is a figure") :]
    assert "stroke_colour (#000000 by default)" in shapes
    assert "a stroke 12 px thick in its fill's colour" in shapes

    glossary = await mcp.read_resource("ai-clipper://glossary")
    assert "Candidate" in glossary.contents[0].text
