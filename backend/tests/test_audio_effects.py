"""Audio Effects on Segments (.scratch/audio-effects/issues/01-segment-effects-in-the-render.md, ADR
0017), then on Music Clips and video Overlays (02-music-clip-and-overlay-effects.md): the catalogue
run by the real ffmpeg over a tone; Seam B on the planner; then Seam A through the API, MCP and the
real ffmpeg: what is heard, and what is refused."""

import subprocess
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from app.audio_effects import MEASURED_GAIN, NORMALIZE, AudioEffect, Unmeasured, checked_effects, effect_chain, effects
from app.candidates import MusicClip, Overlay
from app.config import load_settings
from app.planner import MediaInfo, SegmentInput, audio_events, overlay_sound, plan_render
from test_keyframes import stills  # noqa: F401
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
    if effect.id == NORMALIZE:
        # As the renderer gives it, measured (test_clean_switches.py): a loud gain, its peaks held.
        params[MEASURED_GAIN] = 20.0
    heard = samples(effect_chain([AudioEffect(effect.id, params)], RATE, 1.0))
    assert len(heard) == RATE, len(heard)
    assert np.isfinite(heard).all()


# The Clean switches and the 22 presets, by shelf.
CATALOGUE = {
    "Clean": ["denoise", "enhance-voice", "normalize"],
    "Voice": ["pitch", "sweet", "deep", "chipmunk", "robot", "megaphone", "whisper"],
    "Tone": ["bass", "treble", "bright", "telephone", "radio", "vinyl", "lofi", "distorted"],
    "Space": ["echo", "room", "hall", "plate", "cathedral", "stadium", "underwater"],
}


def test_the_catalogue_holds_every_preset_on_its_shelf_in_order_each_with_one_intensity():
    listed = effects()
    assert {group: [effect.id for effect in listed if effect.group == group] for group in CATALOGUE} == CATALOGUE
    assert [effect.id for effect in listed] == [id for ids in CATALOGUE.values() for id in ids]
    for effect in listed:
        assert sum(setting.intensity for setting in effect.settings) == 1, effect.id
        assert all(setting.min <= setting.default <= setting.max for setting in effect.settings), effect.id


def peak_frequency(heard: np.ndarray) -> float:
    """The loudest frequency of `heard`, in Hz."""
    spectrum = np.abs(np.fft.rfft(heard * np.hanning(len(heard))))
    return float(np.fft.rfftfreq(len(heard), 1 / RATE)[spectrum.argmax()])


def energy(heard: np.ndarray, low: float = 0, high: float = RATE / 2) -> float:
    """The energy of `heard` between `low` and `high` Hz."""
    spectrum = np.abs(np.fft.rfft(heard)) ** 2
    frequencies = np.fft.rfftfreq(len(heard), 1 / RATE)
    return float(spectrum[(frequencies >= low) & (frequencies < high)].sum())


def heard_through(effect_id: str, source: str = "sine=frequency=440:sample_rate=48000:duration=1", **params: float) -> np.ndarray:
    [applied] = checked_effects([AudioEffect(effect_id, params)], "Segment s")
    return samples(effect_chain([applied], RATE, 1.0), source)


def test_deep_lowers_a_tones_pitch_and_chipmunk_raises_it_at_the_same_length():
    assert peak_frequency(samples([])) == pytest.approx(440, abs=3)
    deep, chipmunk = heard_through("deep"), heard_through("chipmunk")
    assert len(deep) == len(chipmunk) == RATE
    # Three semitones down (370 Hz), seven up (659 Hz) at their defaults.
    assert peak_frequency(deep) == pytest.approx(440 * 2 ** (-3 / 12), abs=5)
    assert peak_frequency(chipmunk) == pytest.approx(440 * 2 ** (7 / 12), abs=5)


def test_underwater_takes_away_the_sound_above_1_khz():
    both = "aevalsrc=0.3*sin(2*PI*200*t)+0.3*sin(2*PI*2000*t):s=48000:d=1"
    dry, wet = samples([], both), heard_through("underwater", both)
    assert energy(dry, 1000) > 0.4 * energy(dry)
    assert energy(wet, 1000) < 0.01 * energy(wet)
    assert energy(wet, 0, 1000) > 0.3 * energy(dry, 0, 1000)


