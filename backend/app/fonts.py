"""The fonts captions and the hook can be set in: bundled files (all under the SIL Open Font License,
downloaded by `make setup`), given to libass through `fontsdir` and to the browser's preview by
GET /api/fonts/{id}, so that both set the same glyphs. Each is a static font of one weight: libass
would set a variable font's default instance."""

from dataclasses import dataclass
from pathlib import Path

from app.config import FONTS_DIR


@dataclass(frozen=True)
class Font:
    id: str
    # What the UI calls it.
    label: str
    # The family name libass matches a style's Fontname against: the file's own (its `name` table).
    family: str
    file: Path


FONTS = {
    font.id: font
    for font in [
        Font("montserrat-extrabold", "Montserrat ExtraBold", "Montserrat ExtraBold", FONTS_DIR / "Montserrat-ExtraBold.ttf"),
        Font("anton", "Anton", "Anton", FONTS_DIR / "Anton-Regular.ttf"),
        Font("bebas-neue", "Bebas Neue", "Bebas Neue", FONTS_DIR / "BebasNeue-Regular.ttf"),
        Font("poppins-black", "Poppins Black", "Poppins Black", FONTS_DIR / "Poppins-Black.ttf"),
        Font("archivo-black", "Archivo Black", "Archivo Black", FONTS_DIR / "ArchivoBlack-Regular.ttf"),
        Font("bangers", "Bangers", "Bangers", FONTS_DIR / "Bangers-Regular.ttf"),
    ]
}
DEFAULT_FONT = "montserrat-extrabold"


def font(font_id: str) -> Font:
    """The registered font `font_id`; KeyError for one that isn't."""
    return FONTS[font_id]
