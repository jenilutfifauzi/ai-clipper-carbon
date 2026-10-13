"""Download the models and font the pipeline needs. Files already present are skipped."""

import shutil
import sys
import urllib.request
from pathlib import Path

from huggingface_hub import snapshot_download

from app.config import BLAZE_FACE_MODEL, FONTS_DIR, MONTSERRAT_EXTRABOLD, SILERO_VAD_MODEL, load_settings

MONTSERRAT_REPO = "https://raw.githubusercontent.com/JulietaUla/Montserrat/v9.000"

ASSETS = {
    BLAZE_FACE_MODEL: "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
    SILERO_VAD_MODEL: "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx",
    MONTSERRAT_EXTRABOLD: f"{MONTSERRAT_REPO}/fonts/ttf/Montserrat-ExtraBold.ttf",
    FONTS_DIR / "OFL.txt": f"{MONTSERRAT_REPO}/OFL.txt",
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