def test_hall_leaves_a_tail_after_the_sound_stops_inside_the_item():
    beep = "aevalsrc=0.5*sin(2*PI*440*t)*lt(t\\,0.4):s=48000:d=1"
    dry, wet = samples([], beep), heard_through("hall", beep)
    tail = slice(int(0.45 * RATE), int(0.7 * RATE))
    assert np.abs(dry[tail]).max() < 1e-3
    assert np.abs(wet[tail]).max() > 0.05
    assert len(wet) == RATE


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


def test_normalize_is_refused_its_measured_gain_and_is_not_built_before_it_is_measured():
    with pytest.raises(ValueError, match="has no setting 'gain': its settings are target"):
        checked_effects([AudioEffect(NORMALIZE, {MEASURED_GAIN: 6})], "Music Clip m")
    with pytest.raises(Unmeasured):
        effect_chain(checked_effects([AudioEffect(NORMALIZE)], "Music Clip m"), RATE, 1.0)


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
    assert set(by_id) == {id for ids in CATALOGUE.values() for id in ids}
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
    assert [effect["id"] for effect in listed["audio_effects"]] == [id for ids in CATALOGUE.values() for id in ids]

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


# Music Clips and video Overlays (02)

SONG, VIDEO = "ef" * 16, "ab" * 16
ITEMS = {SONG: MediaInfo(0, 0, 10.0, True), VIDEO: MediaInfo(640, 360, 10.0, True)}


def test_a_music_clips_and_an_overlays_stack_is_checked_as_a_segments_and_one_stored_without_has_none():
    [echo] = MusicClip("m", 0.0, 2.0, media=SONG, audio_effects=[AudioEffect("echo")]).audio_effects
    assert echo == AudioEffect("echo", {"delay": 0.25, "decay": 0.4})
    assert MusicClip("m", 0.0, 2.0, media=SONG).audio_effects == []
    assert Overlay("o", VIDEO, 0.0, 2.0).audio_effects == []
    with pytest.raises(ValueError, match="Music Clip m's audio_effects\\[0\\]: there is no audio effect 'flanger'"):
        MusicClip("m", 0.0, 2.0, media=SONG, audio_effects=[AudioEffect("flanger")])
    with pytest.raises(ValueError, match="Overlay o's audio_effects\\[0\\] \\(pitch\\) semitones is 20"):
        Overlay("o", VIDEO, 0.0, 2.0, audio_effects=[AudioEffect("pitch", {"semitones": 20})])


def test_a_music_clips_and_a_video_overlays_enabled_effects_reach_their_sound_in_order():
    echo, telephone = AudioEffect("echo", {"delay": 0.25, "decay": 0.4}), AudioEffect("telephone", {"drive": 3})
    stack = [telephone, replace(echo, enabled=False), echo]
    effected, plain = audio_events([MusicClip("m", 0.0, 2.0, media=SONG, audio_effects=stack), MusicClip("n", 0.0, 2.0, media=SONG)], 10, ITEMS)
    assert effected.audio_effects == [telephone, echo]
    assert plain.audio_effects == []
    [sound] = overlay_sound([Overlay("o", VIDEO, 0.0, 2.0, volume=1.0, audio_effects=stack)], 10, ITEMS)
    assert sound.audio_effects == [telephone, echo]


@pytest.fixture(scope="session")
def low_and_high_media(tmp_path_factory) -> dict[str, bytes]:
    """A 3 s song and a 3 s video, each sounding 150 Hz and 1000 Hz together."""
    lavfi = ("-f", "lavfi", "-i")
    folder = tmp_path_factory.mktemp("low-and-high-media")
    both = "aevalsrc=0.3*sin(2*PI*150*t)+0.3*sin(2*PI*1000*t):s=44100:d=3"
    return {
        "song": make(folder / "song.wav", *lavfi, both),
        "video": make(folder / "video.mp4", *lavfi, "color=c=green:size=640x360:rate=25:duration=3", *lavfi, both, "-c:v", "libx264", "-c:a", "aac", "-shortest"),
    }


