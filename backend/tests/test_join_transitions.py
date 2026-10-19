"""A Style Preset's Join Transition (.scratch/transitions-expanded/issues/09-join-transition.md): the
rule on the cases the editor's tests read too (fixtures/join_transitions.json), then through the API
and the agent."""

import json
from dataclasses import asdict
from pathlib import Path

import pytest
from pydantic import TypeAdapter

from app.candidates import Transition, with_join_transition
from app.styles import JoinTransition
from test_render import add, reviewed
# The Source the Candidates are cut from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_mcp import HALO_KABAR, KITA_SOAL, anyio_backend, call, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_review import patch
from test_segments import ranges

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "join_transitions.json").read_text())


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda case: case["name"])
def test_every_new_join_without_a_transition_gets_the_join_transition_as_the_shared_cases_say(case):
    given = case.get("join", CASES["join"])
    join = None if given is None else TypeAdapter(JoinTransition).validate_python(given)
    transitions = TypeAdapter(list[Transition]).validate_python(case["transitions"])
    joined = with_join_transition(case["before"], case["after"], transitions, join)
    assert [asdict(transition) for transition in joined] == case["expected"]


CROSSFADE = {"kind": "dissolve", "secs": 0.8, "sound": "equal_power", "strength": 0.4, "colour": None}


def test_a_presets_join_transition_is_saved_and_returned_and_none_on_built_in_and_stored_ones(client, settings):
    presets = client.get("/api/presets").json()
    assert all(preset["join_transition"] is None for preset in presets if preset["builtin"])
    made = client.post("/api/presets", json={"name": "House", "join_transition": {"kind": "fadeblack"}})
    assert made.status_code == 201, made.text
    assert made.json()["join_transition"] == {"kind": "fadeblack", "secs": 0.5, "sound": "linear", "strength": None, "colour": None}
    url = f"/api/presets/{made.json()['id']}"
    assert client.put(url, json={"name": "House", "join_transition": CROSSFADE}).json()["join_transition"] == CROSSFADE
    assert client.get("/api/presets").json()[-1]["join_transition"] == CROSSFADE
    assert client.put(url, json={"name": "House", "join_transition": None}).json()["join_transition"] is None
    assert client.put(url, json={"name": "House", "join_transition": {"kind": "fade", "secs": 4}}).status_code == 422
    # Saved before Presets had a Join Transition.
    client.put(url, json={"name": "House", "join_transition": CROSSFADE})
    path = settings.data_dir / "presets.json"
    stored = json.loads(path.read_text())
    path.write_text(json.dumps([{key: value for key, value in preset.items() if key != "join_transition"} for preset in stored]))
    assert client.get("/api/presets").json()[-1]["join_transition"] is None


def test_an_update_changing_segments_fills_new_joins_unless_it_states_transitions(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    house = client.post("/api/presets", json={"name": "House", "join_transition": CROSSFADE}).json()
    # Switching to the Preset touches no join.
    candidate = patch(client, job, candidate, preset_id=house["id"])
    assert candidate["transitions"] == []
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    cut = patch(client, job, candidate, segments=pieces)
    assert cut["transitions"] == [{"after": "s0", **CROSSFADE}, {"after": "s1", **CROSSFADE}]
    # Stated, the Transitions are taken as they are: s2's new join is left a cut.
    stated = patch(client, job, cut, segments=[pieces[0], pieces[2], pieces[1]], transitions=[{"after": "s0", "kind": "fade"}])
    assert [(t["after"], t["kind"]) for t in stated["transitions"]] == [("s0", "fade")]
    # Removing one, the join it was at isn't new: it stays a cut.
    removed = patch(client, job, stated, transitions=[])
    assert removed["transitions"] == []
    # Moving s1 first: s1–s0 is new (s0–s2 isn't).
    moved = patch(client, job, removed, segments=[pieces[1], pieces[0], pieces[2]])
    assert moved["transitions"] == [{"after": "s1", **CROSSFADE}]


def test_changing_a_candidates_preset_leaves_its_transitions_as_they_are(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"))
    candidate = patch(client, job, candidate, segments=pieces, transitions=[{"after": "s0", "kind": "wipeleft"}])
    house = client.post("/api/presets", json={"name": "House", "join_transition": CROSSFADE}).json()
    for preset_id in (house["id"], "default"):
        assert patch(client, job, candidate, preset_id=preset_id)["transitions"] == candidate["transitions"]


@pytest.mark.anyio
async def test_the_agent_saves_a_join_transition_and_its_cuts_get_it_unless_it_states_the_transitions(mcp):
    saved = await call(mcp, "save_preset", preset={"name": "House", "join_transition": {"kind": "fadeblack", "secs": 0.3}})
    assert saved["join_transition"] == {"kind": "fadeblack", "secs": 0.3, "sound": "linear", "strength": None, "colour": None}
    [listed] = [p for p in (await call(mcp, "list_presets", include_styles=True))["presets"] if p["id"] == saved["id"]]
    assert listed["join_transition"] == saved["join_transition"]
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"preset_id": saved["id"]})
    pieces = [{"id": "a", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}, {"id": "b", "start": KITA_SOAL[0], "end": KITA_SOAL[1]}]
    cut = await call(mcp, "edit_candidate", **ids, changes={"segments": pieces})
    assert cut["transitions"] == [{"after": "a", **saved["join_transition"]}]
    stated = await call(mcp, "edit_candidate", **ids, changes={"segments": pieces[::-1], "transitions": []})
    assert stated["transitions"] == []
    # The instructions tell the rule, and that a stated list is taken as is.
    rule = mcp.instructions[mcp.instructions.index("- A Style Preset's join_transition") :]
    assert "new join" in rule[:600] and "taken as" in rule[:600]
