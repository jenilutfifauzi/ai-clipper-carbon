"""Video Effects (GLOSSARY.md, Video Effect; docs/adr/0014): the video kind of the effects registry
(docs/adr/0017), the catalogue of treatments a picture's stack names, and the ffmpeg chain a stack is
drawn through.

It shares the Audio Effects' Setting (app/audio_effects.py). Each effect has a stable id, a name, a
category (the library's shelf: Blur, Distort, Light, Stylize, Cutout) and an order among them, a
description, its settings (one is the intensity the stack's row shows) and a pure function from its
settings and the picture's size to ffmpeg video filters. A built-in effect never changes how it
looks, so that an app update can't change a saved Candidate's picture: a revised one gets a new id.
Concat (docs/referensi/concat) is the reference for what each does and its settings' ranges, never
for its code.

A picture's stack is a list of applied effects (`VideoEffect`): a catalogue id, its settings and an
on/off switch, each id at most once. `checked_video_effects` refuses an unknown id, an unknown setting,
a value out of range or an id already in the stack, and fills a setting left out with its default.

Sizes (a setting in "px") are output pixels at the picture's fitted size, scale 1, as in Concat,
where effects come before the transform: `scaled_effects` multiplies them by the picture's scale,
as the planner does, so that the plan carries what is drawn. `video_effect_chain` is the stack's
enabled entries in order, built at the picture's drawn size.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from enum import StrEnum

from app.audio_effects import Setting

# The most entries one picture's stack holds (each effect at most once, so the catalogue's size bounds it too).
VIDEO_EFFECTS_MAX = 20
# What the catalogue lists each effect as, beside the Audio Effects.
KIND = "video"
# The unit of a size setting, which `scaled_effects` scales with the picture.
PIXELS = "px"


class Category(StrEnum):
    """The library's shelves, in the order it shows them."""

    BLUR = "Blur"
    DISTORT = "Distort"
    LIGHT = "Light"
    STYLIZE = "Stylize"
    CUTOUT = "Cutout"


# An effect's filters from its settings (each one given, sizes at the drawn size) and the picture's
# drawn size (width, height).
Build = Callable[[dict[str, float], tuple[int, int]], list[str]]


@dataclass(frozen=True)
class Effect:
    """An entry of the catalogue: what the library lists, and the filters it is drawn through."""

    id: str
    name: str
    category: Category
    order: int
    description: str
    settings: tuple[Setting, ...]
    build: Build = field(repr=False, compare=False)

    def setting(self, key: str) -> Setting | None:
        return next((setting for setting in self.settings if setting.key == key), None)


@dataclass(frozen=True)
class VideoEffect:
    """A Video Effect applied to a picture: the catalogue's effect `id`, its settings by key (once
    checked, every one of them), and whether it is drawn (`enabled`), kept in the stack when off."""

    id: str
    params: dict[str, float] = field(default_factory=dict)
    enabled: bool = True


class EffectNotFound(LookupError):
    pass


# Builders. Each keeps its input's size, length and frame rate.


# Blur


def _gaussian_blur(params: dict[str, float], size: tuple[int, int]) -> list[str]:
    """A Gaussian of sigma `radius` drawn pixels, as Concat's is (the picture's edges extended)."""
    return [f"gblur=sigma={params['radius']:.3f}"]


_EFFECTS = (
    Effect(
        "gaussian-blur", "Gaussian blur", Category.BLUR, 10, "A soft, even blur.",
        (Setting("radius", "Radius", 1, 50, 10, 1, PIXELS, intensity=True),), _gaussian_blur,
    ),
)
_BY_ID = {effect.id: effect for effect in _EFFECTS}


def effects() -> list[Effect]:
    """The catalogue, by category (`Category`'s order) and then by order."""
    shelves = list(Category)
    return sorted(_EFFECTS, key=lambda effect: (shelves.index(effect.category), effect.order))


def get_effect(effect_id: str) -> Effect:
    try:
        return _BY_ID[effect_id]
    except KeyError:
        raise EffectNotFound(effect_id) from None


def catalogue() -> list[dict]:
    """The catalogue as plain data, as the editor and the agent read it: each effect's id, kind
    ("video"), name, category, order, description and settings."""
    return [
        {
            "id": effect.id, "kind": KIND, "name": effect.name, "category": effect.category.value, "order": effect.order,
            "description": effect.description, "settings": [vars(setting) for setting in effect.settings],
        }
        for effect in effects()
    ]


def checked_video_effects(stack: list[VideoEffect], item: str) -> list[VideoEffect]:
    """`stack`, each entry with every setting of its effect (a setting left out at its default).
    ValueError naming `item`, the entry's index and why, for an unknown effect, an unknown setting, a
    value out of its range, or an effect already in the stack."""
    if len(stack) > VIDEO_EFFECTS_MAX:
        raise ValueError(f"{item} has {len(stack)} video effects; at most {VIDEO_EFFECTS_MAX}")
    checked: list[VideoEffect] = []
    for i, applied in enumerate(stack):
        where = f"{item}'s video_effects[{i}]"
        try:
            effect = get_effect(applied.id)
        except EffectNotFound:
            raise ValueError(f"{where}: there is no video effect {applied.id!r} (list_assets kind video_effects)") from None
        before = next((at for at, other in enumerate(checked) if other.id == effect.id), None)
        if before is not None:
            raise ValueError(f"{where} ({effect.id}) is already in its stack, at {before}: an effect appears once")
        for key, value in applied.params.items():
            setting = effect.setting(key)
            if setting is None:
                keys = ", ".join(setting.key for setting in effect.settings)
                raise ValueError(f"{where} ({effect.id}) has no setting {key!r}: its settings are {keys}")
            if not (math.isfinite(value) and setting.min <= value <= setting.max):
                raise ValueError(f"{where} ({effect.id}) {key} is {value:g}; it is {setting.min:g} to {setting.max:g}")
        params = {setting.key: float(applied.params.get(setting.key, setting.default)) for setting in effect.settings}
        checked.append(VideoEffect(effect.id, params, applied.enabled))
    return checked


def enabled_video_effects(stack: list[VideoEffect]) -> list[VideoEffect]:
    """The entries of `stack` that are drawn."""
    return [applied for applied in stack if applied.enabled]


def scaled_effects(stack: list[VideoEffect], scale: float) -> list[VideoEffect]:
    """`stack` (checked) with its size settings (in px, at the fitted size) times `scale`, the
    picture's, to the thousandth: what is drawn at its drawn size. An effect no longer in the
    catalogue is kept as it is."""
    scaled = []
    for applied in stack:
        effect = _BY_ID.get(applied.id)
        sizes = {setting.key for setting in effect.settings if setting.unit == PIXELS} if effect else set()
        params = {key: round(value * scale, 3) if key in sizes else value for key, value in applied.params.items()}
        scaled.append(replace(applied, params=params))
    return scaled


def video_effect_chain(stack: list[VideoEffect], size: tuple[int, int]) -> list[str]:
    """The filters `stack` (checked, its sizes as drawn) is drawn through on a picture of `size`
    (width, height): its enabled entries in order. Nothing for a stack with nothing enabled."""
    return [part for applied in enabled_video_effects(stack) for part in get_effect(applied.id).build(applied.params, size)]
