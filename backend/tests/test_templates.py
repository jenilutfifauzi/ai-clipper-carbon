"""Templates (.scratch/templates/issues/01-tracer-save-and-apply-layers.md; docs/adr/0023): a
Candidate's layers saved with their Anchors, and put on Candidates of other lengths.

Seam B on the pure `capture` and `apply`, then Seam A through the API and MCP."""

import json
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from app.candidates import AdjustmentLayer, Keyframe, MusicClip, Shape, ShapeStyle, TextLayer, manual_candidate
from app.templates import (
    Anchor,
    AnchorKind,
    AnchorOverride,
    Boundary,
    Edge,
    LayerKind,
    Template,
    apply,
    capture,
)
from app.jobs import CANDIDATES_FILE
from test_jobs_api import create_job
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp, reviewed  # noqa: F401 (fixtures)
from test_review import candidates, patch
from test_selection import analyzed, clip

SONG = "a" * 32
NOW = datetime(2026, 10, 22, tzinfo=UTC)


def candidate(secs: float, **edits):
    """A Candidate whose Clip lasts `secs`, uncut: its Main Slot is the whole Clip."""
    return replace(manual_candidate(f"c{secs:g}", 100.0, 100.0 + secs), **edits)


def lower_third(**fields) -> TextLayer:
    return TextLayer(**{"id": "name", "text": "Jeni", "start": 2.0, "secs": 3.0, **fields})


def call_to_action(**fields) -> TextLayer:
    return TextLayer(**{"id": "cta", "text": "Follow", "start": 14.0, "secs": 4.0, **fields})


def bed(**fields) -> MusicClip:
    return MusicClip(**{"id": "bed", "media": SONG, "start": 0.0, "secs": 20.0, **fields})


def template_of(layers) -> Template:
    return Template("brand", "Brand", NOW, NOW, layers)


def anchor_of(layers, kind: LayerKind, item_id: str) -> Anchor:
    [anchor] = [layer.anchor for listed_kind, layer in layers.items() if (listed_kind, layer.item.id) == (kind, item_id)]
    return anchor


# Capture


def test_each_edge_hangs_from_its_nearest_boundary():
    middle = TextLayer("middle", "Halo", start=8.0, secs=3.0)
    captured = capture(candidate(20, text_layers=[lower_third(), call_to_action(), middle], music=[bed()]))

    layers = captured.layers
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "name") == Anchor(Edge(Boundary.MAIN_START, 2.0), Edge(Boundary.MAIN_START, 5.0))
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "cta") == Anchor(Edge(Boundary.MAIN_END, -6.0), Edge(Boundary.MAIN_END, -2.0))
    assert anchor_of(layers, LayerKind.MUSIC, "bed") == Anchor(Edge(Boundary.MAIN_START, 0.0), Edge(Boundary.MAIN_END, 0.0))
    # Each edge on its own: nearer the start at 8 s, nearer the end at 11 s.
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "middle") == Anchor(Edge(Boundary.MAIN_START, 8.0), Edge(Boundary.MAIN_END, -9.0))
    assert [anchor_of(layers, kind, item_id).kind for kind, item_id in (
        (LayerKind.TEXT_LAYERS, "name"), (LayerKind.TEXT_LAYERS, "cta"), (LayerKind.MUSIC, "bed"),
    )] == [AnchorKind.START, AnchorKind.END, AnchorKind.SPAN]
    assert captured.notices == []


def test_a_start_end_or_span_override_is_stored_as_its_edges():
    middle = TextLayer("middle", "Halo", start=8.0, secs=3.0)
    overrides = [
        AnchorOverride(LayerKind.TEXT_LAYERS, "name", AnchorKind.END),
        AnchorOverride(LayerKind.TEXT_LAYERS, "cta", AnchorKind.START),
        AnchorOverride(LayerKind.TEXT_LAYERS, "middle", AnchorKind.START),
        AnchorOverride(LayerKind.MUSIC, "bed", AnchorKind.SPAN),
    ]
    layers = capture(candidate(20, text_layers=[lower_third(), call_to_action(), middle], music=[bed()]), overrides).layers

    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "name") == Anchor(Edge(Boundary.MAIN_END, -18.0), Edge(Boundary.MAIN_END, -15.0))
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "cta") == Anchor(Edge(Boundary.MAIN_START, 14.0), Edge(Boundary.MAIN_START, 18.0))
    assert anchor_of(layers, LayerKind.TEXT_LAYERS, "middle") == Anchor(Edge(Boundary.MAIN_START, 8.0), Edge(Boundary.MAIN_START, 11.0))
    assert anchor_of(layers, LayerKind.MUSIC, "bed") == Anchor(Edge(Boundary.MAIN_START, 0.0), Edge(Boundary.MAIN_END, 0.0))


