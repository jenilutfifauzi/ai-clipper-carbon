"""Export Settings, and the encoding rules: how a Clip is encoded as a set of Export Settings says.

The rules are pure. From Export Settings and the frame rate the Clip is made at, they give the
output's size, the target video bitrate, each encoder's codec arguments and a file's estimated size
(docs/adr/0021-export-presets-and-a-plan-drawn-at-any-size.md).

A quality tier is a target bitrate: 16, 8 or 4 Mb/s at 1080p and 30 fps (the platforms recommend 8
there; YouTube asks for it), scaled by the output's pixels over 1080x1920's, by the frame rate over
30, and by how much less the codec needs for the same picture. A bitrate of the settings' own
replaces it.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated, Literal, NamedTuple

from pydantic import AfterValidator, Field

# Every Clip's sound: AAC at this bitrate, in kb/s.
AUDIO_KBPS = 192
# The software encoders' speed: x264's and x265's preset, and SVT-AV1's at the same place on its own scale.
SOFTWARE_PRESET = "fast"
SVT_PRESET = 8

# The frame is 9:16, with the resolution as its short side: 720x1280 to 2160x3840.
Resolution = Literal[720, 1080, 1440, 2160]
FRAME_RATES = (23.976, 24, 25, 29.97, 30, 50, 59.94, 60)
# The integrated loudness a Clip is normalized to, in LUFS: the social platforms' or the podcast apps'.
Loudness = Literal[-14, -16]


def _listed_rate(fps: float) -> float:
    if fps not in FRAME_RATES:
        raise ValueError(f"The frame rate must be one of {', '.join(map(str, FRAME_RATES))}, got {fps}")
    return fps


FrameRate = Annotated[float, AfterValidator(_listed_rate)]


class Codec(StrEnum):
    H264 = "h264"
    HEVC = "hevc"
    AV1 = "av1"


class Quality(StrEnum):
    HIGH = "high"
    RECOMMENDED = "recommended"
    SMALLEST = "smallest"


class RateMode(StrEnum):
    """How an encoder holds a bitrate: VBR lets it vary with the picture, CBR keeps it constant."""

    VBR = "vbr"
    CBR = "cbr"


@dataclass(frozen=True)
class Bitrate:
    """A bitrate of the Export Settings' own, which replaces their quality tier."""

    mode: RateMode
    kbps: Annotated[int, Field(ge=100, le=200_000)]


@dataclass(frozen=True)
class ExportSettings:
    """How a Clip is encoded. The defaults are the "Shorts / TikTok / Reels" Preset's, which encodes
    a 30 fps Source as every Clip was before Export Settings (at other rates, the target follows the
    frame rate: a 25 fps one gets 6.7 Mb/s where it got 8)."""

    codec: Codec = Codec.H264
    resolution: Resolution = 1080
    # None for the Source's.
    fps: FrameRate | None = None
    quality: Quality = Quality.RECOMMENDED
    bitrate: Bitrate | None = None
    # None for none: the mix is left as it is.
    loudness: Loudness | None = -14


# Each tier's constant quality on the software encoders (x264's and x265's CRF), under a cap of
# MAX_RATE_FACTOR x the target, so that a busy scene can't balloon the file. SVT-AV1's CRF reads a few
# steps coarser than x264's: SVT_CRF_OFFSET steps on gives the same picture.
TIER_CRF = {Quality.HIGH: 16, Quality.RECOMMENDED: 20, Quality.SMALLEST: 26}
MAX_RATE_FACTOR = 1.5
SVT_CRF_OFFSET = 8
# Each tier's target at 1080x1920 and 30 fps, in Mb/s.
TIER_MBPS = {Quality.HIGH: 16, Quality.RECOMMENDED: 8, Quality.SMALLEST: 4}
# The bitrate each codec needs for the picture H.264 gives at 1.
CODEC_FACTORS = {Codec.H264: 1.0, Codec.HEVC: 0.6, Codec.AV1: 0.5}


def output_size(settings: ExportSettings) -> tuple[int, int]:
    """The output's width and height in pixels."""
    return settings.resolution, settings.resolution * 16 // 9


def target_kbps(settings: ExportSettings, fps: float) -> int:
    """The video bitrate the encoders aim for at `fps`, in kb/s."""
    if settings.bitrate is not None:
        return settings.bitrate.kbps
    width, height = output_size(settings)
    mbps = TIER_MBPS[settings.quality] * width * height / (1080 * 1920) * fps / 30 * CODEC_FACTORS[settings.codec]
    return round(mbps * 1000)


def estimated_bytes(settings: ExportSettings, fps: float, secs: float) -> int:
    """The size of a Clip `secs` long at `fps`: what the encoders aim for, video and sound."""
    return round((target_kbps(settings, fps) + AUDIO_KBPS) * 1000 * secs / 8)


class EncoderArgs(NamedTuple):
    """An encoder's codec arguments for ffmpeg, and whether it does VBR where CBR was asked for."""

    args: list[str]
    bitrate_fallback: bool


def encoder_args(settings: ExportSettings, fps: float, encoder: str) -> EncoderArgs:
    """The arguments that make `encoder` encode the Clip as `settings` say at `fps`.

    VideoToolbox (and an encoder unknown here) encodes at the target as its average bitrate, and does
    VBR for CBR. libx264 and libx265 encode at the tier's CRF under the cap, or hold a CBR's bitrate
    exactly; SVT-AV1 the same, but does VBR for CBR, which it holds only in low-delay streams.
    """
    target = target_kbps(settings, fps)
    cbr = settings.bitrate is not None and settings.bitrate.mode is RateMode.CBR
    tag = {Codec.H264: ["-profile:v", "high"], Codec.HEVC: ["-tag:v", "hvc1"], Codec.AV1: []}[settings.codec]
    crf, cap = TIER_CRF[settings.quality], _spelled(round(target * MAX_RATE_FACTOR))
    if encoder in ("libx264", "libx265"):
        # x264 pads to the bitrate only with nal-hrd=cbr, and x265 only with strict-cbr; x265 tells its
        # every setting on stderr unless asked not to.
        held = "nal-hrd=cbr" if encoder == "libx264" else "strict-cbr=1:log-level=error"
        if cbr:
            rate = _spelled(target)
            limits = ["-b:v", rate, "-minrate", rate, "-maxrate", rate, "-bufsize", rate, f"-{encoder[3:]}-params", held]
        else:
            limits = ["-crf", str(crf), "-maxrate", cap, "-bufsize", cap]
            if encoder == "libx265":
                limits += ["-x265-params", "log-level=error"]
        return EncoderArgs(["-c:v", encoder, "-preset", SOFTWARE_PRESET, *limits, *tag], False)
    if encoder == "libsvtav1":
        limits = ["-b:v", _spelled(target)] if cbr else ["-crf", str(crf + SVT_CRF_OFFSET), "-maxrate", cap, "-bufsize", cap]
        return EncoderArgs(["-c:v", encoder, "-preset", str(SVT_PRESET), *limits, *tag], cbr)
    return EncoderArgs(["-c:v", encoder, "-b:v", _spelled(target), *tag], cbr)


def _spelled(kbps: int) -> str:
    """A bitrate as ffmpeg takes it: in Mb/s when it is whole ones, else kb/s."""
    return f"{kbps // 1000}M" if kbps % 1000 == 0 else f"{kbps}k"
