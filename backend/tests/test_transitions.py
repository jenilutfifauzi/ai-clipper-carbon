"""Transitions between Segments of the Main Track (.scratch/advanced-edit/issues/08-transitions.md).

Seam B on the planner, then Seam A through the API and the real ffmpeg.
"""

import json
import subprocess
import time
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
from app.config import load_settings
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
    for bad in ([{"after": "s0", "kind": "swirl"}], [{"after": "s0", "kind": "fade", "secs": 3.5}]):
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
    assert read["transitions"] == [{"after": "s0", "kind": "fadeblack", "secs": 0.5, "sound": "linear", "strength": None, "colour": None}]
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


# .scratch/transitions-expanded/issues/02: xfade's 31 built-ins.


def test_a_three_second_transition_overlaps_long_segments_by_three_seconds():
    planned = plan_render(10, 40, SOURCE, main_track=[SegmentInput(10, 20), SegmentInput(30, 40, join=Join(TransitionKind.COVERLEFT, 3.0))])
    assert planned.transitions == [TransitionEvent(TransitionKind.COVERLEFT, 7.0, 10.0)]
    assert planned.duration == 17.0


def test_a_sample_of_the_new_built_ins_render_a_middle_unlike_either_side_in_a_shorter_clip(client, settings, video_source, ramp_video):
    video_source.video = ramp_video
    job = reviewed(client)
    kinds = ["coverleft", "pixelize", "radial", "rectcrop"]
    candidates = {}
    for kind in kinds:
        candidate = add(client, job, "halo", "ya")
        # The bright end of the ramp into a dimmer moment of it.
        candidates[kind] = patch(
            client, job, candidate, layout="blur",
            segments=ranges(job, ("Podcast", "ya"), ("kita", "soal")),
            transitions=[{"after": "s0", "kind": kind, "secs": 0.6}],
        )
    render(client, job)
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=120)["clips"]}
    for kind, candidate in candidates.items():
        planned = preview(client, job, candidate)["plan"]
        [event] = planned["transitions"]
        assert event["kind"] == kind
        clip = clips[candidate["id"]]
        assert clip["status"] == "done", clip["error"]
        # The two Segments overlap by the Transition's length.
        assert clip["output"]["duration"] == pytest.approx(planned["segments"][1]["end"], abs=0.1)
        assert event["end"] - event["start"] == pytest.approx(0.6)
        video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
        before = luma(full_frame(settings, video, event["start"] - 0.2))
        middle = luma(full_frame(settings, video, (event["start"] + event["end"]) / 2))
        after = luma(full_frame(settings, video, event["end"] + 0.2))
        assert abs(middle - before) > 8 and abs(middle - after) > 8, (kind, before, middle, after)