def test_an_override_of_a_layer_the_candidate_hasnt_is_refused():
    with pytest.raises(ValueError, match="no Text Layer gone"):
        capture(candidate(20), [AnchorOverride(LayerKind.TEXT_LAYERS, "gone", AnchorKind.END)])


def test_music_clips_of_the_sources_sound_are_left_out_with_a_notice():
    episode = MusicClip("voice", start=0.0, secs=5.0, offset=300.0)
    captured = capture(candidate(20, music=[episode, bed(detached_from="main")]))

    assert [layer.item.id for layer in captured.layers.music] == ["bed"]
    # A Template's song is no longer Detached from a Segment of the Candidate it was saved from.
    assert captured.layers.music[0].item.detached_from is None
    assert captured.notices == ["1 Music Clip of the episode's sound left out: a Template plays only Media Library items."]


def test_every_kind_of_layer_is_captured():
    shape = Shape("plate", start=1.0, secs=2.0, style=ShapeStyle(fill="#000000"))
    adjust = AdjustmentLayer("warm", start=0.0, secs=20.0)
    layers = capture(candidate(20, shapes=[shape], adjustment_layers=[adjust])).layers

    assert [(kind, layer.item.id) for kind, layer in layers.items()] == [(LayerKind.SHAPES, "plate"), (LayerKind.ADJUSTMENT_LAYERS, "warm")]


# Apply


@pytest.mark.parametrize("secs", [20, 75])
def test_a_start_lower_third_and_an_end_call_to_action_keep_their_distances(secs):
    template = template_of(capture(candidate(20, text_layers=[lower_third(), call_to_action()])).layers)

    applied = apply(template, candidate(secs))

    name, cta = applied.change.text_layers
    assert (name.start, name.secs) == (2.0, 3.0)
    assert (cta.start, cta.secs) == (secs - 6.0, 4.0)
    assert applied.notices == []


@pytest.mark.parametrize("secs", [20, 75])
def test_a_span_layer_stretches_to_cover_the_main_slot(secs):
    adjust = AdjustmentLayer("warm", start=0.0, secs=20.0, fade_in=1.0, fade_out=1.0)
    template = template_of(capture(candidate(20, music=[bed()], adjustment_layers=[adjust])).layers)

    applied = apply(template, candidate(secs))

    [song] = applied.change.music
    [warm] = applied.change.adjustment_layers
    assert (song.start, song.secs, song.offset) == (0.0, secs, 0.0)
    assert (warm.start, warm.secs, warm.fade_in, warm.fade_out) == (0.0, secs, 1.0, 1.0)


def test_applied_layers_carry_the_templates_mark_and_hand_made_ones_are_kept():
    template = template_of(capture(candidate(20, text_layers=[lower_third()], music=[bed()])).layers)
    mine = TextLayer("name", "Mine", start=10.0, secs=2.0)

    applied = apply(template, candidate(30, text_layers=[mine]))

    assert [(layer.id, layer.text, layer.template) for layer in applied.change.text_layers] == [
        ("name", "Mine", None),
        # A new id where the Candidate has the Template's own.
        ("name-2", "Jeni", "brand"),
    ]
    assert [clip.template for clip in applied.change.music] == ["brand"]
    # The Template's own layers are kept unmarked.
    assert all(layer.item.template is None for _, layer in template.layers.items())


