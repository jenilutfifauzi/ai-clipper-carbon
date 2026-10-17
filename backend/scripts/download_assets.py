"""Download the models and fonts the pipeline needs. Files already present are skipped."""

import shutil
import sys
import urllib.request
from pathlib import Path

from huggingface_hub import snapshot_download

from app.config import BLAZE_FACE_MODEL, FONTS_DIR, MONTSERRAT_EXTRABOLD, SILERO_VAD_MODEL, load_settings

MONTSERRAT_REPO = "https://raw.githubusercontent.com/JulietaUla/Montserrat/v9.000"
# The other caption fonts (app/fonts.py), from Google Fonts' repository at a fixed commit.
GOOGLE_FONTS = "https://raw.githubusercontent.com/google/fonts/66928797f271fed5ee428544e7229685e2d90127/ofl"
# (directory, file stem) of each.
GOOGLE_FONT_FILES = [
    ("anton", "Anton-Regular"),
    ("bebasneue", "BebasNeue-Regular"),
    ("poppins", "Poppins-Black"),
    ("archivoblack", "ArchivoBlack-Regular"),
    ("bangers", "Bangers-Regular"),
]
# The Face Text Layers fall back to for Chinese and Japanese (app/fonts.py's FALLBACK_FONT), from Noto
# CJK's release Sans2.004.
NOTO_CJK = "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004"

ASSETS = {
    BLAZE_FACE_MODEL: "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_full_range/float16/1/blaze_face_full_range.tflite",
    SILERO_VAD_MODEL: "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx",
    MONTSERRAT_EXTRABOLD: f"{MONTSERRAT_REPO}/fonts/ttf/Montserrat-ExtraBold.ttf",
    FONTS_DIR / "OFL.txt": f"{MONTSERRAT_REPO}/OFL.txt",
    **{
        FONTS_DIR / f"{font}.ttf": f"{GOOGLE_FONTS}/{family}/{font}.ttf" for family, font in GOOGLE_FONT_FILES
    },
    **{FONTS_DIR / f"OFL-{family}.txt": f"{GOOGLE_FONTS}/{family}/OFL.txt" for family, _ in GOOGLE_FONT_FILES},
    FONTS_DIR / "NotoSansSC-Bold.otf": f"{NOTO_CJK}/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf",
    FONTS_DIR / "OFL-notosanssc.txt": f"{NOTO_CJK}/LICENSE",
}


def download(url: str, dest: Path) -> None:
    if dest.is_file() and dest.stat().st_size > 0:
        print(f"present     {dest.name}")
        return
    print(f"downloading {dest.name}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as out:
        shutil.copyfileobj(response, out)
    if partial.stat().st_size == 0:
        partial.unlink()
        sys.exit(f"error: empty download from {url}")
    partial.replace(dest)


def main() -> None:
    for dest, url in ASSETS.items():
        download(url, dest)
    whisper_model = load_settings().whisper_model
    print(f"caching     {whisper_model} (Hugging Face cache)")
    snapshot_download(whisper_model)


if __name__ == "__main__":
    main()
