"""Export Settings (.scratch/export-settings/issues/01-encoding-rules.md): Seam B on the encoding
rules, then Seam A on the real ffmpeg, rendering Render Plans with the Renderer."""

from dataclasses import replace
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from app.canvas import PORTRAIT
from app.config import RenderTuning
from app.encoding import (
    Bitrate,
    Codec,
    ExportSettings,
    Quality,
    RateMode,
    encoder_args,
    estimated_bytes,
    output_size,
    target_kbps,
)
from app.planner import plan_render
from app.renderer import Encoded, Renderer, available_codecs
from app.video_source import SourceMetadata
from test_media_library import make
from test_render import loudness, probe

# Seam B: the encoding rules


@pytest.mark.parametrize(
    "resolution, size", [(720, (720, 1280)), (1080, (1080, 1920)), (1440, (1440, 2560)), (2160, (2160, 3840))]
)
def test_the_output_is_9_16_with_the_resolution_as_its_short_side(resolution, size):
    assert output_size(ExportSettings(resolution=resolution), frame=PORTRAIT.size) == size


@pytest.mark.parametrize(
    "frame, resolution, size",
    [((1920, 1080), 1080, (1920, 1080)), ((1920, 1080), 720, (1280, 720)), ((1920, 1080), 2160, (3840, 2160)),
     ((1080, 1080), 1440, (1440, 1440)), ((1080, 1350), 720, (720, 900))],
)
def test_the_output_takes_its_canvass_shape_at_the_resolution(frame, resolution, size):
    assert output_size(ExportSettings(resolution=resolution), frame) == size


@pytest.mark.parametrize(
    "settings, fps, kbps",
    [
        # The tiers at 1080p and 30 fps.
        (ExportSettings(quality=Quality.HIGH), 30, 16_000),
        (ExportSettings(), 30, 8_000),
        (ExportSettings(quality=Quality.SMALLEST), 30, 4_000),
        # Scaled by the codec,
        (ExportSettings(codec=Codec.HEVC), 30, 4_800),
        (ExportSettings(codec=Codec.AV1), 30, 4_000),
        # by the pixels over 1080x1920's,
        (ExportSettings(resolution=720), 30, 3_556),
        (ExportSettings(resolution=2160, quality=Quality.HIGH), 30, 64_000),
        # and by the frame rate over 30; a slower one gets 30's.
        (ExportSettings(), 60, 16_000),
        (ExportSettings(), 25, 8_000),
        (ExportSettings(), 23.976, 8_000),
        (ExportSettings(codec=Codec.HEVC, resolution=1440, quality=Quality.HIGH), 59.94, 34_099),
    ],
)
def test_a_quality_tier_is_a_target_bitrate_scaled_by_size_frame_rate_and_codec(settings, fps, kbps):
    assert target_kbps(settings, fps, frame=PORTRAIT.size) == kbps


@pytest.mark.parametrize("mode", list(RateMode))
def test_a_bitrate_of_the_settings_own_replaces_the_tier(mode):
    own = Bitrate(mode, 2_500)
    for settings in (ExportSettings(), ExportSettings(Codec.AV1, 2160, quality=Quality.HIGH)):
        assert target_kbps(replace(settings, bitrate=own), 60, frame=PORTRAIT.size) == 2_500


def test_the_estimated_size_is_the_target_bitrate_and_the_sound_over_the_duration():
    # (8,000 + 192 kb/s) x 60 s / 8.
    assert estimated_bytes(ExportSettings(), 30, 60, frame=PORTRAIT.size) == 61_440_000
    assert estimated_bytes(ExportSettings(bitrate=Bitrate(RateMode.CBR, 1_808)), 60, 10, frame=PORTRAIT.size) == 2_500_000


@pytest.mark.parametrize(
    "codec, encoder, mode, fallback",
    [
        (Codec.H264, "h264_videotoolbox", RateMode.CBR, True),
        (Codec.HEVC, "hevc_videotoolbox", RateMode.CBR, True),
        (Codec.H264, "h264_videotoolbox", RateMode.VBR, False),
        (Codec.H264, "libx264", RateMode.CBR, False),
        (Codec.HEVC, "libx265", RateMode.CBR, False),
        # SVT-AV1 holds a constant bitrate only in low-delay streams.
        (Codec.AV1, "libsvtav1", RateMode.CBR, True),
    ],
)
def test_cbr_falls_back_to_vbr_on_an_encoder_that_cant_hold_it(codec, encoder, mode, fallback):
    settings = ExportSettings(codec, bitrate=Bitrate(mode, 6_000))
    assert encoder_args(settings, 30, encoder, frame=PORTRAIT.size).bitrate_fallback is fallback
    # A tier's bitrate is never held constant.
    assert encoder_args(replace(settings, bitrate=None), 30, encoder, frame=PORTRAIT.size).bitrate_fallback is False


