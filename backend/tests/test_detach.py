"""Detach and Reattach (.scratch/audio-mixing/issues/09-detach-and-reattach.md, docs/adr/0016): a
Segment's sound moved onto a Music Clip with `detached_from`, the Segment Muted. Seam A through the
API, MCP and the real ffmpeg: the back-reference must name a Segment when it is added or changed, a
saved one outlives its Segment, and a Detached sound is heard as the Segment was, then where it is
moved to."""

import numpy as np
import pytest

from app.candidates import MusicClip
from test_keyed_volume import tone_level
from test_keyframes import clip_of
from test_media_library import make, upload
from test_mcp import HALO_KABAR, KITA_SOAL, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, reviewed
from test_review import candidate_url, patch
from test_source_music import STEADY, from_sweeping, sweep_at, sweeping  # noqa: F401


def test_a_stored_music_clip_is_detached_from_nothing():
    assert MusicClip("m", 0.0, 1.0, media="ab" * 16).detached_from is None


# Seam A: the API and MCP


def _words(job: dict) -> dict[str, dict]:
    return {word["text"]: word for word in job["transcript"]["words"]}


def test_detached_from_must_name_a_segment_when_added_or_changed_and_a_saved_one_outlives_it(client):
    job = reviewed(client)
    words = _words(job)
    candidate = add(client, job, "halo", "ya")
    segments = [
        {"id": "a", "start": words["halo"]["start"], "end": words["kabar"]["end"], "muted": True},
        {"id": "b", "start": words["Podcast"]["start"], "end": words["ya"]["end"]},
    ]
    detached = {"id": "d", "start": 0.0, "secs": 1.5, "offset": words["halo"]["start"], "detached_from": "a"}
    saved = patch(client, job, candidate, segments=segments, music=[detached])
    assert saved["music"][0]["detached_from"] == "a"
    assert saved["music"][0]["media"] is None

    message = "Music Clip {} is Detached from Segment z, which the clip doesn't have"
    for music, clip in (
        ([detached, {**detached, "id": "x", "detached_from": "z"}], "x"),  # added
        ([{**detached, "detached_from": "z"}], "d"),  # changed
    ):
        response = client.patch(candidate_url(job, saved), json={"music": music})
        assert response.status_code == 422 and message.format(clip) in response.text, response.text
        draft = client.post(f"/api/jobs/{job['id']}/candidates/{saved['id']}/preview-plan", json={"music": music})
        assert draft.status_code == 422 and message.format(clip) in draft.text, draft.text

    # Segment a removed: its Detached sound keeps naming it, and still does once moved.
    saved = patch(client, job, saved, segments=[segments[1]])
    assert saved["music"][0]["detached_from"] == "a"
    saved = patch(client, job, saved, music=[{**detached, "start": 0.5}])
    assert (saved["music"][0]["start"], saved["music"][0]["detached_from"]) == (0.5, "a")
    # But a new one can't name it any more.
    response = client.patch(candidate_url(job, saved), json={"music": [{**detached, "start": 0.5}, {**detached, "id": "e"}]})
    assert response.status_code == 422 and "Music Clip e is Detached from Segment a" in response.text, response.text


def test_the_sound_of_an_uncut_clip_is_detached_from_its_one_segment(client):
    """An uncut Clip's Main Track is one Segment, `main`, as the editor names it."""
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    whole = {"id": "main", "start": candidate["start"], "end": candidate["end"], "muted": True}
    detached = {"id": "d", "start": 0.0, "secs": 1.0, "offset": candidate["start"], "detached_from": "main"}
    saved = patch(client, job, candidate, segments=[whole], music=[detached])
    assert (saved["segments"][0]["muted"], saved["music"][0]["detached_from"]) == (True, "main")
    # Reattached: the Music Clip removed and the Segment unmuted, an uncut Clip again.
    saved = patch(client, job, saved, segments=[{**whole, "muted": False}], music=[])
    assert (saved["segments"], saved["music"]) == ([], [])


