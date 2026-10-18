"""A Source Segment's Volume Line and volume Keyframes (.scratch/audio-mixing/issues/06): Seam B on
the planner, then Seam A through the API, MCP and the real ffmpeg. Its volume is keyed as a media
Segment's is, and the Clip's own sound (`source_volume`) still scales it."""

import numpy as np
import pytest

from app.candidates import EASE_IN, Keyframe, KeyProperty
from app.keyframes import value_at
from app.planner import SegmentInput, plan_render
from test_keyed_volume import songs, tone_level  # noqa: F401
from test_keyframes import clip_of
from test_media_library import upload
from test_media_segments import SOURCE
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch

DIP = [Keyframe(1.0, 1.0), Keyframe(2.0, 0.25, EASE_IN)]


# Seam B: the planner


def test_a_source_segments_volume_keyframes_are_its_gain_track_in_its_own_seconds():
    planned = plan_render(10, 14, SOURCE, main_track=[SegmentInput(10, 12, id="a"), SegmentInput(12, 14, keys={KeyProperty.VOLUME: DIP}, id="b")])
    [plain, keyed] = planned.segments
    assert (plain.gain, keyed.gain, keyed.start) == ([], DIP, 2.0)
    # A sound's Keyframes don't move its picture: the Source's is framed by its Layouts.
    assert all(not scene.picture or not scene.picture.motion for scene in planned.scenes)


# Seam A: the API and MCP


def by_text(job: dict) -> dict[str, dict]:
    return {word["text"]: word for word in job["transcript"]["words"]}


def test_volume_keyframes_are_kept_on_a_source_segment_and_its_picture_and_a_freeze_frames_sound_are_refused(client):
    job = reviewed(client)
    words = by_text(job)
    candidate = add(client, job, "halo", "semua")
    dip = [{"at": 0.2, "value": 1}, {"at": 0.8, "value": 0.25, "ease": "ease_in"}]
    episode = {"id": "e", "start": candidate["start"], "end": candidate["end"], "keys": {"volume": dip}}
    saved = patch(client, job, candidate, segments=[episode])
    # One Segment of the Source, keyed: kept as its Segment, not folded into the Clip's range.
    assert [segment["id"] for segment in saved["segments"]] == ["e"]
    assert saved["segments"][0]["keys"]["volume"][1] == {"at": 0.8, "value": 0.25, "ease": [0.42, 0, 1, 1]}
    [planned] = preview(client, job, saved)["plan"]["segments"]
    assert [key["value"] for key in planned["gain"]] == [1, 0.25]
    # So is one at its own volume; one as filmed, at 1, is the Clip's range again.
    assert patch(client, job, saved, segments=[episode | {"keys": {}, "volume": 0.5}])["segments"][0]["volume"] == 0.5
    assert patch(client, job, saved, segments=[episode | {"keys": {}}])["segments"] == []

    still = {"id": "s", "start": words["semua"]["start"], "end": words["semua"]["start"], "hold": 1}
    for segments, message in (
        ([episode | {"keys": {"x": [{"at": 0, "value": 300}]}}], "Segment e shows the episode, whose Layouts frame it: it has no x Keyframes, only volume ones"),
        ([episode, still | {"keys": {"volume": [{"at": 0, "value": 0.5}]}}], "Segment s is a Freeze frame (hold), which is silent: it has no volume Keyframes"),
        ([episode | {"keys": {"volume": [{"at": 0, "value": 2.5}]}}], "volume is 0 to 2"),
    ):
        response = client.patch(candidate_url(job, saved), json={"segments": segments})
        assert response.status_code == 422 and message in response.text, (segments, response.text)


