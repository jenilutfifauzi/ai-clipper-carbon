"""Stand-ins for Noto Color Emoji's images (app/emoji.py), named as Noto names them, so that tests
run without `make setup`'s download and can tell each emoji by its colours. Each is a disc of four
coloured quarters on transparency (top-left, top-right, bottom-left, bottom-right); a flag is an
opaque 3:2 picture with no alpha, as region-flags' are."""

from pathlib import Path

import cv2
import numpy as np

# Each image's quarters, RGB.
QUARTERS = {
    # 🔥
    "emoji_u1f525.png": ((255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)),
    # 👨‍👩‍👧
    "emoji_u1f468_200d_1f469_200d_1f467.png": ((255, 0, 255), (0, 255, 255), (255, 128, 0), (128, 0, 255)),
    # 👨, which a sequence starting with it that has no image of its own falls back to
    "emoji_u1f468.png": ((0, 128, 0), (0, 0, 128), (128, 0, 0), (0, 128, 128)),
    # 👍🏽
    "emoji_u1f44d_1f3fd.png": ((200, 120, 60), (60, 200, 120), (120, 60, 200), (200, 200, 60)),
    # ❤ (❤️ is it, its variation selector left out of the name)
    "emoji_u2764.png": ((230, 0, 60), (230, 0, 60), (130, 0, 30), (130, 0, 30)),
    # #️⃣
    "emoji_u0023_20e3.png": ((90, 90, 255), (90, 255, 90), (255, 90, 90), (90, 90, 90)),
}
# 🇮🇩: red over white.
FLAG = "emoji_u1f1ee_1f1e9.png"
SIDE = 128


def disc(quarters: tuple[tuple[int, int, int], ...]) -> np.ndarray:
    """A SIDE-pixel RGBA disc of four coloured `quarters`."""
    pixels = np.zeros((SIDE, SIDE, 4), np.uint8)
    half = SIDE // 2
    for i, colour in enumerate(quarters):
        top, left = i // 2 * half, i % 2 * half
        pixels[top : top + half, left : left + half, :3] = colour
    rows, columns = np.mgrid[:SIDE, :SIDE]
    inside = (rows - half + 0.5) ** 2 + (columns - half + 0.5) ** 2 <= (half - 2) ** 2
    pixels[..., 3] = np.where(inside, 255, 0)
    pixels[~inside, :3] = 0
    return pixels


def write_emoji_images(folder: Path) -> Path:
    """The stand-ins, written into `folder`."""
    folder.mkdir(parents=True, exist_ok=True)
    for name, quarters in QUARTERS.items():
        cv2.imwrite(str(folder / name), cv2.cvtColor(disc(quarters), cv2.COLOR_RGBA2BGRA))
    flag = np.full((SIDE * 2 // 3, SIDE, 3), 255, np.uint8)
    flag[: SIDE // 3] = (0, 0, 255)
    cv2.imwrite(str(folder / FLAG), flag)
    return folder