def test_applying_again_replaces_the_template_items_rather_than_doubling_them():
    template = template_of(capture(candidate(20, text_layers=[lower_third()])).layers)
    once = apply(template, candidate(30)).change

    twice = apply(template, candidate(30, text_layers=once.text_layers)).change

    assert [(layer.id, layer.template) for layer in twice.text_layers] == [("name", "brand")]


def test_a_layer_past_a_short_clips_end_is_trimmed_there_or_left_out():
    keyed = lower_third(keys={"opacity": [Keyframe(0.0, 1.0), Keyframe(3.0, 0.0)]})
    template = template_of(capture(candidate(20, text_layers=[keyed, TextLayer("late", "Late", start=6.0, secs=2.0)])).layers)

    applied = apply(template, candidate(3))

    [name] = applied.change.text_layers
    assert (name.start, name.secs) == (2.0, 1.0)
    # Its Keyframes follow the cut, as the Clipboard's do.
    assert [key.at for key in name.keys["opacity"]] == [0.0, 1.0]
    assert applied.notices == ["1 layer cut short to fit; 1 left out, falling outside the clip."]


# Through the API

URL = "/api/templates"
LOWER_THIRD = {"id": "name", "text": "Jeni", "start": 2.0, "secs": 3.0}
CALL_TO_ACTION = {"id": "cta", "text": "Follow", "start": 14.0, "secs": 4.0}
PLATE = {"id": "plate", "start": 0.0, "secs": 20.0, "style": {"fill": "#000000"}}


def added(client, job: dict, start: float, end: float) -> dict:
    response = client.post(f"/api/jobs/{job['id']}/candidates", json={"start": start, "end": end})
    assert response.status_code == 201, response.text
    return response.json()


def branded(client, wait_for_status, llm) -> tuple[dict, dict]:
    """A Job in review, and a Candidate of it lasting 20 s with a lower-third, a call to action
    and a plate under the whole Clip."""
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    source = added(client, job, 600.0, 620.0)
    assert source["end"] - source["start"] == pytest.approx(20, abs=1)
    length = source["end"] - source["start"]
    source = patch(
        client, job, source,
        text_layers=[LOWER_THIRD, {**CALL_TO_ACTION, "start": length - 6}], shapes=[{**PLATE, "secs": length}],
    )
    return job, source


def saved(client, job: dict, candidate: dict, name: str = "Brand", **body) -> dict:
    response = client.post(URL, json={"name": name, "job_id": job["id"], "candidate_id": candidate["id"], **body})
    assert response.status_code == 201, response.text
    return response.json()


def applied(client, job: dict, template: dict, candidates: list[dict], **body) -> dict:
    ids = [candidate["id"] for candidate in candidates]
    response = client.post(f"/api/jobs/{job['id']}/templates/apply", json={"template_id": template["id"], "candidate_ids": ids, **body})
    assert response.status_code == 200, response.text
    return response.json()


def test_a_capture_preview_gives_the_guessed_anchors_without_saving(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)

    response = client.post(f"{URL}/capture", json={"job_id": job["id"], "candidate_id": source["id"]})

    assert response.status_code == 200, response.text
    layers = response.json()["layers"]
    assert [layer["anchor"]["start"]["boundary"] for layer in layers["text_layers"]] == ["main_start", "main_end"]
    assert layers["shapes"][0]["anchor"]["end"]["boundary"] == "main_end"
    assert client.get(URL).json() == []


