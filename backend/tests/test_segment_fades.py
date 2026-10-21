"""Segment fades (.scratch/audio-mixing/issues/04-segment-fades-agent-render-preview.md): a Segment's
sound, of the Source or of a video, faded in at its start and out at its end. Seam B on the planner,
then Seam A through the API, MCP and the real ffmpeg: what is heard, and what is refused. The gain
function's Segment cases are test_gain.py's (fixtures/gain_vectors.json)."""

import json
from pathlib import Path

import numpy as np
import pytest

from app.candidates import Framing, MusicClip, TransitionKind
from app.config import FONTS_DIR, RenderTuning
from app.canvas import PORTRAIT
from app.planner import Join, MediaInfo, SegmentInput, gain_at, plan_render
from app.pictures import cover_scale
from app.renderer import Renderer
from test_keyed_volume import tone_level
from test_keyframes import clip_of
from test_media_library import make, upload
from test_media_segments import SOURCE
from test_mcp import HALO_KABAR, KITA_SOAL, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, probe, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch

FIXTURES = Path(__file__).parent / "fixtures"
VIDEO = "ab" * 16
SONG = "ef" * 16
# The video's tone, apart from the Source's 440 Hz.
TONE = 1000
COVER = {"transform": {"scale": cover_scale(640, 360, PORTRAIT.size)}}


def video(start: float, end: float, **fields) -> SegmentInput:
    return SegmentInput(start, end, media=VIDEO, width=640, height=360, framing=Framing(), **fields)


# Seam B: the planner


def test_fades_together_longer_than_a_segment_are_fitted_to_its_timeline_length():
    planned = plan_render(
        10, 18, SOURCE,
        main_track=[
            video(0, 4, fade_in=3, fade_out=3, id="v"),
            # 8 s of the Source at 2×: 4 s on the Timeline.
            SegmentInput(10, 18, speed=2, fade_in=3, fade_out=3, id="e"),
            video(0, 4, fade_in=1, fade_out=0.5, id="w"),
        ], canvas=PORTRAIT,
    )
    fitted, sped, kept = planned.segments
    assert (fitted.fade_in, fitted.fade_out) == (2, 2)
    assert (sped.end - sped.start, sped.fade_in, sped.fade_out) == (4, 2, 2)
    assert (kept.fade_in, kept.fade_out) == (1, 0.5)


def test_a_segments_fades_are_from_its_sound_start_and_to_its_end_a_transitions_overlap_included():
    planned = plan_render(
        10, 13, SOURCE,
        main_track=[
            video(0, 2, fade_out=1, id="v"),
            SegmentInput(10, 13, fade_in=1, volume=0.5, join=Join(TransitionKind.FADE, 1), id="e"),
        ], canvas=PORTRAIT,
    )
    before, after = planned.segments
    [transition] = planned.transitions
    assert (transition.start, transition.end) == (after.start, before.end) == (1, 2)
    # Over the overlap, which the crossfade multiplies (acrossfade): the one before half gone at its
    # middle, the one after (at half its volume) half come.
    assert gain_at(before, 1.5) == pytest.approx(0.5)
    assert gain_at(after, 1.5) == pytest.approx(0.25)
    assert (gain_at(before, 0.5), gain_at(after, 2.5)) == (1, 0.5)


def segmented_command() -> list[str]:
    """The encode of a Clip cut into a video's Segment at half its volume, a Transition, two Segments
    of the Source, and a song, none faded, as the renderer writes it."""
    plan = plan_render(
        10, 15, SOURCE,
        main_track=[
            video(0, 2, volume=0.5, id="v"),
            SegmentInput(10, 12, join=Join(TransitionKind.FADE, 0.5), id="a"),
            SegmentInput(13, 15, id="b"),
        ],
        music=[MusicClip("m", 0.5, 3.0, media=SONG, volume=0.5, fade_in=0.5)],
        media_info={VIDEO: MediaInfo(640, 360, 4.0, True), SONG: MediaInfo(0, 0, 30.0, True)}, canvas=PORTRAIT,
    )
    files = {VIDEO: Path("/media/clip.mp4"), SONG: Path("/media/song.m4a")}
    out = Path("/out")
    command = Renderer(Path("/usr/bin/ffmpeg"), RenderTuning())._command(
        Path("/jobs/source.mp4"), plan, None, "libx264", out / "v.mp4", out / "p.jpg", out / "s.ass", None, files
    )
    # The bundled fonts are wherever the checkout is.
    return [arg.replace(str(FONTS_DIR), "<fonts>") for arg in command]


def test_a_cut_clip_without_fades_renders_the_command_it_did_before_them():
    assert segmented_command() == json.loads((FIXTURES / "segmented_command.json").read_text())


# Seam A: the API and MCP


