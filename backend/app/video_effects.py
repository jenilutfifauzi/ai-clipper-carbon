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

Time (Film grain, Bloom pulse) is the picture's own, from its start on the Timeline, as a Keyframe's
`at` is: moving an item takes its pulse with it. A `Clock` says where that is on its frames' times.
"""

import math
import re
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
# What a stack works on: every plane at full resolution, so that a size in pixels is the same in
# every channel (on 4:2:0 a blur's colour would spread twice as far as its brightness), with an alpha,
# so that an Overlay's is kept. YUV rather than RGB keeps a frame's range as it was, which a
# Transition's xfade mixes it with another's in.
EFFECTS_FORMAT = "yuva444p"


class Category(StrEnum):
    """The library's shelves, in the order it shows them."""

    BLUR = "Blur"
    DISTORT = "Distort"
    LIGHT = "Light"
    STYLIZE = "Stylize"
    CUTOUT = "Cutout"


@dataclass(frozen=True)
class Clock:
    """Where a picture's own time (seconds from its start on the Timeline, docs/adr/0014) is on the
    timestamps of the frames its stack is drawn on: `start` is its start on them, and `rate` how many
    of its seconds pass in one of theirs (a video Overlay's frames are its video's, before its Speed)."""

    start: float = 0.0
    rate: float = 1.0

    def of(self, t: str = "t") -> str:
        """An ffmpeg expression of the picture's own time from `t`, the filter's name for a frame's time."""
        time = f"({t}-{self.start:.6g})" if self.start else t
        return time if self.rate == 1 else f"{time}*{self.rate:.6g}"


# An effect's filters from its settings (each one given, sizes at the drawn size), the picture's
# drawn size (width, height) and its Clock.
Build = Callable[[dict[str, float], tuple[int, int], Clock], list[str]]


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
    # Whether it changes with time (its picture differs from frame to frame of a still).
    timed: bool = False

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


def _gaussian_blur(params: dict[str, float], size: tuple[int, int], clock: Clock) -> list[str]:
    """A Gaussian of sigma `radius` drawn pixels, as Concat's is (the picture's edges extended)."""
    return [f"gblur=sigma={params['radius']:.3f}"]


def _motion_blur(params: dict[str, float], size: tuple[int, int], clock: Clock) -> list[str]:
    """A blur along one line only, of about a Gaussian's sigma `length` drawn pixels, as Concat's
    streak is. The line is turned `angle` degrees from the horizontal, upwards on the right for a
    positive one (dblur turns the other way)."""
    return [f"dblur=angle={-params['angle'] % 360:g}:radius={params['length']:.3f}"]


# Distort


def _pixelate(params: dict[str, float], size: tuple[int, int], clock: Clock) -> list[str]:
    """Blocks `size` drawn pixels square, each the mean of its pixels, counted from the top left."""
    block = min(max(round(params["size"]), 1), 1024)
    return [f"pixelize=w={block}:h={block}:mode=avg"]


def _chromatic_aberration(params: dict[str, float], size: tuple[int, int], clock: Clock) -> list[str]:
    """Red scaled up and blue scaled down about the centre, each by `shift` drawn pixels at the
    picture's side edges, as Concat's are; green and the alpha kept. Planes taken apart and merged
    (a per-pixel expression is several times slower); blue's border, uncovered, takes its edge's
    pixels, as a sample past the edge does. One part: its labels run it on every frame."""
    width, height = size
    k = params["shift"] / (0.5 * width)
    red = (round(width * (1 + k)), round(height * (1 + k)))
    blue = (max(1, round(width * max(1 - k, 0.01))), max(1, round(height * max(1 - k, 0.01))))
    left, top = (width - blue[0]) // 2, (height - blue[1]) // 2
    right, bottom = width - blue[0] - left, height - blue[1] - top
    # The planes must agree on their pixels' shape; scaling one changes it by its rounding.
    return [
        f"format=gbrap,setsar=1,split=3[all][r][b];"
        f"[r]extractplanes=r,scale={red[0]}:{red[1]},setsar=1,crop={width}:{height}[red];"
        f"[b]extractplanes=b,scale={blue[0]}:{blue[1]},setsar=1,pad={width}:{height}:{left}:{top},"
        f"fillborders=left={left}:right={right}:top={top}:bottom={bottom}:mode=smear[blue];"
        f"[all]extractplanes=g+a[green][alpha];"
        f"[green][blue][red][alpha]mergeplanes=mapping=0x00102030:format=gbrap,format={EFFECTS_FORMAT}"
    ]