SETTINGS = TypeAdapter(ExportSettings)


def test_settings_on_the_lists_are_read():
    read = SETTINGS.validate_python(
        {"codec": "hevc", "resolution": 1440, "fps": 59.94, "quality": "high", "bitrate": {"mode": "cbr", "kbps": 6000}, "loudness": None}
    )
    assert read == ExportSettings(Codec.HEVC, 1440, 59.94, Quality.HIGH, Bitrate(RateMode.CBR, 6000), None)
    assert SETTINGS.validate_python({}) == ExportSettings(Codec.H264, 1080, None, Quality.RECOMMENDED, None, -14)
    assert SETTINGS.validate_python({"fps": 24, "loudness": -16}) == ExportSettings(fps=24, loudness=-16)


@pytest.mark.parametrize(
    "field, value",
    [
        ("codec", "vp9"),
        ("resolution", 900),
        ("fps", 48),
        ("fps", 0),
        ("quality", "best"),
        ("bitrate", {"mode": "cbr", "kbps": 99}),
        ("bitrate", {"mode": "vbr", "kbps": 200_001}),
        ("bitrate", {"mode": "abr", "kbps": 6000}),
        ("loudness", -23),
    ],
)
def test_settings_off_the_lists_are_refused(field, value):
    with pytest.raises(ValidationError, match=field):
        SETTINGS.validate_python({field: value})


# Seam A: the real ffmpeg

# Long enough for the encoders' rate control to settle on its average: over 2 s they overshoot by a
# quarter.
BUSY_SECS = 6


@pytest.fixture(scope="session")
def busy_video(tmp_path_factory) -> Path:
    """6 s of a 1080x1920 test pattern at 30 fps under moving grain, which costs every bit an encoder
    is given, with a tone. Portrait, so the Clip is the Source's frames as they are."""
    path = tmp_path_factory.mktemp("busy") / "busy.mp4"
    make(
        path, "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30,noise=alls=12:allf=t",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", str(BUSY_SECS),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "10", "-pix_fmt", "yuv420p", "-c:a", "aac",
    )
    return path


def encode(
    settings, source: Path, tmp_path: Path, export: ExportSettings, tuning: RenderTuning = RenderTuning(), secs: float = 5
) -> tuple[Encoded, Path]:
    """Render `secs` of `source` (a 1080x1920 one at 30 fps) as `export` says; what made it, and the MP4."""
    plan = plan_render(0.5, 0.5 + secs, SourceMetadata(BUSY_SECS, 30.0, 1080, 1920, "h264"), canvas=PORTRAIT)
    video = tmp_path / "clip.mp4"
    return Renderer(settings.ffmpeg_bin, tuning).render(source, plan, video, tmp_path / "clip.jpg", export=export), video


def picture(settings, video: Path) -> dict:
    """The MP4's video stream, as ffprobe sees it."""
    [stream] = [s for s in probe(settings, video)["streams"] if s["codec_type"] == "video"]
    return stream


def test_an_hevc_clip_is_tagged_hvc1_so_that_quicktime_plays_it(settings, busy_video, tmp_path):
    encoded, video = encode(settings, busy_video, tmp_path, ExportSettings(Codec.HEVC), secs=1)
    assert encoded == Encoded("hevc_videotoolbox", False)
    stream = picture(settings, video)
    assert (stream["codec_name"], stream["codec_tag_string"], stream["width"], stream["height"]) == ("hevc", "hvc1", 1080, 1920)


def video_kbps(settings, video: Path) -> float:
    """The MP4's average video bitrate in kb/s."""
    return int(picture(settings, video)["bit_rate"]) / 1000


def test_the_default_settings_encode_h264_at_8_mbps_and_14_lufs_on_videotoolbox(settings, busy_video, tmp_path):
    encoded, video = encode(settings, busy_video, tmp_path, ExportSettings())
    assert encoded == Encoded("h264_videotoolbox", False)
    stream = picture(settings, video)
    assert (stream["codec_name"], stream["profile"], stream["width"], stream["height"]) == ("h264", "High", 1080, 1920)
    assert video_kbps(settings, video) == pytest.approx(8_000, rel=0.2)
    assert loudness(settings, video) == pytest.approx(-14, abs=1)