def test_a_transition_lasts_from_a_tenth_of_a_second_to_three(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    candidate = patch(client, job, candidate, segments=pieces, transitions=[
        {"after": "s0", "kind": "dissolve", "secs": 0.1}, {"after": "s1", "kind": "hlslice", "secs": 3.0},
    ])
    assert [(t["kind"], t["secs"]) for t in candidate["transitions"]] == [("dissolve", 0.1), ("hlslice", 3.0)]
    # Still half the shorter Segment at most.
    [first, second] = preview(client, job, candidate)["plan"]["transitions"]
    assert first["end"] - first["start"] == pytest.approx(0.1)
    shorter = min(piece["end"] - piece["start"] for piece in candidate["segments"][1:])
    assert second["end"] - second["start"] == pytest.approx(shorter / 2, abs=0.01)
    for secs, message in ((0.05, "greater than or equal to 0.1"), (3.5, "less than or equal to 3")):
        response = client.patch(f"/api/jobs/{job['id']}/candidates/{candidate['id']}", json={"transitions": [{"after": "s0", "secs": secs}]})
        assert response.status_code == 422, secs
        [error] = response.json()["detail"]
        assert error["loc"][-1] == "secs" and message in error["msg"], error


# .scratch/transitions-expanded/issues/06: a Transition's sound.


@pytest.mark.anyio
async def test_the_agent_sets_a_transitions_sound_and_the_dry_run_shows_it(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    pieces = [{"id": "a", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}, {"id": "b", "start": KITA_SOAL[0], "end": KITA_SOAL[1]}]
    await call(mcp, "edit_candidate", **ids, changes={"segments": pieces, "transitions": [{"after": "a", "kind": "fadewhite"}]})
    merged = await call(mcp, "merge_candidate_items", **ids, transitions=[{"after": "a", "sound": "equal_power"}])
    assert merged["transitions"] == [{"after": "a", "kind": "fadewhite", "secs": 0.5, "sound": "equal_power", "strength": None, "colour": None}]
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


# .scratch/transitions-expanded/issues/04: strength and colour, and the looks that read them.


def test_a_transitions_strength_and_colour_are_drawn_with_it_and_unset_by_default():
    planned = plan_render(
        10, 32, SOURCE,
        main_track=[
            SegmentInput(10, 12),
            SegmentInput(20, 23, join=Join(TransitionKind.DIPCOLOUR, 0.5, colour="#FF8800")),
            SegmentInput(30, 32, join=Join(TransitionKind.FILMBURN, 0.4, TransitionSound.CUT, strength=0.25)),
        ],
    )
    assert planned.transitions == [
        TransitionEvent(TransitionKind.DIPCOLOUR, 1.5, 2.0, colour="#FF8800"),
        TransitionEvent(TransitionKind.FILMBURN, 4.1, 4.5, TransitionSound.CUT, strength=0.25),
    ]
    assert (planned.transitions[0].strength, planned.transitions[1].colour) == (None, None)


def test_a_transitions_knobs_are_saved_kept_on_any_kind_and_unset_on_stored_ones(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    pieces = ranges(job, ("Podcast", "ya"), ("halo", "semua"), ("kita", "soal"))
    candidate = patch(client, job, candidate, segments=pieces, transitions=[
        {"after": "s0", "kind": "dipcolour", "colour": "#3366FF"}, {"after": "s1", "kind": "rgbsplit", "strength": 0.8},
    ])
    assert [(t["strength"], t["colour"]) for t in candidate["transitions"]] == [(None, "#3366FF"), (0.8, None)]
    events = preview(client, job, candidate)["plan"]["transitions"]
    assert [(e["kind"], e["strength"], e["colour"]) for e in events] == [("dipcolour", None, "#3366FF"), ("rgbsplit", 0.8, None)]
    # A knob on a kind that doesn't read it is kept, so changing back restores it.
    switched = patch(client, job, candidate, transitions=[
        {"after": "s0", "kind": "fade", "colour": "#3366FF", "strength": 0.3}, {"after": "s1", "kind": "wipeleft", "strength": 0.8},
    ])
    assert [(t["kind"], t["strength"], t["colour"]) for t in switched["transitions"]] == [("fade", 0.3, "#3366FF"), ("wipeleft", 0.8, None)]
    for bad, field in (({"strength": 1.5}, "strength"), ({"strength": -0.1}, "strength"), ({"colour": "orange"}, "colour")):
        response = client.patch(f"/api/jobs/{job['id']}/candidates/{candidate['id']}", json={"transitions": [{"after": "s0"} | bad]})
        assert response.status_code == 422 and field in response.text, bad
    # Saved before a Transition had knobs.
    path = settings.data_dir / "jobs" / job["id"] / "candidates.json"
    stored = json.loads(path.read_text())
    old = [{"after": "s0", "kind": "fade", "secs": 0.5, "sound": "linear"}]
    path.write_text(json.dumps([c | {"transitions": old} if c["id"] == candidate["id"] else c for c in stored]))
    [read] = [c for c in client.get(f"/api/jobs/{job['id']}").json()["candidates"] if c["id"] == candidate["id"]]
    assert read["transitions"] == [{"after": "s0", "kind": "fade", "secs": 0.5, "sound": "linear", "strength": None, "colour": None}]


@pytest.fixture(scope="session")
def striped_video(tmp_path_factory):
    """8 s of upright stripes, bright ones that brighten with time (their luma 25 a second) between
    dark ones, with a tone: edges for an RGB split to part."""
    path = tmp_path_factory.mktemp("striped") / "striped.mp4"
    subprocess.run([
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "color=c=black:size=640x360:rate=25:duration=8,format=yuv420p,geq=lum='if(lt(mod(X,64),32),min(250,T*25),20)':cb=128:cr=128",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=8",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
    ], check=True)
    return path


def joined(client, job: dict, kind: str, **knobs) -> dict:
    """A Candidate of two moments of the Source ("Podcast" to "ya", then the darker "kita" to
    "soal") joined by a 0.5 s Transition of `kind`."""
    candidate = add(client, job, "halo", "ya")
    return patch(
        client, job, candidate, layout="blur",
        segments=ranges(job, ("Podcast", "ya"), ("kita", "soal")),
        transitions=[{"after": "s0", "kind": kind, "secs": 0.5, **knobs}],
    )


def test_the_new_looks_render_their_middles_by_their_knobs_in_a_shorter_clip(client, settings, video_source, striped_video):
    video_source.video = striped_video
    job = reviewed(client)
    looks = {
        "dipcolour": joined(client, job, "dipcolour", colour="#3366FF"),
        **{kind: joined(client, job, kind) for kind in ("filmburn", "lightleak", "rgbsplit")},
        **{(kind, strength): joined(client, job, kind, strength=strength) for kind in ("filmburn", "lightleak", "rgbsplit") for strength in (0, 1)},
    }
    render(client, job)
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=180)["clips"]}
    frames = {}
    for look, candidate in looks.items():
        planned = preview(client, job, candidate)["plan"]
        [event] = planned["transitions"]
        clip = clips[candidate["id"]]
        assert clip["status"] == "done", (look, clip["error"])
        assert clip["output"]["duration"] == pytest.approx(planned["segments"][1]["end"], abs=0.1)
        video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
        frames[look] = [full_frame(settings, video, at) for at in (event["start"] - 0.2, (event["start"] + event["end"]) / 2, event["end"] + 0.2)]
    for kind in ("dipcolour", "filmburn", "lightleak", "rgbsplit"):
        before, middle, after = (luma(frame) for frame in frames[kind])
        assert abs(middle - before) > 8 and abs(middle - after) > 8, (kind, before, middle, after)
    # Dip to colour's middle is the colour alone.
    assert np.abs(frames["dipcolour"][1].mean(axis=(0, 1)) - [0x33, 0x66, 0xFF]).max() < 12
    # A film burn and a light leak brighten the middle above either side.
    for kind in ("filmburn", "lightleak"):
        before, middle, after = (luma(frame) for frame in frames[kind])
        assert middle > max(before, after) + 10, (kind, before, middle, after)
    # Their strength shows: none and all of it give unlike middles.
    for kind in ("filmburn", "lightleak", "rgbsplit"):
        weakest, strongest = frames[(kind, 0)][1], frames[(kind, 1)][1]
        assert np.abs(strongest - weakest).mean() > 6, kind


# Every look made of native filters around an xfade (tickets 04 and 05).
NEW_LOOKS = ("dipcolour", "filmburn", "lightleak", "rgbsplit", "blurdissolve", "whipleft", "whipright", "zoomblur", "spin", "glitch")


# How much longer than a fade join a 0.5 s join of any kind may take to render.
RENDER_BUDGET_SECS = 3.0


def test_a_join_of_each_new_look_renders_within_its_budget_of_a_fade(client, settings, video_source, striped_video):
    video_source.video = striped_video
    job = reviewed(client)
    took: dict[str, float] = {}
    # The fade both first and last, its quicker render kept: the first render of a session is slower.
    for kind in ("fade", *NEW_LOOKS, "fade"):
        candidate = joined(client, job, kind)
        began = time.monotonic()
        render(client, job, [candidate["id"]])
        [clip] = [clip for clip in rendered(client, job, timeout=60)["clips"] if clip["candidate_id"] == candidate["id"]]
        took[kind] = min(took.get(kind, float("inf")), time.monotonic() - began)
        assert clip["status"] == "done", (kind, clip["error"])
    assert all(secs < took["fade"] + RENDER_BUDGET_SECS for secs in took.values()), took


# .scratch/transitions-expanded/issues/05: Concat's moving looks.


def turned(frame: np.ndarray) -> bool:
    """Whether the shot's upright stripes lie across in the middle of the frame: it changes more
    from row to row than from column to column there."""
    shot = frame[800:1120, 300:780].mean(axis=2)
    return np.abs(np.diff(shot, axis=0)).mean() > np.abs(np.diff(shot, axis=1)).mean()


def across(frame: np.ndarray) -> float:
    """How sharp the shot's upright stripes are: the mean change from column to column."""
    return float(np.abs(np.diff(frame[700:1220].mean(axis=2), axis=1)).mean())


def test_the_moving_looks_render_their_middles_by_their_strength_in_a_shorter_clip(client, settings, video_source, striped_video):
    video_source.video = striped_video
    job = reviewed(client)
    kinds = ("blurdissolve", "whipleft", "whipright", "zoomblur", "spin", "glitch")
    looks = {
        **{kind: joined(client, job, kind) for kind in (*kinds, "fade", "slideleft")},
        **{(kind, strength): joined(client, job, kind, strength=strength) for kind in kinds for strength in (0, 1)},
    }
    render(client, job)
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=240)["clips"]}
    frames = {}
    for look, candidate in looks.items():
        planned = preview(client, job, candidate)["plan"]
        [event] = planned["transitions"]
        clip = clips[candidate["id"]]
        assert clip["status"] == "done", (look, clip["error"])
        assert clip["output"]["duration"] == pytest.approx(planned["segments"][1]["end"], abs=0.1)
        video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
        frames[look] = [full_frame(settings, video, at) for at in (event["start"] - 0.2, (event["start"] + event["end"]) / 2, event["end"] + 0.2)]
    for kind in kinds:
        before, middle, after = frames[kind]
        assert np.abs(middle - before).mean() > 8 and np.abs(middle - after).mean() > 8, kind
    # A spin turns both pictures: half a turn in all is a quarter of one at the middle.
    assert not turned(frames["spin"][0]) and turned(frames[("spin", 0)][1]) and not turned(frames["spin"][2])
    # A whip pan smears the pictures across as they move: the outgoing one is going off the side
    # the whip heads for, the incoming one coming in from the other.
    assert across(frames["whipleft"][1]) < across(frames["slideleft"][1]) / 2
    before, after = luma(frames["fade"][0]), luma(frames["fade"][2])
    for kind, (outgoing, incoming) in {"whipleft": (slice(0, 540), slice(540, 1080)), "whipright": (slice(540, 1080), slice(0, 540))}.items():
        middle = frames[kind][1][700:1220]
        assert abs(middle[:, outgoing].mean() - before) < abs(middle[:, outgoing].mean() - after), kind
        assert abs(middle[:, incoming].mean() - after) < abs(middle[:, incoming].mean() - before), kind
    # Their strength shows: none and all of it give unlike middles.
    for kind in kinds:
        weakest, strongest = frames[(kind, 0)][1], frames[(kind, 1)][1]
        assert np.abs(strongest - weakest).mean() > 6, kind


