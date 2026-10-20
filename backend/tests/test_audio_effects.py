"""Audio Effects on Segments (.scratch/audio-effects/issues/01-segment-effects-in-the-render.md, ADR
0017): the catalogue run by the real ffmpeg over a tone; Seam B on the planner; then Seam A through
the API, MCP and the real ffmpeg: what is heard, and what is refused."""

import subprocess
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from app.audio_effects import AudioEffect, checked_effects, effect_chain, effects
from app.config import load_settings
from app.planner import SegmentInput, plan_render
from test_keyed_volume import tone_level
from test_keyframes import clip_of
from test_media_library import make, upload
from test_media_segments import SOURCE
from test_mcp import HALO_KABAR, KITA_SOAL, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import SOURCE_SECS, add, preview, probe, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segment_fades import COVER, TONE, level_db

RATE = 48000


def samples(filters: list[str], source: str = "sine=frequency=440:sample_rate=48000:duration=1") -> np.ndarray:
    """The mono samples of the lavfi `source` played through `filters`, at RATE."""
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error", "-f", "lavfi", "-i", source,
        "-af", ",".join([*filters, f"aformat=sample_rates={RATE}:channel_layouts=mono"]) if filters else f"aformat=sample_rates={RATE}:channel_layouts=mono",
        "-f", "f32le", "-",
    ]
    return np.frombuffer(subprocess.run(command, capture_output=True, check=True).stdout, dtype=np.float32)


# The catalogue


@pytest.mark.parametrize("corner", ["default", "min", "max"])
@pytest.mark.parametrize("effect", effects(), ids=lambda effect: effect.id)
def test_each_effect_runs_at_its_default_minimum_and_maximum_and_keeps_a_1_s_tones_length(effect, corner):
    params = {setting.key: getattr(setting, corner) for setting in effect.settings}
    heard = samples(effect_chain([AudioEffect(effect.id, params)], RATE, 1.0))
    assert len(heard) == RATE, len(heard)
    assert np.isfinite(heard).all()


def test_a_setting_left_out_takes_its_default_and_a_bad_entry_is_refused_naming_the_item_index_and_why():
    [echo] = checked_effects([AudioEffect("echo", {"delay": 0.5})], "Segment s")
    assert echo == AudioEffect("echo", {"delay": 0.5, "decay": 0.4})
    for stack, message in (
        ([echo, AudioEffect("flanger")], "Segment s's audio_effects[1]: there is no audio effect 'flanger'"),
        ([AudioEffect("echo", {"feedback": 0.5})], "Segment s's audio_effects[0] (echo) has no setting 'feedback': its settings are delay, decay"),
        ([AudioEffect("pitch", {"semitones": 13})], "Segment s's audio_effects[0] (pitch) semitones is 13; it is -12 to 12"),
    ):
        with pytest.raises(ValueError) as refused:
            checked_effects(stack, "Segment s")
        assert message in str(refused.value)


def test_a_disabled_entry_adds_nothing_to_the_chain():
    telephone = AudioEffect("telephone", {"drive": 3})
    assert effect_chain([replace(telephone, enabled=False)], RATE, 1.0) == []
    assert effect_chain([replace(telephone, enabled=False), AudioEffect("echo", {"delay": 0.25, "decay": 0.4})], RATE, 1.0) == effect_chain(
        [AudioEffect("echo", {"delay": 0.25, "decay": 0.4})], RATE, 1.0
    )


# Seam B: the planner


def test_a_segments_enabled_effects_reach_its_plan_in_order_and_one_without_has_none():
    echo, telephone = AudioEffect("echo", {"delay": 0.25, "decay": 0.4}), AudioEffect("telephone", {"drive": 3})
    planned = plan_render(
        10, 14, SOURCE,
        main_track=[
            SegmentInput(10, 12, id="a", audio_effects=[telephone, replace(echo, enabled=False), echo]),
            SegmentInput(12, 14, id="b"),
        ],
    )
    effected, plain = planned.segments
    assert effected.audio_effects == [telephone, echo]
    assert plain.audio_effects == []


# Seam A: the API and MCP