def _fisheye(params: dict[str, float], size: tuple[int, int], clock: Clock) -> list[str]:
    """The middle swollen and the corners kept, as Concat's, whose point at `r` (its distance from the
    centre over the corner's) shows the picture's point `(1 - s) + s r²` times as far out. Here twice
    over with `s` up to 0.3 at 100 % (each a lens correction, then the part whose samples stay on the
    picture zoomed back to its size: lenscorrection's k1 stops at 1), which swells the middle about as
    much as Concat's `s` up to 0.6 does. One part: crop and scale have no timeline."""
    width, height = size
    s = params["strength"] / 100 * 0.3
    kept = (max(1, round(width * (1 - s))), max(1, round(height * (1 - s))))
    # The kept part's corner samples the picture's: k1 = (1 - f) / f³ for the share f kept, the larger
    # one's, so that its rounding never reaches past the picture.
    f = max(kept[0] / width, kept[1] / height)
    stage = f"lenscorrection=k1={(1 - f) / f**3:.6f}:i=bilinear,crop={kept[0]}:{kept[1]},scale={width}:{height},setsar=1"
    return [f"{stage},{stage}"]


# Light

# The spread of Glow's and Bloom pulse's light, a Gaussian's sigma in output pixels at the fitted
# size (Concat's are 16 and 12 of its picture's pixels).
GLOW_SIGMA = 16.0
BLOOM_SIGMA = 12.0
# The frame a fitted picture fits, whose size a picture's light spreads with.
_FRAME = (1080, 1920)


def _screened(size: tuple[int, int], sigma: float, light: str, over: str) -> list[str]:
    """The picture with its own light, `light` (filters of a planar RGB copy of it, a quarter its size
    each way), blurred by a Gaussian of `sigma` drawn pixels at that quarter size, scaled back and
    screened over it, as two projectors add light: the blend's `over` options for red, green and blue
    (its strength), its alpha kept. A picture's own sigma grows with its size, as its fitted size's
    scale (the larger of its width and height over the frame's). One part: its labels run it on every
    frame."""
    width, height = size
    spread = sigma * max(width / _FRAME[0], height / _FRAME[1]) / 4
    quarter = f"{max(1, round(width / 4))}:{max(1, round(height / 4))}"
    return [
        f"format=gbrap,setsar=1,split[base][light];"
        f"[light]scale={quarter},{light}{',' if light else ''}gblur=sigma={spread:.3f},scale={width}:{height},setsar=1[glow];"
        f"[base][glow]blend=c0_mode=screen:c1_mode=screen:c2_mode=screen:{over}c3_mode=normal,format={EFFECTS_FORMAT}"
    ]


def _glow(params: dict[str, float], size: tuple[int, int], clock: Clock) -> list[str]:
    """The picture's light spread wide and screened back over it by `amount`, as Concat's."""
    amount = params["amount"] / 100
    over = "".join(f"c{plane}_opacity={amount:.4f}:" for plane in range(3))
    return _screened(size, GLOW_SIGMA, "", over)


def _bloom_pulse(params: dict[str, float], size: tuple[int, int], clock: Clock) -> list[str]:
    """The highlights' light (each pixel weighted by how far its luma is past 0.55, smoothed and taken
    to the 2.4th power, as Concat's) spread and screened back over the picture, at a strength
    `amount` × (0.6 + 0.4 sin(time × `speed`)) of its own time: it breathes, a full breath every
    2π / `speed` seconds from its start."""
    luma = "(0.2126*r(X,Y)+0.7152*g(X,Y)+0.0722*b(X,Y))/255"
    knee = f"clip(({luma}-0.55)/0.45,0,1)"
    strength = f"{params['amount'] / 100:.4f}*(0.6+0.4*sin({clock.of('T')}*{params['speed']:g}))"
    weight = f"max({strength},0)*pow({knee}*{knee}*(3-2*{knee}),2.4)"
    light = f"geq=r='r(X,Y)*{weight}':g='g(X,Y)*{weight}':b='b(X,Y)*{weight}'"
    return _screened(size, BLOOM_SIGMA, light, "")


# Stylize


def _posterize(params: dict[str, float], size: tuple[int, int], clock: Clock) -> list[str]:
    """Each of red, green and blue rounded to the nearest of `levels` evenly spaced values, black and
    white among them, as Concat's (on the display's values, as here). The alpha kept."""
    steps = round(params["levels"]) - 1
    table = f"round(val*{steps}/255)*255/{steps}"
    return [f"format=gbrap,lutrgb=r='{table}':g='{table}':b='{table}',format={EFFECTS_FORMAT}"]


def _film_grain(params: dict[str, float], size: tuple[int, int], clock: Clock) -> list[str]:
    """Grain in the brightness alone, as Concat's (the same in red, green and blue): each pixel moved
    up or down by up to `amount` of 255, evenly, in a new pattern every frame (counted from the first
    frame the stack draws)."""
    return [f"noise=c0s={min(100, round(2 * params['amount']))}:c0f=t+u"]


