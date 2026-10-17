"""Download the models and fonts the pipeline needs. Files already present are skipped."""

import shutil
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

from huggingface_hub import snapshot_download

from app.config import BLAZE_FACE_MODEL, FONTS_DIR, MONTSERRAT_EXTRABOLD, SILERO_VAD_MODEL, load_settings

MONTSERRAT_REPO = "https://raw.githubusercontent.com/JulietaUla/Montserrat/v9.000"
# Montserrat's other Faces (app/fonts.py), from its own repository as ExtraBold is.
MONTSERRAT_FILES = [
    "Montserrat-Regular",
    "Montserrat-Italic",
    "Montserrat-SemiBold",
    "Montserrat-Bold",
    "Montserrat-BoldItalic",
    "Montserrat-ExtraBoldItalic",
    "Montserrat-Black",
    "Montserrat-BlackItalic",
]
# The other bundled Faces (app/fonts.py), from Google Fonts' repository at a fixed commit.
GOOGLE_FONTS = "https://raw.githubusercontent.com/google/fonts/66928797f271fed5ee428544e7229685e2d90127"
# Each family's licence's directory, its own directory and the file stems of its Faces.
GOOGLE_FONT_FILES = [
    ("ofl", "anton", ["Anton-Regular"]),
    ("ofl", "bebasneue", ["BebasNeue-Regular"]),
    (
        "ofl",
        "poppins",
        [
            "Poppins-Regular",
            "Poppins-Italic",
            "Poppins-Medium",
            "Poppins-SemiBold",
            "Poppins-Bold",
            "Poppins-BoldItalic",
            "Poppins-ExtraBold",
            "Poppins-Black",
            "Poppins-BlackItalic",
        ],
    ),
    ("ofl", "archivoblack", ["ArchivoBlack-Regular"]),
    ("ofl", "bangers", ["Bangers-Regular"]),
    (
        "ofl",
        "barlowcondensed",
        [
            "BarlowCondensed-Regular",
            "BarlowCondensed-SemiBold",
            "BarlowCondensed-Bold",
            "BarlowCondensed-BoldItalic",
            "BarlowCondensed-ExtraBold",
            "BarlowCondensed-Black",
            "BarlowCondensed-BlackItalic",
        ],
    ),
    ("ofl", "kanit", ["Kanit-Regular", "Kanit-Medium", "Kanit-Bold", "Kanit-ExtraBold", "Kanit-Black", "Kanit-BlackItalic"]),
    ("ofl", "passionone", ["PassionOne-Regular", "PassionOne-Bold", "PassionOne-Black"]),
    ("ofl", "dmserifdisplay", ["DMSerifDisplay-Regular", "DMSerifDisplay-Italic"]),
    ("ofl", "abrilfatface", ["AbrilFatface-Regular"]),
    ("ofl", "lobster", ["Lobster-Regular"]),
    ("ofl", "pacifico", ["Pacifico-Regular"]),
    ("ofl", "titanone", ["TitanOne-Regular"]),
    ("ofl", "caveatbrush", ["CaveatBrush-Regular"]),
    ("ofl", "staatliches", ["Staatliches-Regular"]),
    ("apache", "permanentmarker", ["PermanentMarker-Regular"]),
    ("apache", "luckiestguy", ["LuckiestGuy-Regular"]),
]
# Families Google Fonts has only as a variable font: its licence's directory, its own directory, its
# file and the named instances bundled. libass sets only a variable font's default, so each instance
# is written out here as a static Face, as an imported variable font is split (app/fonts.py).
GOOGLE_VARIABLE_FONTS = [
    ("ofl", "oswald", "Oswald[wght].ttf", ["Regular", "Medium", "SemiBold", "Bold"]),
]
# Each licence directory's licence file, and the prefix it is saved under with its family's name.
LICENCES = {"ofl": ("OFL.txt", "OFL"), "apache": ("LICENSE.txt", "LICENSE")}

ASSETS = {
    BLAZE_FACE_MODEL: "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_full_range/float16/1/blaze_face_full_range.tflite",
    SILERO_VAD_MODEL: "https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx",
    MONTSERRAT_EXTRABOLD: f"{MONTSERRAT_REPO}/fonts/ttf/Montserrat-ExtraBold.ttf",
    **{FONTS_DIR / f"{font}.ttf": f"{MONTSERRAT_REPO}/fonts/ttf/{font}.ttf" for font in MONTSERRAT_FILES},
    FONTS_DIR / "OFL.txt": f"{MONTSERRAT_REPO}/OFL.txt",
    **{
        FONTS_DIR / f"{font}.ttf": f"{GOOGLE_FONTS}/{licence}/{family}/{font}.ttf"
        for licence, family, fonts in GOOGLE_FONT_FILES
        for font in fonts
    },
    **{
        FONTS_DIR / f"{LICENCES[licence][1]}-{family}.txt": f"{GOOGLE_FONTS}/{licence}/{family}/{LICENCES[licence][0]}"
        for licence, family, *_ in [*GOOGLE_FONT_FILES, *GOOGLE_VARIABLE_FONTS]
    },
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


def instantiate(url: str, styles: list[str]) -> None:
    """Download the variable font at `url` and write its named instances `styles` to FONTS_DIR as static
    fonts, Family-Style.ttf each."""
    from fontTools.ttLib import TTFont

    from app.fonts import statics

    stem = Path(url).name.split("[")[0]
    dests = {style: FONTS_DIR / f"{stem}-{style}.ttf" for style in styles}
    if all(dest.is_file() and dest.stat().st_size > 0 for dest in dests.values()):
        for dest in dests.values():
            print(f"present     {dest.name}")
        return
    print(f"downloading {Path(url).name}")
    with urllib.request.urlopen(url, timeout=60) as response:
        data = response.read()
    # Each instance's style is its typographic subfamily (name ID 17), as the split names it.
    instances = {TTFont(BytesIO(static))["name"].getDebugName(17): static for static in statics(data)}
    for style, dest in dests.items():
        if style not in instances:
            sys.exit(f"error: {Path(url).name} has no instance {style}")
        print(f"instancing  {dest.name}")
        partial = dest.with_name(dest.name + ".part")
        partial.write_bytes(instances[style])
        partial.replace(dest)


def main() -> None:
    for dest, url in ASSETS.items():
        download(url, dest)
    for licence, family, file, styles in GOOGLE_VARIABLE_FONTS:
        instantiate(f"{GOOGLE_FONTS}/{licence}/{family}/{file}", styles)
    whisper_model = load_settings().whisper_model
    print(f"caching     {whisper_model} (Hugging Face cache)")
    snapshot_download(whisper_model)


if __name__ == "__main__":
    main()