def test_fades_are_saved_and_refused_on_a_freeze_frame_or_outside_0_to_10_s(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    whole = {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"]}
    # One Segment of the Source played as filmed, faded, is kept as its Segment.
    saved = patch(client, job, candidate, segments=[whole | {"fade_in": 1, "fade_out": 0.5}])
    assert [(segment["fade_in"], segment["fade_out"]) for segment in saved["segments"]] == [(1, 0.5)]
    # Unfaded again, it is the plain range it was.
    assert patch(client, job, saved, segments=[whole])["segments"] == []

    still = {"id": "still", "start": 0.777, "end": 0.777, "hold": 1}
    for segments, message in (
        ([whole, still | {"fade_in": 0.5}], "Segment still is a Freeze frame (hold), which is silent: it has no fades"),
        ([whole | {"fade_out": 10.5}], "less than or equal to 10"),
        ([whole | {"fade_in": -1}], "greater than or equal to 0"),
    ):
        response = client.patch(candidate_url(job, saved), json={"segments": segments})
        assert response.status_code == 422 and message in response.text, (message, response.text)


@pytest.mark.anyio
async def test_the_agent_fades_a_segment_sees_its_fades_in_the_dry_run_and_is_refused_a_freeze_frames(mcp):
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    head = {"id": "a", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}
    tail = {"id": "b", "start": KITA_SOAL[0], "end": KITA_SOAL[1]}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [head, tail]})
    # Merged as any field of a Segment, the others kept.
    merged = await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "b", "fade_out": 0.4}])
    assert [(segment["fade_in"], segment["fade_out"]) for segment in merged["segments"]] == [(0, 0), (0, 0.4)]
    await call(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "fade_in": 0.3}, {"id": "b", "fade_out": 0.5}])

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    first, second = plan["segments"]
    assert (first["fade_in"], "fade_out" in first) == (0.3, False)
    assert ("fade_in" in second, second["fade_out"]) == (False, 0.5)

    message = await fails(mcp, "merge_candidate_items", **ids, segments=[{"id": "a", "fade_in": 11}])
    assert "less than or equal to 10" in message, message
    still = {"id": "still", "start": HALO_KABAR[1], "end": HALO_KABAR[1], "hold": 1, "fade_out": 0.5}
    message = await fails(mcp, "edit_candidate", **ids, changes={"segments": [head, still, tail]})
    assert "Segment still is a Freeze frame (hold), which is silent: it has no fades" in message, message


# Seam A: the real ffmpeg


@pytest.fixture(scope="session")
def toned(tmp_path_factory) -> bytes:
    """A 2.5 s 640x360 video with a TONE Hz tone."""
    lavfi = ("-f", "lavfi", "-i")
    return make(
        tmp_path_factory.mktemp("toned") / "toned.mp4",
        *lavfi, "color=c=green:size=640x360:rate=25:duration=2.5", *lavfi, f"sine=frequency={TONE}:duration=2.5",
        "-c:v", "libx264", "-c:a", "aac", "-shortest",
    )


def level_db(settings, clip: Path, frequency: float, start: float, full: float, secs: float = 0.05) -> float:
    """How loud `frequency` is over `secs` from `start` in the rendered `clip`, in dB from `full`."""
    return 20 * np.log10(max(tone_level(settings, clip, frequency, start, secs), 1e-9) / full)


def heard_db(gain, start: float, secs: float = 0.05) -> float:
    """How loud a sound whose gain at a time is `gain` is heard over `secs` from `start`, in dB, as
    an RMS of its gain sampled there."""
    gains = [gain(time) for time in np.linspace(start, start + secs, 101)]
    return 20 * np.log10(float(np.sqrt(np.mean(np.square(gains)))))


def test_a_source_segment_faded_in_over_1_s_rises_from_silence(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(client, job, candidate, segments=[{"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"], "fade_in": 1}])
    clip = clip_of(client, settings, job, candidate)
    full = tone_level(settings, clip, 440, 1.5)
    assert full > 100

    def faded(time: float) -> float:
        return min(time / 1, 1.0)

    for start in (0.225, 0.475, 0.725):
        # A quarter, a half and three quarters of the level it rises to.
        error = level_db(settings, clip, 440, start, full) - (heard_db(faded, start) - heard_db(faded, 1.5))
        assert abs(error) <= 0.5, (start, error)


def test_a_media_segments_fade_out_ends_in_silence_at_its_end(client, settings, toned):
    item = upload(client, toned, "toned.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    candidate = patch(client, job, candidate, segments=[
        {"id": "v", "start": 0, "end": 2, "media": item["id"], "framing": COVER, "fade_out": 1},
        {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"]},
    ])
    clip = clip_of(client, settings, job, candidate)
    full = tone_level(settings, clip, TONE, 0.5)
    assert full > 100
    # Halfway down halfway through its fade, then nothing left as it ends.
    assert level_db(settings, clip, TONE, 1.475, full) == pytest.approx(heard_db(lambda time: 2 - time, 1.475), abs=0.5)
    assert level_db(settings, clip, TONE, 1.96, full, secs=0.04) < -30
    assert level_db(settings, clip, TONE, 2.2, full) < -40


def test_a_fade_beside_a_transition_multiplies_the_crossfade_and_keeps_the_clips_length(client, settings, toned):
    item = upload(client, toned, "toned.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    shown = {"id": "v", "start": 0, "end": 2, "media": item["id"], "framing": COVER}
    episode = {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"]}
    joined = {"transitions": [{"after": "v", "kind": "fade", "secs": 1}]}
    unfaded = patch(client, job, candidate, segments=[shown, episode], **joined)
    length = preview(client, job, unfaded)["plan"]["segments"][-1]["end"]
    candidate = patch(client, job, unfaded, segments=[shown | {"fade_out": 1}, episode], **joined)
    planned = preview(client, job, candidate)["plan"]
    assert planned["segments"][-1]["end"] == length
    [transition] = planned["transitions"]
    assert (transition["start"], transition["end"]) == (1, 2)

    clip = clip_of(client, settings, job, candidate)
    assert float(probe(settings, clip)["format"]["duration"]) == pytest.approx(length, abs=0.1)
    full = tone_level(settings, clip, TONE, 0.5)

    def heard(time: float) -> float:
        # acrossfade's linear fall over the overlap, times the fade out to the same end.
        return (2 - time) * (2 - time)

    for start in (1.225, 1.475):
        assert level_db(settings, clip, TONE, start, full) == pytest.approx(heard_db(heard, start), abs=0.75), start