@pytest.mark.anyio
async def test_the_agent_detaches_and_reattaches_with_ordinary_edits(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, HALO_KABAR[0], KITA_SOAL[1])
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    segments = [{"id": "a", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}, {"id": "b", "start": KITA_SOAL[0], "end": KITA_SOAL[1]}]
    await call(mcp, "edit_candidate", **ids, changes={"segments": segments})
    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    [a, _] = plan["segments"]

    refused = await fails(mcp, "merge_candidate_items", **ids, music=[{"id": "d", "start": 0, "secs": 1, "offset": a["source_start"], "detached_from": "z"}])
    assert "Music Clip d is Detached from Segment z, which the clip doesn't have" in refused, refused

    # Detach a, in one merge: its sound onto a Music Clip of the episode where it plays, and a Muted.
    detached = {"id": "d", "start": a["start"], "secs": round(a["end"] - a["start"], 3), "offset": a["source_start"], "detached_from": "a"}
    saved = await call(mcp, "merge_candidate_items", **ids, music=[detached], segments=[{"id": "a", "muted": True}])
    assert (saved["music"][0]["detached_from"], saved["segments"][0]["muted"]) == ("a", True)

    # Reattach: the Music Clips Detached from it removed, then its `muted` cleared.
    await call(mcp, "remove_candidate_items", **ids, kind="music", keys=["d"])
    saved = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "muted": False}])
    assert (saved["music"], saved["segments"][0]["muted"]) == ([], False)

    # Detached again, then Segment a removed: its Detached sound keeps naming it, moved by a merge too.
    await call(mcp, "merge_candidate_items", **ids, music=[detached], segments=[{"id": "a", "muted": True}])
    await call(mcp, "remove_candidate_items", **ids, kind="segments", keys=["a"])
    saved = await call(mcp, "merge_candidate_items", **ids, music=[{"id": "d", "start": 0.2}])
    assert (saved["music"][0]["start"], saved["music"][0]["detached_from"]) == (0.2, "a")


# Seam A: the real ffmpeg


@pytest.fixture(scope="session")
def steady_song(tmp_path_factory) -> bytes:
    """A 10 s song of a steady STEADY Hz tone, at the sweep's level: the measure every level is read against."""
    return make(
        tmp_path_factory.mktemp("steady-song") / "steady.wav",
        "-f", "lavfi", "-i", f"sine=frequency={STEADY}:sample_rate=44100:duration=10",
    )


def test_a_detached_sound_is_heard_as_its_segment_was_and_a_second_later_once_moved(client, settings, steady_song):
    """The episode's sweep (its pitch says which moment it is) in two Source Segments: a, halo..kabar
    at 1.5× with fades and volume Keyframes, then b. Detached, a's sound is a Music Clip of the
    episode that the render hears as a's own was, a now Muted; moved a second later, it is heard a
    second later. A steady song over the whole Clip is the measure in each window."""
    song = upload(client, steady_song, "steady.wav").json()
    job = reviewed(client)
    words = _words(job)
    candidate = add(client, job, "halo", "ya")
    dip = [{"at": 0.3, "value": 1}, {"at": 0.6, "value": 0.5}]
    a = {"id": "a", "start": words["halo"]["start"], "end": words["kabar"]["end"], "speed": 1.5, "fade_in": 0.2, "fade_out": 0.2, "keys": {"volume": dip}}
    b = {"id": "b", "start": words["Podcast"]["start"], "end": words["ya"]["end"]}
    measure = {"id": "m", "media": song["id"], "start": 0.0, "secs": 3.0}
    candidate = patch(client, job, candidate, segments=[a, b], music=[measure])
    # Where a plays, snapped to Words, and its Keyframes as saved (kept on their moments by the snap).
    [played, _] = preview(client, job, candidate)["plan"]["segments"]
    a = candidate["segments"][0]
    # Within its fade in, at full volume, keyed down to a half, and within its fade out.
    moments = (0.1, 0.3, 0.75, 0.95)

    def heard(candidate: dict, shift: float = 0.0) -> tuple[list[float], list[float]]:
        """The Candidate rendered: the level (dB) of a's moment `at` seconds into it, against the
        steady song there, for each of the `moments`, `shift` seconds later in the Clip; and at `at`.
        (Each render of the Candidate replaces its Clip, so it is read at once.)"""
        video = clip_of(client, settings, job, candidate)

        def level(at: float, when: float) -> float:
            moment = sweep_at(played["source_start"] + 1.5 * at)
            return 20 * np.log10(tone_level(settings, video, moment, when, secs=0.02) / tone_level(settings, video, STEADY, when, secs=0.02))

        return [level(at, at + shift) for at in moments], [level(at, at) for at in moments]

    before, _ = heard(candidate)
    assert min(before) > -20, before

    detached = {
        "id": "d", "start": played["start"], "secs": round(played["end"] - played["start"], 3), "offset": played["source_start"],
        "speed": 1.5, "fade_in": 0.2, "fade_out": 0.2, "keys": a["keys"], "detached_from": "a",
    }
    candidate = patch(client, job, candidate, segments=[{**a, "muted": True}, b], music=[measure, detached])
    assert candidate["segments"][0]["muted"]
    after, _ = heard(candidate)
    assert after == pytest.approx(before, abs=1)

    candidate = patch(client, job, candidate, music=[measure, {**detached, "start": played["start"] + 1}])
    later, where_it_was = heard(candidate, 1.0)
    assert later == pytest.approx(before, abs=1)
    assert all(now < was - 20 for now, was in zip(where_it_was, before)), where_it_was