_EFFECTS = (
    Effect(
        "gaussian-blur", "Gaussian blur", Category.BLUR, 10, "A soft, even blur.",
        (Setting("radius", "Radius", 1, 50, 10, 1, PIXELS, intensity=True),), _gaussian_blur,
    ),
    Effect(
        "motion-blur", "Motion blur", Category.BLUR, 20, "A streak along a line, as if the camera panned.",
        (Setting("length", "Length", 2, 60, 18, 1, PIXELS, intensity=True), Setting("angle", "Angle", -90, 90, 0, 1, "°")),
        _motion_blur,
    ),
    Effect(
        "pixelate", "Pixelate", Category.DISTORT, 10, "Big square pixels.",
        (Setting("size", "Size", 2, 64, 16, 1, PIXELS, intensity=True),), _pixelate,
    ),
    Effect(
        "chromatic-aberration", "Chromatic aberration", Category.DISTORT, 20,
        "Red and blue pulled apart towards the edges, the colour fringing of a cheap lens.",
        (Setting("shift", "Shift", 1, 24, 4, 1, PIXELS, intensity=True),), _chromatic_aberration,
    ),
    Effect(
        "fisheye", "Fisheye", Category.DISTORT, 30, "The bulge of a very wide lens.",
        (Setting("strength", "Strength", 5, 100, 50, 1, "%", intensity=True),), _fisheye,
    ),
    Effect(
        "glow", "Glow", Category.LIGHT, 10, "A soft bloom around the bright parts of the picture.",
        (Setting("amount", "Amount", 10, 100, 45, 1, "%", intensity=True),), _glow,
    ),
    Effect(
        "bloom-pulse", "Bloom pulse", Category.LIGHT, 20, "A soft bloom over the highlights that breathes in and out.",
        (Setting("amount", "Amount", 0, 100, 50, 1, "%", intensity=True), Setting("speed", "Speed", 0.5, 5, 2, 0.1)),
        _bloom_pulse, timed=True,
    ),
    Effect(
        "posterize", "Posterize", Category.STYLIZE, 10, "Flat bands of colour, like a screen print.",
        (Setting("levels", "Levels", 2, 8, 4, 1, intensity=True),), _posterize,
    ),
    Effect(
        "film-grain", "Film grain", Category.STYLIZE, 20, "Dancing grain, the texture of film stock.",
        (Setting("amount", "Amount", 2, 40, 12, 1, intensity=True),), _film_grain, timed=True,
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


def changes_with_time(stack: list[VideoEffect]) -> bool:
    """Whether a drawn entry of `stack` changes the picture from frame to frame (Film grain, Bloom
    pulse), so that a still image with it is read as a looping stream rather than drawn once."""
    return any(_BY_ID[applied.id].timed for applied in enabled_video_effects(stack) if applied.id in _BY_ID)


def video_effect_chain(
    stack: list[VideoEffect], size: tuple[int, int], enable: str | None = None, label: str = "vfx", clock: Clock = Clock()
) -> list[str]:
    """The filters `stack` (checked, its sizes as drawn) is drawn through on a picture of `size`
    (width, height): its enabled entries in order, on `EFFECTS_FORMAT`. Nothing for a stack with
    nothing enabled. With
    `enable` (an ffmpeg expression of `t`, an Adjustment Layer's span), each lone filter does its work
    only while it holds and passes the other frames through untouched; a part with labels of its own
    works throughout, which costs time but draws the same once laid over within the span. A builder's
    own labels are prefixed with `label` and the entry's place, which the caller makes unique in its
    filtergraph. An effect that changes with time counts the picture's own time by `clock`."""
    parts = [
        _labelled(part, f"{label}{i}_")
        for i, applied in enumerate(enabled_video_effects(stack))
        for part in get_effect(applied.id).build(applied.params, size, clock)
    ]
    if not parts:
        return []
    return [f"format={EFFECTS_FORMAT}", *(parts if enable is None else [_enabled(part, enable) for part in parts])]


def _labelled(part: str, prefix: str) -> str:
    """`part` with each of its link labels prefixed (a builder's filters never name a stream)."""
    return re.sub(r"\[([A-Za-z]\w*)\]", lambda found: f"[{prefix}{found[1]}]", part)


def _enabled(part: str, enable: str) -> str:
    """The filter `part` working only while `enable` holds, when it is one filter (every filter a
    builder uses alone supports ffmpeg's timeline)."""
    if "[" in part or ";" in part or "," in part:
        return part
    return f"{part}{':' if '=' in part else '='}enable='{enable}'"
