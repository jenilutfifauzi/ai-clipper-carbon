"""Transitions between Segments of the Main Track (.scratch/advanced-edit/issues/08-transitions.md).

Seam B on the planner, then Seam A through the API and the real ffmpeg.
"""

import json
import subprocess
from collections.abc import Callable

import numpy as np
import pytest

from app.candidates import TransitionKind, TransitionSound
from app.planner import Join, SegmentInput, SegmentPlan, TransitionEvent, plan_render
from app.transitions import RECIPES, Recipe
from app.transcript import Word
from app.video_source import SourceMetadata
from test_mcp import HALO_KABAR, KITA_SOAL, anyio_backend, call, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_media_library import make, upload
from test_render import add, full_frame, preview, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import patch
from test_segments import luma, ramp_video, ranges  # noqa: F401

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")


def test_every_kind_has_a_recipe_and_the_first_ten_are_xfades_of_their_names():
    assert set(RECIPES) == set(TransitionKind)
    # Saved Candidates' kinds keep their look: xfade's own transition of the same name, nothing around it.
    for kind in ["fade", "fadeblack", "fadewhite", "slideleft", "slideright", "slideup", "slidedown", "wipeleft", "zoomin", "circleopen"]:
        assert RECIPES[TransitionKind(kind)] == Recipe(xfade=kind)


def test_a_transition_overlaps_the_segments_either_side_and_shortens_the_clip():
    planned = plan_render(
        10, 32, SOURCE,
        main_track=[
            SegmentInput(10, 12, words=[Word("satu", 1.5, 1.9)]),
            SegmentInput(20, 23, join=Join(TransitionKind.FADE, 0.5), words=[Word("dua", 0.1, 0.4)]),
            SegmentInput(30, 32),
        ],
    )
    assert planned.segments == [
        SegmentPlan(0, 2, 10, 12, scenes=1), SegmentPlan(1.5, 4.5, 20, 23, scenes=1), SegmentPlan(4.5, 6.5, 30, 32, scenes=1),
    ]
    assert planned.duration == 6.5
    assert planned.transitions == [TransitionEvent(TransitionKind.FADE, 1.5, 2.0)]
    # Each side's captions stop or start at the transition's middle.
    [first, second] = planned.captions
    assert first.text == "SATU" and first.end <= 1.75 and second.text == "DUA" and second.start >= 1.75


def test_a_transition_is_at_most_half_the_shorter_segment():
    planned = plan_render(10, 23, SOURCE, main_track=[SegmentInput(10, 11), SegmentInput(20, 23, join=Join(TransitionKind.SLIDELEFT, 1.5))])
    assert planned.transitions == [TransitionEvent(TransitionKind.SLIDELEFT, 0.5, 1.0)]
    assert planned.duration == 3.5


def test_a_transitions_sound_is_drawn_with_it_and_linear_by_default():
    planned = plan_render(
        10, 32, SOURCE,
        main_track=[
            SegmentInput(10, 12),
            SegmentInput(20, 23, join=Join(TransitionKind.FADEBLACK, 0.5, TransitionSound.CUT)),
            SegmentInput(30, 32, join=Join(TransitionKind.FADE, 0.4)),
        ],
    )
    assert planned.transitions == [
        TransitionEvent(TransitionKind.FADEBLACK, 1.5, 2.0, TransitionSound.CUT),
        TransitionEvent(TransitionKind.FADE, 4.1, 4.5, TransitionSound.LINEAR),
    ]