def test_templates_are_saved_listed_renamed_saved_over_and_deleted(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)

    template = saved(client, job, source, anchors=[{"kind": "text_layers", "id": "name", "anchor": "span"}])
    assert (template["name"], template["notices"]) == ("Brand", [])
    assert template["layers"]["text_layers"][0]["anchor"]["end"]["boundary"] == "main_end"
    assert [listed["id"] for listed in client.get(URL).json()] == [template["id"]]

    renamed = client.patch(f"{URL}/{template['id']}", json={"name": "Brand 2"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Brand 2"

    # Saved over from the draft of an edit, which isn't saved: the id is kept.
    over = client.put(
        f"{URL}/{template['id']}",
        json={"name": "Brand 3", "job_id": job["id"], "candidate_id": source["id"], "edits": {"text_layers": [LOWER_THIRD]}},
    )
    assert over.status_code == 200, over.text
    assert (over.json()["id"], over.json()["name"]) == (template["id"], "Brand 3")
    assert [layer["item"]["id"] for layer in over.json()["layers"]["text_layers"]] == ["name"]
    assert [listed["name"] for listed in client.get(URL).json()] == ["Brand 3"]
    assert len(candidates_of(client, job, source)["text_layers"]) == 2

    assert client.delete(f"{URL}/{template['id']}").status_code == 204
    assert client.get(URL).json() == []
    assert client.delete(f"{URL}/{template['id']}").status_code == 404
    assert client.patch(f"{URL}/{template['id']}", json={"name": "x"}).status_code == 404


def test_a_template_of_an_unknown_candidate_or_anchor_is_refused(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)

    assert client.post(URL, json={"name": "x", "job_id": job["id"], "candidate_id": "00000000"}).status_code == 404
    response = client.post(
        URL, json={"name": "x", "job_id": job["id"], "candidate_id": source["id"], "anchors": [{"kind": "shapes", "id": "gone", "anchor": "end"}]}
    )
    assert response.status_code == 422
    assert "no Shape gone" in response.json()["detail"]


def candidates_of(client, job: dict, candidate: dict) -> dict:
    [found] = [c for c in candidates(client, job) if c["id"] == candidate["id"]]
    return found


def test_applying_to_three_candidates_changes_each_by_one_revision_in_one_request(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)
    targets = [added(client, job, 700.0, 712.0), added(client, job, 800.0, 875.0), source]

    result = applied(client, job, template, targets)

    assert [entry["candidate_id"] for entry in result["candidates"]] == [target["id"] for target in targets]
    for target, entry in zip(targets, result["candidates"]):
        now = candidates_of(client, job, target)
        length = now["end"] - now["start"]
        assert now["revision"] == target["revision"] + 1 == entry["revision"]
        assert entry["edits"]["text_layers"] == now["text_layers"]
        name, cta = [layer for layer in now["text_layers"] if layer["template"] == template["id"]]
        assert (name["start"], name["secs"]) == (2.0, 3.0)
        assert cta["start"] + cta["secs"] == pytest.approx(length - 2, abs=0.01)
        [plate] = [shape for shape in now["shapes"] if shape["template"] == template["id"]]
        assert plate["secs"] == pytest.approx(length, abs=0.01)
        history = client.get(f"/api/jobs/{job['id']}/candidates/{target['id']}/revisions").json()
        newest = history["revisions"][0]
        assert (newest["revision"], newest["parts"]) == (now["revision"], ["Text Layers", "Shapes"])
    # Its own hand-made layers became Template items' copies beside them: none of them is marked.
    assert [layer["template"] for layer in candidates_of(client, job, source)["text_layers"]] == [None, None, template["id"], template["id"]]


def test_a_dry_run_saves_nothing(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)
    target = added(client, job, 700.0, 712.0)

    result = applied(client, job, template, [target], dry_run=True)

    [entry] = result["candidates"]
    assert entry["revision"] == target["revision"]
    assert [layer["template"] for layer in entry["edits"]["text_layers"]] == [template["id"]] * 2
    assert candidates_of(client, job, target) == target


def test_an_unknown_candidate_fails_the_whole_batch(client, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)
    target = added(client, job, 700.0, 712.0)

    response = client.post(
        f"/api/jobs/{job['id']}/templates/apply", json={"template_id": template["id"], "candidate_ids": [target["id"], "00000000"]}
    )

    assert response.status_code == 404
    assert candidates_of(client, job, target) == target
    unknown = {"template_id": "nope", "candidate_ids": [target["id"]]}
    assert client.post(f"/api/jobs/{job['id']}/templates/apply", json=unknown).status_code == 404


def test_a_job_not_in_review_is_refused(client, video_source, from_episode, llm, wait_for_status):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)

    video_source.hold()
    try:
        running = create_job(client)
        wait_for_status(running["id"], "downloading")
        for dry_run in (False, True):
            response = client.post(
                f"/api/jobs/{running['id']}/templates/apply", json={"template_id": template["id"], "candidate_ids": ["x"], "dry_run": dry_run}
            )
            assert response.status_code == 409
            assert "while it is in review" in response.json()["detail"]
    finally:
        video_source.release()


def test_a_candidates_marks_are_kept_through_edits_and_one_saved_before_marks_loads_unchanged(
    client, settings, from_episode, llm, wait_for_status
):
    job, source = branded(client, wait_for_status, llm)
    template = saved(client, job, source)
    target = added(client, job, 700.0, 712.0)
    applied(client, job, template, [target])

    now = candidates_of(client, job, target)
    edited = patch(client, job, now, hook_text="Edited", text_layers=now["text_layers"])
    assert [layer["template"] for layer in edited["text_layers"]] == [template["id"]] * 2

    path = settings.data_dir / "jobs" / job["id"] / CANDIDATES_FILE
    stored = json.loads(path.read_text())
    for candidate in stored:
        for kind in ("text_layers", "shapes", "music", "overlays", "adjustment_layers"):
            candidate[kind] = [{k: v for k, v in item.items() if k != "template"} for item in candidate[kind]]
    path.write_text(json.dumps(stored))
    unmarked = candidates_of(client, job, source)
    assert unmarked["revision"] == source["revision"]
    assert [layer["template"] for layer in unmarked["text_layers"]] == [None, None]


# Through MCP


@pytest.mark.anyio
async def test_templates_are_saved_listed_with_their_anchors_applied_and_deleted_through_mcp(mcp):
    job = await reviewed(mcp)
    source = await manual(mcp, job, *HALO_KABAR)
    length = source["end"] - source["start"]
    ids = {"job_id": job["id"], "candidate_id": source["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"text_layers": [
        {"id": "name", "text": "Jeni", "start": 0.1, "secs": 0.3},
        {"id": "cta", "text": "Follow", "start": length - 0.5, "secs": 0.4},
    ]})

    template = await call(mcp, "save_preset", kind="template", preset={
        "name": "Brand", **ids, "anchors": [{"kind": "text_layers", "id": "cta", "anchor": "span"}],
    })
    assert template["name"] == "Brand"
    [listed] = (await call(mcp, "list_presets", kind="template"))["presets"]
    assert (listed["id"], listed["name"]) == (template["id"], "Brand")
    assert [(layer["kind"], layer["id"], layer["anchor"]) for layer in listed["layers"]] == [
        ("text_layers", "name", "start"), ("text_layers", "cta", "span"),
    ]
    assert listed["layers"][0]["edges"] == [{"boundary": "main_start", "offset": 0.1}, {"boundary": "main_start", "offset": 0.4}]

    # Saved over by its id, which is kept; renamed alone.
    over = await call(mcp, "save_preset", kind="template", preset_id=template["id"], preset={"name": "Brand 2", **ids})
    assert (over["id"], over["name"]) == (template["id"], "Brand 2")
    assert (await call(mcp, "save_preset", kind="template", preset_id=template["id"], preset={"name": "Brand 3"}))["name"] == "Brand 3"

    target = await manual(mcp, job, *HALO_KABAR)
    dry = await call(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=template["id"], dry_run=True)
    [entry] = dry["candidates"]
    assert [layer["template"] for layer in entry["edits"]["text_layers"]] == [template["id"]] * 2
    assert (await call(mcp, "get_candidate", job_id=job["id"], candidate_id=target["id"]))["text_layers"] == []

    await call(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=template["id"])
    marked = (await call(mcp, "get_candidate", job_id=job["id"], candidate_id=target["id"]))["text_layers"]
    assert [(layer["id"], layer["template"]) for layer in marked] == [("name", template["id"]), ("cta", template["id"])]

    assert await call(mcp, "delete_preset", kind="template", preset_id=template["id"]) == {"deleted": template["id"]}
    assert (await call(mcp, "list_presets", kind="template"))["presets"] == []
    assert "No Template" in await fails(mcp, "apply_template", job_id=job["id"], candidate_ids=[target["id"]], template_id=template["id"])