def test_a_stack_is_saved_with_its_defaults_filled_and_a_bad_one_or_a_freeze_frames_is_refused(client):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    words = {word["text"]: word for word in job["transcript"]["words"]}
    whole = {"id": "e", "start": words["halo"]["start"], "end": words["soal"]["end"]}
    echo = {"id": "echo", "params": {"delay": 0.5}}
    # One Segment of the Source played as filmed, with effects, is kept as its Segment.
    saved = patch(client, job, candidate, segments=[whole | {"audio_effects": [echo, {"id": "telephone", "enabled": False}]}])
    assert saved["segments"][0]["audio_effects"] == [
        {"id": "echo", "params": {"delay": 0.5, "decay": 0.4}, "enabled": True},
        {"id": "telephone", "params": {"drive": 3}, "enabled": False},
    ]
    # Without them, it is the plain range it was.
    assert patch(client, job, saved, segments=[whole])["segments"] == []

    still = {"id": "still", "start": 0.777, "end": 0.777, "hold": 1}
    for segments, message in (
        ([whole | {"audio_effects": [echo, {"id": "flanger"}]}], "Segment e's audio_effects[1]: there is no audio effect 'flanger'"),
        ([whole | {"audio_effects": [{"id": "echo", "params": {"feedback": 1}}]}], "Segment e's audio_effects[0] (echo) has no setting 'feedback'"),
        ([whole | {"audio_effects": [{"id": "pitch", "params": {"semitones": -13}}]}], "Segment e's audio_effects[0] (pitch) semitones is -13; it is -12 to 12"),
        ([whole, still | {"audio_effects": [echo]}], "Segment still is a Freeze frame (hold), which is silent: it has no audio effects"),
    ):
        response = client.patch(candidate_url(job, saved), json={"segments": segments})
        assert response.status_code == 422 and message in response.text, (message, response.text)


# Seam A: the real ffmpeg


