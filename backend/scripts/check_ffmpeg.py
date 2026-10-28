"""Check that the configured ffmpeg has the filters and encoder the renderer, its frame processes
(frames.py), the Retimed copies (retimed.py) and the Scene analysis need."""

import re
import subprocess
import sys
from pathlib import Path

from app.config import load_settings

FILTERS = (
    # Picture
    "ass", "scdet", "overlay", "colorchannelmixer", "crop", "scale", "pad", "rotate", "hflip", "vflip",
    "format", "setsar", "split", "select", "trim", "fps", "settb", "setpts", "tpad", "reverse", "xfade",
    "gblur", "eq", "geq", "blend", "color", "drawbox", "lut", "lutrgb", "alphaextract", "alphamerge",
    "sendcmd", "concat",
    # Sound
    "atempo", "asetrate", "aresample", "aformat", "asetpts", "asetnsamples", "atrim", "apad", "areverse",
    "afade", "adelay", "acrossfade", "amix", "volume", "anullsrc", "loudnorm",
)
# The Mac wants its hardware encoder; elsewhere libx264 is the one that is tried.
ENCODERS = ("h264_videotoolbox",) if sys.platform == "darwin" else ("libx264",)


def listed(ffmpeg: Path, option: str) -> set[str]:
    """Names from `ffmpeg -filters` / `-encoders`, whose rows look like ` T.. ass  V->V  ...`."""
    output = subprocess.run([ffmpeg, "-hide_banner", option], capture_output=True, text=True, check=True).stdout
    return set(re.findall(r"^ [A-Z.|]+ (\S+)", output, re.MULTILINE))


def main() -> int:
    settings = load_settings()
    ffmpeg = settings.ffmpeg_bin
    if not ffmpeg.is_file():
        print(f"FAIL  ffmpeg not found at {ffmpeg} (install ffmpeg with libass, or set FFMPEG_BIN)")
        return 1

    filters = listed(ffmpeg, "-filters")
    encoders = listed(ffmpeg, "-encoders")
    checks = [
        (f"ffprobe at {settings.ffprobe_bin}", settings.ffprobe_bin.is_file()),
        *((f"filter {name}", name in filters) for name in FILTERS),
        *((f"encoder {name}", name in encoders) for name in ENCODERS),
    ]
    print(f"ffmpeg: {ffmpeg}")
    for label, ok in checks:
        print(f"{'PASS' if ok else 'FAIL'}  {label}")
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