@pytest.mark.parametrize("kind", ["music", "overlays"])
def test_telephone_on_a_song_and_on_an_overlay_videos_sound_takes_most_of_its_sound_under_300_hz_away(client, settings, low_and_high_media, kind):
    item = upload(client, low_and_high_media["song" if kind == "music" else "video"], "song.wav" if kind == "music" else "video.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    # The same 1 s twice: as it is, then through Telephone.
    if kind == "music":
        first = {"id": "a", "media": item["id"], "start": 0.0, "secs": 1.0, "duck": None}
    else:
        first = {"id": "a", "media": item["id"], "start": 0.0, "secs": 1.0, "volume": 1.0, "transform": {"scale": 0.3}}
    second = first | {"id": "b", "start": 1.0, "audio_effects": [{"id": "telephone"}]}
    candidate = patch(client, job, candidate, **{kind: [first, second]})
    assert candidate[kind][1]["audio_effects"] == [{"id": "telephone", "params": {"drive": 3}, "enabled": True}]
    clip = clip_of(client, settings, job, candidate)
    low, high = tone_level(settings, clip, 150, 0.5, 0.2), tone_level(settings, clip, 1000, 0.5, 0.2)
    assert low > 100 and high > 100
    assert tone_level(settings, clip, 150, 1.5, 0.2) < 0.3 * low
    assert tone_level(settings, clip, 1000, 1.5, 0.2) > 0.5 * high


def test_a_stack_on_an_image_overlay_is_refused(client, stills):  # noqa: F811
    image = upload(client, stills["blue"], "blue.png").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "soal")
    overlay = {"id": "i", "media": image["id"], "start": 0, "secs": 1, "audio_effects": [{"id": "echo"}]}
    response = client.patch(candidate_url(job, candidate), json={"overlays": [overlay]})
    assert response.status_code == 422 and "Overlay i is an image, which has no sound: it has no audio effects" in response.text, response.text
    # Switched off, it is still refused; an empty one is not.
    response = client.patch(candidate_url(job, candidate), json={"overlays": [overlay | {"audio_effects": [{"id": "echo", "enabled": False}]}]})
    assert response.status_code == 422
    assert patch(client, job, candidate, overlays=[overlay | {"audio_effects": []}])["overlays"][0]["audio_effects"] == []


@pytest.mark.anyio
async def test_the_agent_sets_a_music_clips_and_an_overlays_stack_sees_them_in_the_dry_run_and_is_refused_one_on_an_image(mcp, tmp_path, stills):  # noqa: F811
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    song, video, image = tmp_path / "song.wav", tmp_path / "video.mp4", tmp_path / "blue.png"
    make(song, "-f", "lavfi", "-i", "sine=frequency=880:duration=3")
    make(
        video, "-f", "lavfi", "-i", "color=c=green:size=320x180:rate=25:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=880:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest",
    )
    image.write_bytes(stills["blue"])
    song_id, video_id, image_id = [(await call(mcp, "add_asset", kind="media", path=str(path)))["id"] for path in (song, video, image)]
    await call(mcp, "merge_candidate_items", **ids,
               music=[{"id": "m", "media": song_id, "start": 0, "secs": 1, "audio_effects": [{"id": "telephone"}]}],
               overlays=[{"id": "o", "media": video_id, "start": 0, "secs": 1, "volume": 1}])
    # A merge replaces an item's stack as a whole.
    merged = await call(mcp, "merge_candidate_items", **ids,
                        music=[{"id": "m", "audio_effects": [{"id": "echo", "params": {"delay": 0.5}}]}],
                        overlays=[{"id": "o", "audio_effects": [{"id": "pitch", "params": {"semitones": 3}}, {"id": "telephone", "enabled": False}]}])
    assert merged["music"][0]["audio_effects"] == [{"id": "echo", "params": {"delay": 0.5, "decay": 0.4}, "enabled": True}]
    assert merged["music"][0]["start"] == 0
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    sounds = {sound["id"]: sound for sound in plan["sounds"]}
    assert sounds["m"]["audio_effects"] == [{"id": "echo", "params": {"delay": 0.5, "decay": 0.4}}]
    assert sounds["o"]["audio_effects"] == [{"id": "pitch", "params": {"semitones": 3}}]

    message = await fails(mcp, "merge_candidate_items", **ids, overlays=[{"id": "i", "media": image_id, "start": 0, "secs": 1, "audio_effects": [{"id": "echo"}]}])
    assert "Overlay i is an image, which has no sound: it has no audio effects" in message, message
    message = await fails(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "audio_effects": [{"id": "flanger"}]}])
    assert "Music Clip m's audio_effects[0]: there is no audio effect 'flanger'" in message, message