@pytest.fixture(scope="session")
def low_and_high(tmp_path_factory) -> Path:
    """A Source like render_video, but sounding 150 Hz and 1000 Hz together."""
    lavfi = ("-f", "lavfi", "-i")
    path = tmp_path_factory.mktemp("low-and-high") / "source.mp4"
    make(
        path, *lavfi, "color=c=0x4a5560:size=640x360:rate=25", *lavfi, "aevalsrc=0.3*sin(2*PI*150*t)+0.3*sin(2*PI*1000*t):s=44100",
        "-t", str(SOURCE_SECS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    )
    return path


@pytest.fixture(scope="session")
def beeps(tmp_path_factory) -> dict[str, bytes]:
    """2.5 s videos: one with a TONE Hz tone throughout, one with it for its first second only."""
    folder = tmp_path_factory.mktemp("beeps")
    lavfi = ("-f", "lavfi", "-i")
    picture = (*lavfi, "color=c=green:size=640x360:rate=25:duration=2.5")
    return {
        name: make(folder / f"{name}.mp4", *picture, *lavfi, sound, "-c:v", "libx264", "-c:a", "aac", "-shortest")
        for name, sound in (
            ("toned", f"sine=frequency={TONE}:duration=2.5"),
            ("beep", f"aevalsrc=0.5*sin(2*PI*{TONE}*t)*lt(t\\,1):s=44100:d=2.5"),
        )
    }


def segment_of(job: dict, first: str, last: str, **fields) -> dict:
    """A Segment of the Source from Word `first` to Word `last`."""
    words = {word["text"]: word for word in job["transcript"]["words"]}
    return {"start": words[first]["start"], "end": words[last]["end"], **fields}


def test_telephone_on_a_source_segment_takes_most_of_its_sound_under_300_hz_away(client, settings, video_source, low_and_high):
    video_source.video = low_and_high
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    # 1.5 s as filmed, then 1 s through Telephone.
    candidate = patch(client, job, candidate, segments=[
        segment_of(job, "halo", "kabar", id="a"), segment_of(job, "kita", "soal", id="b", audio_effects=[{"id": "telephone"}]),
    ])
    clip = clip_of(client, settings, job, candidate)
    low, high = tone_level(settings, clip, 150, 0.5, 0.2), tone_level(settings, clip, 1000, 0.5, 0.2)
    assert low > 100 and high > 100
    # Under a tenth of its energy left, the voice band kept.
    assert tone_level(settings, clip, 150, 2.0, 0.2) < 0.3 * low
    assert tone_level(settings, clip, 1000, 2.0, 0.2) > 0.5 * high


def test_pitch_up_12_semitones_moves_a_440_hz_tone_to_880_hz_at_the_same_length(client, settings):
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    candidate = patch(client, job, candidate, segments=[
        segment_of(job, "halo", "kabar", id="a"), segment_of(job, "kita", "soal", id="b", audio_effects=[{"id": "pitch", "params": {"semitones": 12}}]),
    ])
    length = preview(client, job, candidate)["plan"]["segments"][-1]["end"]
    clip = clip_of(client, settings, job, candidate)
    assert float(probe(settings, clip)["format"]["duration"]) == pytest.approx(length, abs=0.05)
    full = tone_level(settings, clip, 440, 0.5, 0.2)
    assert full > 100
    assert tone_level(settings, clip, 880, 0.5, 0.2) < 0.05 * full
    assert tone_level(settings, clip, 880, 2.0, 0.2) > 0.5 * full
    assert tone_level(settings, clip, 440, 2.0, 0.2) < 0.05 * full


def test_an_echo_on_a_media_segment_is_heard_after_its_tone_stops_and_not_past_its_end(client, settings, beeps):
    item = upload(client, beeps["beep"], "beep.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    # The beep stops 1 s in; its echo comes 0.5 s later, and the Segment ends at 1.25 s.
    echo = {"id": "echo", "params": {"delay": 0.5, "decay": 0.6}}
    candidate = patch(client, job, candidate, segments=[
        {"id": "v", "start": 0, "end": 1.25, "media": item["id"], "framing": COVER, "audio_effects": [echo]},
        segment_of(job, "halo", "kabar", id="e"),
    ])
    clip = clip_of(client, settings, job, candidate)
    full = tone_level(settings, clip, TONE, 0.2)
    assert full > 100
    assert level_db(settings, clip, TONE, 1.1, full) > -10
    # Cut at its end: the Source's Segment after it has none of it.
    assert level_db(settings, clip, TONE, 1.3, full, secs=0.2) < -40


@pytest.mark.parametrize("joined", [False, True], ids=["cut", "transition"])
def test_a_media_segment_with_effects_between_plain_ones_keeps_its_place_at_a_cut_and_under_a_transition(client, settings, beeps, joined):
    item = upload(client, beeps["toned"], "toned.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    # The video's tone an octave up, between two Segments of the Source's 440 Hz.
    pitched = {"id": "v", "start": 0, "end": 1.5, "media": item["id"], "framing": COVER, "audio_effects": [{"id": "pitch", "params": {"semitones": 12}}]}
    transitions = [{"after": "a", "kind": "fade", "secs": 0.5}] if joined else []
    candidate = patch(client, job, candidate, segments=[
        segment_of(job, "halo", "kabar", id="a"), pitched, segment_of(job, "kita", "soal", id="b"),
    ], transitions=transitions)
    a, v, b = preview(client, job, candidate)["plan"]["segments"]
    # Overlapping the one before by the Transition, if any; then cut to the one after.
    assert (v["start"], v["end"]) == (round(a["end"] - (0.5 if joined else 0), 3), b["start"])
    assert v["end"] - v["start"] == 1.5
    clip = clip_of(client, settings, job, candidate)
    full = tone_level(settings, clip, 440, 0.5)
    up = 2 * TONE
    assert level_db(settings, clip, up, v["start"] - 0.1, full) < -40
    if joined:
        # Halfway through the overlap, both are heard, the incoming one already effected.
        assert level_db(settings, clip, up, v["start"] + 0.225, full) > -12
        assert level_db(settings, clip, TONE, v["start"] + 0.225, full) < -30
    assert level_db(settings, clip, up, v["start"] + 0.6, full) > -6
    assert level_db(settings, clip, TONE, v["start"] + 0.6, full) < -30
    assert level_db(settings, clip, up, v["end"] - 0.1, full) > -6
    assert level_db(settings, clip, up, v["end"] + 0.05, full) < -40
    assert level_db(settings, clip, 440, v["end"] + 0.3, full) > -3


def test_the_catalogue_lists_each_effect_with_its_settings_one_of_them_the_intensity(client):
    listed = client.get("/api/audio-effects").json()
    by_id = {effect["id"]: effect for effect in listed}
    assert {"telephone", "echo", "pitch"} <= set(by_id)
    assert (by_id["echo"]["name"], by_id["echo"]["group"]) == ("Echo", "Space")
    assert by_id["echo"]["settings"] == [
        {"key": "delay", "label": "Delay", "min": 0.05, "max": 1, "default": 0.25, "step": 0.05, "unit": "s", "intensity": False},
        {"key": "decay", "label": "Decay", "min": 0.1, "max": 0.9, "default": 0.4, "step": 0.05, "unit": "", "intensity": True},
    ]
    assert by_id["pitch"]["settings"][0] | {"intensity": True} == by_id["pitch"]["settings"][0]
    assert all(sum(setting["intensity"] for setting in effect["settings"]) == 1 for effect in listed)


@pytest.mark.anyio
async def test_the_agent_lists_the_effects_sets_a_stack_sees_it_in_the_dry_run_and_is_refused_a_bad_one(mcp):
    listed = await call(mcp, "list_assets", kind="audio_effects")
    assert set(listed) == {"audio_effects"}
    assert {"telephone", "echo", "pitch"} <= {effect["id"] for effect in listed["audio_effects"]}

    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    head = {"id": "a", "start": HALO_KABAR[0], "end": HALO_KABAR[1]}
    tail = {"id": "b", "start": KITA_SOAL[0], "end": KITA_SOAL[1]}
    await call(mcp, "edit_candidate", **ids, changes={"segments": [head, tail | {"audio_effects": [{"id": "telephone"}]}]})
    # A merge replaces a Segment's stack as a whole, its other fields kept.
    merged = await call(mcp, "merge_candidate_items", **ids, segments=[
        {"id": "b", "audio_effects": [{"id": "echo", "params": {"delay": 0.5}}, {"id": "pitch", "params": {"semitones": -3}, "enabled": False}]},
    ])
    assert merged["segments"][1]["audio_effects"] == [
        {"id": "echo", "params": {"delay": 0.5, "decay": 0.4}, "enabled": True},
        {"id": "pitch", "params": {"semitones": -3}, "enabled": False},
    ]
    assert merged["segments"][1]["start"] == KITA_SOAL[0]

    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    first, second = plan["segments"]
    # The stack heard: an entry switched off is left out.
    assert "audio_effects" not in first
    assert second["audio_effects"] == [{"id": "echo", "params": {"delay": 0.5, "decay": 0.4}}]

    for segments, message in (
        ([{"id": "b", "audio_effects": [{"id": "flanger"}]}], "Segment b's audio_effects[0]: there is no audio effect 'flanger'"),
        ([{"id": "b", "audio_effects": [{"id": "echo", "params": {"feedback": 1}}]}], "Segment b's audio_effects[0] (echo) has no setting 'feedback'"),
        ([{"id": "b", "audio_effects": [{"id": "echo"}, {"id": "echo", "params": {"delay": 2}}]}], "Segment b's audio_effects[1] (echo) delay is 2; it is 0.05 to 1"),
    ):
        message_given = await fails(mcp, "merge_candidate_items", **ids, segments=segments)
        assert message in message_given, message_given
    still = {"id": "still", "start": HALO_KABAR[1], "end": HALO_KABAR[1], "hold": 1, "audio_effects": [{"id": "echo"}]}
    message = await fails(mcp, "edit_candidate", **ids, changes={"segments": [head, still, tail]})
    assert "Segment still is a Freeze frame (hold), which is silent: it has no audio effects" in message, message
    assert "audio_effects" in mcp.instructions and "list_assets kind \"audio_effects\"" in mcp.instructions