def test_a_tiers_bitrate_is_scaled_by_its_codec(settings, busy_video, tmp_path):
    _, video = encode(settings, busy_video, tmp_path, ExportSettings(Codec.HEVC, quality=Quality.SMALLEST))
    assert video_kbps(settings, video) == pytest.approx(2_400, rel=0.2)


def test_a_cbr_bitrate_is_held_by_libx264_and_falls_back_to_vbr_on_videotoolbox(settings, busy_video, tmp_path):
    cbr = ExportSettings(bitrate=Bitrate(RateMode.CBR, 3_000))
    encoded, video = encode(settings, busy_video, tmp_path, cbr, RenderTuning(encoders=("libx264",)))
    assert encoded == Encoded("libx264", False)
    assert video_kbps(settings, video) == pytest.approx(3_000, rel=0.1)

    encoded, video = encode(settings, busy_video, tmp_path, cbr)
    assert encoded == Encoded("h264_videotoolbox", True)
    assert video_kbps(settings, video) == pytest.approx(3_000, rel=0.2)


def test_a_failed_hardware_encode_falls_back_to_software_and_says_which_made_the_clip(settings, busy_video, tmp_path):
    failing = RenderTuning(encoders=("no_such_encoder", "libx264"), hevc_encoders=("no_such_encoder", "libx265"))
    encoded, video = encode(settings, busy_video, tmp_path, ExportSettings(), failing)
    assert encoded == Encoded("libx264", False)
    assert picture(settings, video)["codec_name"] == "h264"
    # libx264 aims under the cap, 1.5x the target.
    assert video_kbps(settings, video) <= 12_000 * 1.1

    encoded, video = encode(settings, busy_video, tmp_path, ExportSettings(Codec.HEVC), failing, secs=1)
    assert encoded == Encoded("libx265", False)
    stream = picture(settings, video)
    assert (stream["codec_name"], stream["codec_tag_string"]) == ("hevc", "hvc1")


def test_an_av1_clip_is_encoded_by_svt_av1(settings, busy_video, tmp_path):
    if Codec.AV1 not in available_codecs(settings.ffmpeg_bin, RenderTuning()):
        pytest.skip("This ffmpeg has no libsvtav1")
    encoded, video = encode(settings, busy_video, tmp_path, ExportSettings(Codec.AV1, quality=Quality.SMALLEST), secs=1)
    assert encoded == Encoded("libsvtav1", False)
    stream = picture(settings, video)
    assert (stream["codec_name"], stream["width"], stream["height"]) == ("av1", 1080, 1920)


def test_the_codecs_this_ffmpeg_lacks_the_encoders_of_are_unavailable(settings):
    assert available_codecs(settings.ffmpeg_bin, RenderTuning()) >= {Codec.H264, Codec.HEVC}
    without_av1 = RenderTuning(av1_encoders=("no_such_encoder",))
    assert Codec.AV1 not in available_codecs(settings.ffmpeg_bin, without_av1)
    # One of a codec's encoders is enough.
    assert Codec.H264 in available_codecs(settings.ffmpeg_bin, RenderTuning(encoders=("no_such_encoder", "libx264")))


@pytest.fixture(scope="session")
def quiet_video(tmp_path_factory) -> Path:
    """6 s of a plain 1080x1920 picture at 30 fps with a tone 30 dB quieter than the busy one's."""
    path = tmp_path_factory.mktemp("quiet") / "quiet.mp4"
    make(
        path, "-f", "lavfi", "-i", f"color=c=0x4a5560:size=1080x1920:rate=30:duration={BUSY_SECS}",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000,volume=-30dB", "-t", str(BUSY_SECS),
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
    )
    return path


def test_the_sound_is_normalized_to_the_loudness_target_or_left_as_it_is(settings, quiet_video, tmp_path):
    _, video = encode(settings, quiet_video, tmp_path, ExportSettings(loudness=-16))
    assert loudness(settings, video) == pytest.approx(-16, abs=1)

    _, video = encode(settings, quiet_video, tmp_path, ExportSettings(loudness=None))
    assert loudness(settings, video) == pytest.approx(loudness(settings, quiet_video), abs=1)
    assert loudness(settings, video) < -40
    assert next(s for s in probe(settings, video)["streams"] if s["codec_type"] == "audio")["sample_rate"] == "48000"