def test_transitions_are_saved_and_dropped_with_their_join(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    candidate = patch(client, job, candidate, segments=pieces, transitions=[
        {"after": "s0", "kind": "fade", "secs": 0.4}, {"after": "s1", "kind": "wipeleft"},
    ])
    assert [(t["after"], t["kind"], t["secs"]) for t in candidate["transitions"]] == [("s0", "fade", 0.4), ("s1", "wipeleft", 0.5)]
    assert [event["kind"] for event in preview(client, job, candidate)["plan"]["transitions"]] == ["fade", "wipeleft"]
    for bad in ([{"after": "s0", "kind": "spin"}], [{"after": "s0", "kind": "fade", "secs": 3}]):
        response = client.patch(f"/api/jobs/{job['id']}/candidates/{candidate['id']}", json={"transitions": bad})
        assert response.status_code == 422, bad
    # Deleting s1, and moving s0 to the end, leaves neither join.
    moved = patch(client, job, candidate, segments=[pieces[2], pieces[0]])
    assert moved["transitions"] == []


def test_a_transitions_sound_is_saved_drawn_and_stored_ones_read_as_linear(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    candidate = patch(client, job, candidate, segments=pieces, transitions=[
        {"after": "s0", "kind": "fadeblack", "sound": "cut"}, {"after": "s1", "kind": "fade", "sound": "equal_power"},
    ])
    assert [t["sound"] for t in candidate["transitions"]] == ["cut", "equal_power"]
    assert [e["sound"] for e in preview(client, job, candidate)["plan"]["transitions"]] == ["cut", "equal_power"]
    response = client.patch(f"/api/jobs/{job['id']}/candidates/{candidate['id']}", json={"transitions": [{"after": "s0", "sound": "loud"}]})
    assert response.status_code == 422 and "sound" in response.text
    # Saved before a Transition had a sound.
    path = settings.data_dir / "jobs" / job["id"] / "candidates.json"
    stored = json.loads(path.read_text())
    old = [{"after": "s0", "kind": "fadeblack", "secs": 0.5}]
    path.write_text(json.dumps([c | {"transitions": old} if c["id"] == candidate["id"] else c for c in stored]))
    [read] = [c for c in client.get(f"/api/jobs/{job['id']}").json()["candidates"] if c["id"] == candidate["id"]]
    assert read["transitions"] == [{"after": "s0", "kind": "fadeblack", "secs": 0.5, "sound": "linear"}]
    assert [e["sound"] for e in preview(client, job, read)["plan"]["transitions"]] == ["linear"]


def test_a_crossfade_renders_shorter_with_both_pieces_mixed_in_its_middle(client, settings, video_source, ramp_video):
    video_source.video = ramp_video
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    candidate = patch(
        client, job, candidate, layout="blur",
        segments=ranges(job, ("Podcast", "ya"), ("halo", "semua")),
        transitions=[{"after": "s0", "kind": "fade", "secs": 0.6}],
    )
    planned = preview(client, job, candidate)["plan"]
    [bright, dark] = planned["segments"]
    [fade] = planned["transitions"]
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert clip["output"]["duration"] == pytest.approx(dark["end"], abs=0.1)
    assert clip["output"]["transitions"] == candidate["transitions"]
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
    before = luma(full_frame(settings, video, fade["start"] - 0.2))
    middle = luma(full_frame(settings, video, (fade["start"] + fade["end"]) / 2))
    after = luma(full_frame(settings, video, fade["end"] + 0.2))
    assert before > middle > after
    assert np.isfinite(middle)


@pytest.mark.anyio
async def test_the_agent_sets_a_transitions_sound_and_the_dry_run_shows_it(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    pieces = [{"id": "a", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}, {"id": "b", "start": KITA_SOAL[0], "end": KITA_SOAL[1]}]
    await call(mcp, "edit_candidate", **ids, changes={"segments": pieces, "transitions": [{"after": "a", "kind": "fadewhite"}]})
    merged = await call(mcp, "merge_candidate_items", **ids, transitions=[{"after": "a", "sound": "equal_power"}])
    assert merged["transitions"] == [{"after": "a", "kind": "fadewhite", "secs": 0.5, "sound": "equal_power"}]
    plan = await call(mcp, "edit_candidate", **ids, changes={"transitions": [{"after": "a", "kind": "fade", "sound": "cut"}]}, dry_run=True)
    [crossing] = plan["transitions"]
    assert (crossing["kind"], crossing["sound"]) == ("fade", "cut")


@pytest.fixture(scope="session")
def tones(tmp_path_factory) -> dict[str, bytes]:
    """Two 2 s videos, each with a tone of its own: 500 Hz (`low`) and 1300 Hz (`high`)."""
    folder = tmp_path_factory.mktemp("tones")
    lavfi = ("-f", "lavfi", "-i")
    return {
        name: make(folder / f"{name}.mp4", *lavfi, "color=c=gray:size=320x180:rate=30:duration=2", *lavfi,
                   f"sine=frequency={hz}:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest")
        for name, hz in (("low", 500), ("high", 1300))
    }


def tone_levels(settings, video, rate: int = 8000) -> Callable[[float, float], tuple[float, float, float]]:
    """Of the Clip's sound from `start` to `end` seconds: the 500 Hz tone's level, the 1300 Hz one's
    and the RMS of all of it."""
    command = [str(settings.ffmpeg_bin), "-v", "error", "-i", str(video), "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"]
    samples = np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, dtype=np.int16).astype(float)

    def levels(start: float, end: float) -> tuple[float, float, float]:
        piece = samples[int(start * rate) : int(end * rate)]
        spectrum = np.abs(np.fft.rfft(piece * np.hanning(len(piece))))
        hz = np.fft.rfftfreq(len(piece), 1 / rate)
        at = lambda tone: float(spectrum[np.abs(hz - tone) <= 30].max())  # noqa: E731
        return at(500), at(1300), float(np.sqrt((piece**2).mean()))

    return levels


def test_a_transitions_sound_crosses_linearly_by_equal_power_or_cut_at_its_middle_whatever_its_kind(
    client, settings, video_source, tones,
):
    low, high = (upload(client, tones[name], f"{name}.mp4").json() for name in ("low", "high"))
    job = reviewed(client)
    candidates = {}
    for sound in ("linear", "equal_power", "cut"):
        candidate = add(client, job, "halo", "semua")
        words = {word["text"]: word for word in job["transcript"]["words"]}
        # A dip to black, which never drops the sound out on its own; after a cut from the episode.
        candidates[sound] = patch(client, job, candidate, segments=[
            {"id": "e", "start": words["halo"]["start"], "end": words["semua"]["end"]},
            {"id": "lo", "start": 0, "end": 2, "media": low["id"], "framing": {}},
            {"id": "hi", "start": 0, "end": 2, "media": high["id"], "framing": {}},
        ], transitions=[{"after": "lo", "kind": "fadeblack", "secs": 1.0, "sound": sound}])
    [_, lo_segment, _] = preview(client, job, candidates["cut"])["plan"]["segments"]
    [crossing] = preview(client, job, candidates["cut"])["plan"]["transitions"]
    # The low tone from `at`: the overlap is its second second.
    at = lo_segment["start"]
    assert (crossing["start"], crossing["end"]) == pytest.approx((at + 1, at + 2))
    render(client, job)
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=120)["clips"]}
    level = {}
    for sound, candidate in candidates.items():
        clip = clips[candidate["id"]]
        assert clip["status"] == "done", clip["error"]
        level[sound] = tone_levels(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"])

    def shares(sound: str, start: float, end: float) -> tuple[float, float, float]:
        """From `start` to `end` seconds after `at`: each tone's level and the whole's, as shares of each tone's on its own either side of the overlap."""
        (alone, _, loud), (_, other, loud_after) = (level[sound](at + t, at + t + end - start) for t in (0.3, 2.3))
        lo, hi, rms = level[sound](at + start, at + end)
        return lo / alone, hi / other, rms / ((loud + loud_after) / 2)

    # Linear (acrossfade's tri): each tone in a straight line, half of each at the middle, so the sum dips.
    lo, hi, _ = shares("linear", 1.2, 1.3)
    assert lo == pytest.approx(0.75, abs=0.1) and hi == pytest.approx(0.25, abs=0.1)
    lo, hi, summed = shares("linear", 1.45, 1.55)
    assert lo == pytest.approx(0.5, abs=0.1) and hi == pytest.approx(0.5, abs=0.1) and summed < 0.8
    # Equal power: the summed level near constant at the middle.
    lo, hi, summed = shares("equal_power", 1.45, 1.55)
    assert lo == pytest.approx(0.71, abs=0.1) and hi == pytest.approx(0.71, abs=0.1) and summed == pytest.approx(1, abs=0.12)
    # Cut: only the first tone just before the middle, only the second just after.
    lo, hi, _ = shares("cut", 1.35, 1.45)
    assert lo > 0.85 and hi < 0.05
    lo, hi, _ = shares("cut", 1.55, 1.65)
    assert lo < 0.05 and hi > 0.85