def test_a_source_segments_keyframes_stay_on_its_words_when_its_ends_snap_to_them(client):
    """Its edges are snapped to Words by the server; its volume Keyframes move with the speech."""
    job = reviewed(client)
    words = by_text(job)
    candidate = add(client, job, "kita", "soal")
    # From inside "kita" (it snaps earlier, to before it) to well into the silence after "soal" (it
    # snaps earlier too, to just after it), so that the last Keyframe would be past its end.
    start, end = words["kita"]["start"] + 0.05, words["soal"]["end"] + 1.0
    assert end < words["Podcast"]["start"]
    given = [Keyframe(0.3, 1.0), Keyframe(round(end - start, 3), 0.25)]
    keys = {"volume": [{"at": key.at, "value": key.value} for key in given]}
    [saved] = patch(client, job, candidate, segments=[{"id": "e", "start": start, "end": end, "keys": keys}])["segments"]
    assert saved["start"] < start and saved["end"] < end
    stored = [Keyframe(key["at"], key["value"]) for key in saved["keys"]["volume"]]
    assert all(0 <= key.at <= saved["end"] - saved["start"] + 1e-6 for key in stored), stored
    # Over the speech both ranges play, the same volume at the same moment of the Source.
    for moment in np.linspace(start, saved["end"], 23):
        assert value_at(stored, moment - saved["start"], 1) == pytest.approx(value_at(given, moment - start, 1), abs=0.002), moment


@pytest.mark.anyio
async def test_the_agent_keys_a_source_segments_volume_and_dry_runs_it(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    middle = round((candidate["start"] + candidate["end"]) / 2, 3)
    halves = [{"id": "a", "start": candidate["start"], "end": middle}, {"id": "b", "start": middle, "end": candidate["end"]}]
    await call(mcp, "edit_candidate", **ids, changes={"segments": halves})
    dip = {"volume": [{"at": 0, "value": 1}, {"at": 0.3, "value": 0.2, "ease": "ease_out"}]}
    merged = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "b", "keys": dip}])
    assert merged["segments"][1]["keys"]["volume"][1]["value"] == 0.2

    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "b", "keys": {"scale": [{"at": 0, "value": 2}]}}])
    assert "Segment b shows the episode, whose Layouts frame it: it has no scale Keyframes" in message, message

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    [sound] = plan["sounds"]
    start = plan["segments"][1]["start"]
    assert sound == {
        "id": "b", "media": None, "start": start, "end": plan["segments"][1]["end"],
        "keys": {"volume": [{"at": start, "value": 1, "ease": "linear"}, {"at": round(start + 0.3, 3), "value": 0.2, "ease": "ease_out"}]},
    }


# Seam A: the real ffmpeg


def test_a_source_segment_keyed_from_1_to_a_quarter_is_as_loud_as_its_sampled_gain_and_the_clips_own_sound_scales_it(
    client, settings, video_source, plain_video, songs,
):
    """The Source's 440 Hz tone follows the Segment's Keyframes; a song's steady 880 Hz tone under it
    is the measure, in the same window, so that the loudness pass, which turns both alike, cancels out."""
    video_source.video = plain_video
    tone = upload(client, songs["tone"], "tone.wav").json()
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    assert candidate["end"] - candidate["start"] > 2.3
    dip = [{"at": 1, "value": 1}, {"at": 2, "value": 0.25, "ease": "ease_in"}]
    episode = {"id": "e", "start": candidate["start"], "end": candidate["end"], "keys": {"volume": dip}}
    under = {"id": "m", "media": tone["id"], "start": 0.0, "secs": 2.3}
    candidate = patch(client, job, candidate, segments=[episode], music=[under])

    def ratios(video) -> dict[float, float]:
        return {start: tone_level(settings, video, 440, start) / tone_level(settings, video, 880, start) for start in (0.7, 1.475, 2.1)}

    whole = ratios(clip_of(client, settings, job, candidate))
    for start in (1.475, 2.1):
        times = np.linspace(start, start + 0.05, 101)
        heard = float(np.sqrt(np.mean(np.square([value_at(DIP, time, 0) for time in times]))))
        error = 20 * np.log10(whole[start] / whole[0.7]) - 20 * np.log10(heard)
        assert abs(error) <= 0.5, (start, whole[start] / whole[0.7], heard)

    # The Clip's own sound at a half halves it, keyed as it is: 6 dB down at every time.
    halved = ratios(clip_of(client, settings, job, patch(client, job, candidate, source_volume=0.5)))
    for start, ratio in whole.items():
        assert 20 * np.log10(halved[start] / ratio) == pytest.approx(20 * np.log10(0.5), abs=0.5), start