@pytest.mark.anyio
async def test_the_agent_sets_a_transitions_knobs_alone_and_the_dry_run_shows_them(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    pieces = [{"id": "a", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}, {"id": "b", "start": KITA_SOAL[0], "end": KITA_SOAL[1]}]
    await call(mcp, "edit_candidate", **ids, changes={"segments": pieces, "transitions": [{"after": "a", "kind": "dipcolour", "sound": "cut"}]})
    merged = await call(mcp, "merge_candidate_items", **ids, transitions=[{"after": "a", "colour": "#ff8800"}])
    assert merged["transitions"] == [{"after": "a", "kind": "dipcolour", "secs": 0.5, "sound": "cut", "strength": None, "colour": "#FF8800"}]
    merged = await call(mcp, "merge_candidate_items", **ids, transitions=[{"after": "a", "strength": 0.4}])
    assert (merged["transitions"][0]["strength"], merged["transitions"][0]["colour"]) == (0.4, "#FF8800")
    plan = await call(mcp, "edit_candidate", **ids, changes={"transitions": [{"after": "a", "kind": "filmburn", "strength": 0.9}]}, dry_run=True)
    [crossing] = plan["transitions"]
    assert (crossing["kind"], crossing["strength"]) == ("filmburn", 0.9) and "colour" not in crossing
    plan = await call(mcp, "edit_candidate", **ids, changes={}, dry_run=True)
    assert plan["transitions"][0]["colour"] == "#FF8800"
    # The instructions say which kinds read which knob.
    told = mcp.instructions[mcp.instructions.index("- A Transition") :]
    told = told[: told.index("\n- ")]
    assert "Light (filmburn, lightleak)" in told
    strength, colour = told[told.index("`strength`") : told.index("`colour`")], told[told.index("`colour`") : told.index("Its sound")]
    assert all(kind in strength for kind in ("filmburn", "lightleak", "rgbsplit", "blurdissolve", "whipleft", "whipright", "zoomblur", "spin", "glitch"))
    assert "dipcolour" in colour
    assert "whipleft" in told[told.index("Slide (") :].split(")")[0] and "spin" in told[told.index("Zoom (") :].split(")")[0]
