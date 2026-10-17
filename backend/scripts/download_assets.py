"""Download the models, fonts and emoji images the pipeline needs. Files already present are skipped."""

import json
import shutil
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

from huggingface_hub import snapshot_download

from app.config import BLAZE_FACE_MODEL, EMOJI_DIR, FONTS_DIR, MONTSERRAT_EXTRABOLD, SILERO_VAD_MODEL, load_settings

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
# The Face Text Layers fall back to for Chinese and Japanese (app/fonts.py's FALLBACK_FONT), from Noto
# CJK's release Sans2.004.
NOTO_CJK = "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004"
# The emoji Text Layers draw (app/emoji.py): Noto Color Emoji's 512 px images, from its release
# v2026-09-24-unicode18_0. An emoji is drawn 1 em square into a picture made at the largest scale its
# layer reaches, so a big or scaled-up title draws it a few hundred pixels across, where the 128 px
# set would be blown up and soft. The 512 px set is about 95 MB in 3750 files.
NOTO_EMOJI = "https://raw.githubusercontent.com/googlefonts/noto-emoji/e20cbc2bbec1926686be9f9bee7d1d2cfa1fea0e"
NOTO_EMOJI_TREES = "https://api.github.com/repos/googlefonts/noto-emoji/git/trees"
# The listings, by their git tree hashes at that release, of its 2D/png/512 directory and of the flags
# it draws (third_party/region-flags/waved-svg, named as emoji). Noto's PNG sets have no flags: its
# font draws them from region-flags' PNGs (public domain), which are saved here under the flags' emoji
# names.
EMOJI_IMAGES_TREE = "feb07284edb89d4a2eca1f0c1d2ad926ebc7c43f"
EMOJI_FLAGS_TREE = "2fc9b9b95546fbe3bd6a2725cc9a338cf4e18e01"
REGIONAL_A = 0x1F1E6
BLACK_FLAG = 0x1F3F4
TAG_CANCEL = 0xE007F

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
    FONTS_DIR / "NotoSansSC-Bold.otf": f"{NOTO_CJK}/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf",
    FONTS_DIR / "OFL-notosanssc.txt": f"{NOTO_CJK}/LICENSE",
}


def emoji_images() -> dict[Path, str]:
    """Noto Color Emoji's images and the flags it draws, each by where it goes in EMOJI_DIR, and their
    licences."""
    images = {
        EMOJI_DIR / "LICENSE": f"{NOTO_EMOJI}/LICENSE",
        EMOJI_DIR / "LICENSE-region-flags": f"{NOTO_EMOJI}/third_party/region-flags/LICENSE",
    }
    for name in _listing(EMOJI_IMAGES_TREE):
        images[EMOJI_DIR / name] = f"{NOTO_EMOJI}/2D/png/512/{name}"
    for name in _listing(EMOJI_FLAGS_TREE):
        stem = name.removesuffix(".svg")
        images[EMOJI_DIR / f"{stem}.png"] = f"{NOTO_EMOJI}/third_party/region-flags/png/{_region(stem)}.png"
    return images


def _listing(tree: str) -> list[str]:
    with urllib.request.urlopen(f"{NOTO_EMOJI_TREES}/{tree}", timeout=60) as response:
        return [entry["path"] for entry in json.load(response)["tree"]]


def _region(stem: str) -> str:
    """The region code of a flag's emoji name: emoji_u1f1ee_1f1e9 (two regional indicators) is ID,
    emoji_u1f3f4_e0067_e0062_e0065_e006e_e0067_e007f (a black flag and tag letters) is GB-ENG."""
    codes = [int(code, 16) for code in stem.removeprefix("emoji_u").split("_")]
    if codes[0] != BLACK_FLAG:
        return "".join(chr(ord("A") + code - REGIONAL_A) for code in codes)
    letters = "".join(chr(code - 0xE0000) for code in codes[1:] if code != TAG_CANCEL).upper()
    return f"{letters[:2]}-{letters[2:]}"


def download_all(assets: dict[Path, str], what: str) -> None:
    """`assets` downloaded side by side, reported as a count of `what`."""
    missing = {dest: url for dest, url in assets.items() if not (dest.is_file() and dest.stat().st_size > 0)}
    if not missing:
        print(f"present     {len(assets)} {what}")
        return
    print(f"downloading {len(missing)} of {len(assets)} {what}")
    with ThreadPoolExecutor(16) as pool:
        list(pool.map(lambda item: _fetch_retrying(item[1], item[0]), missing.items()))


def _fetch_retrying(url: str, dest: Path, attempts: int = 4) -> None:
    """`_fetch`, tried again after a network error (one of thousands of requests may time out)."""
    for attempt in range(attempts):
        try:
            _fetch(url, dest)
            return
        except OSError:
            if attempt == attempts - 1:
                raise


def download(url: str, dest: Path) -> None:
    if dest.is_file() and dest.stat().st_size > 0:
        print(f"present     {dest.name}")
        return
    print(f"downloading {dest.name}")
    _fetch(url, dest)


def _fetch(url: str, dest: Path) -> None:
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
    download_all(emoji_images(), "emoji images")
    whisper_model = load_settings().whisper_model
    print(f"caching     {whisper_model} (Hugging Face cache)")
    snapshot_download(whisper_model)


if __name__ == "__main__":
    main()
