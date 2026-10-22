"""Video Effects (GLOSSARY.md, Video Effect; docs/adr/0014): the video kind of the effects registry
(docs/adr/0017), the catalogue of treatments a picture's stack names, and the ffmpeg chain a stack is
drawn through.

It shares the Audio Effects' Setting (app/audio_effects.py), whose colour type is a key's colour. Each effect has a stable id, a name, a
category (the library's shelf: Blur, Distort, Light, Stylize, Cutout) and an order among them, a
description, its settings (one is the intensity the stack's row shows) and a pure function from its
settings and the picture's size to ffmpeg video filters. A built-in effect never changes how it
looks, so that an app update can't change a saved Candidate's picture: a revised one gets a new id.
Concat (docs/referensi/concat) is the reference for what each does and its settings' ranges, never
for its code.

A picture's stack is a list of applied effects (`VideoEffect`): a catalogue id, its settings and an
on/off switch, each id at most once. `checked_video_effects` refuses an unknown id, an unknown setting,
a value out of range, a colour not `#RRGGBB`, an id already in the stack, or a Cutout effect (a key) on
a picture other than an Overlay's, and fills a setting left out with its default.

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

from app.audio_effects import COLOUR, Setting, colour_setting

# The most entries one picture's stack holds (each effect at most once, so the catalogue's size bounds it too).
VIDEO_EFFECTS_MAX = 20
# What the catalogue lists each effect as, beside the Audio Effects.
KIND = "video"
# The unit of a size setting, which `scaled_effects` scales with the picture.
PIXELS = "px"
# A colour setting's value.
_COLOUR = re.compile(r"#[0-9A-Fa-f]{6}")
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


# A setting's value: a number, or a colour's `#RRGGBB`.
type Value = float | str
# An effect's filters from its settings (each one given, sizes at the drawn size), the picture's
# drawn size (width, height), its Clock, and the Canvas it is drawn on, at the plan's size (short
# side 1080), whatever the export's.
Build = Callable[[dict[str, Value], tuple[int, int], Clock, tuple[int, int]], list[str]]


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

    @property
    def keys(self) -> bool:
        """Whether it is a key (a Cutout effect), which takes part of the picture out: an Overlay's
        only, which has something under it to show."""
        return self.category is Category.CUTOUT

    def setting(self, key: str) -> Setting | None:
        return next((setting for setting in self.settings if setting.key == key), None)


@dataclass(frozen=True)
class VideoEffect:
    """A Video Effect applied to a picture: the catalogue's effect `id`, its settings by key (once
    checked, every one of them), and whether it is drawn (`enabled`), kept in the stack when off."""

    id: str
    params: dict[str, float | str] = field(default_factory=dict)
    enabled: bool = True


class EffectNotFound(LookupError):
    pass


# Builders. Each keeps its input's size, length and frame rate.


# Blur


def _gaussian_blur(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
    """A Gaussian of sigma `radius` drawn pixels, as Concat's is (the picture's edges extended)."""
    return [f"gblur=sigma={params['radius']:.3f}"]


def _motion_blur(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
    """A blur along one line only, of about a Gaussian's sigma `length` drawn pixels, as Concat's
    streak is. The line is turned `angle` degrees from the horizontal, upwards on the right for a
    positive one (dblur turns the other way)."""
    return [f"dblur=angle={-params['angle'] % 360:g}:radius={params['length']:.3f}"]


# Distort


def _pixelate(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
    """Blocks `size` drawn pixels square, each the mean of its pixels, counted from the top left."""
    block = min(max(round(params["size"]), 1), 1024)
    return [f"pixelize=w={block}:h={block}:mode=avg"]


def _chromatic_aberration(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
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


def _fisheye(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
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
def _screened(size: tuple[int, int], frame: tuple[int, int], sigma: float, light: str, over: str) -> list[str]:
    """The picture with its own light, `light` (filters of a planar RGB copy of it, a quarter its size
    each way), blurred by a Gaussian of `sigma` drawn pixels at that quarter size, scaled back and
    screened over it, as two projectors add light: the blend's `over` options for red, green and blue
    (its strength), its alpha kept. A picture's own sigma grows with its size, as its fitted size's
    scale (the larger of its width and height over those of `frame`, the Canvas it fits, so that a
    full-frame picture's is `sigma` on every aspect). One part: its labels run it on every frame."""
    width, height = size
    spread = sigma * max(width / frame[0], height / frame[1]) / 4
    quarter = f"{max(1, round(width / 4))}:{max(1, round(height / 4))}"
    return [
        f"format=gbrap,setsar=1,split[base][light];"
        f"[light]scale={quarter},{light}{',' if light else ''}gblur=sigma={spread:.3f},scale={width}:{height},setsar=1[glow];"
        f"[base][glow]blend=c0_mode=screen:c1_mode=screen:c2_mode=screen:{over}c3_mode=normal,format={EFFECTS_FORMAT}"
    ]


def _glow(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
    """The picture's light spread wide and screened back over it by `amount`, as Concat's."""
    amount = params["amount"] / 100
    over = "".join(f"c{plane}_opacity={amount:.4f}:" for plane in range(3))
    return _screened(size, frame, GLOW_SIGMA, "", over)


# Rec. 709's luma of red, green and blue, as Concat's Bloom weighs a pixel's brightness.
_LUMA = (0.2126, 0.7152, 0.0722)


def _bloom_pulse(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
    """The highlights' light (each pixel weighted by how far its luma is past 0.55, smoothed and taken
    to the 2.4th power, as Concat's) spread and screened back over the picture, at a strength
    `amount` × (0.6 + 0.4 sin(time × `speed`)) of its own time: it breathes, a full breath every
    2π / `speed` seconds from its start.

    At the light's quarter size, the weight is a table of the luma (a grey copy, `lutrgb`) multiplied
    onto the picture, and only the strength changes with time: a gain set on each frame by `sendcmd`
    (its `T` the frame's time). Not a `geq` of the weight and its time, whose `pow` per plane and
    pixel cost about 20 times a plain render (the render cost ticket, 10)."""
    amount, speed = params["amount"] / 100, params["speed"]
    knee = "clip((val/255-0.55)/0.45,0,1)"
    weight = f"255*pow({knee}*{knee}*(3-2*{knee}),2.4)"
    grey = ":".join(f"{row}{column}={share}" for row in "rgb" for column, share in zip("rgb", _LUMA))
    strength = f"{amount:.4f}*(0.6+0.4*sin({clock.of('T')}*{speed:g}))"
    gains = ", ".join(f"[expr] colorchannelmixer@pulse {gain} {strength}" for gain in ("rr", "gg", "bb"))
    # Before its first command (a frame before 0), the strength at its start.
    first = ":".join(f"{gain}={amount * 0.6:.4f}" for gain in ("rr", "gg", "bb"))
    light = (
        f"split[colour][luma];[luma]colorchannelmixer={grey},lutrgb=r='{weight}':g='{weight}':b='{weight}'[weight];"
        f"[colour][weight]blend=c0_mode=multiply:c1_mode=multiply:c2_mode=multiply:c3_mode=normal,"
        f"sendcmd=c='0 {gains}',colorchannelmixer@pulse={first}"
    )
    return _screened(size, frame, BLOOM_SIGMA, light, "")


# Stylize


def _posterize(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
    """Each of red, green and blue rounded to the nearest of `levels` evenly spaced values, black and
    white among them, as Concat's (on the display's values, as here). The alpha kept."""
    steps = round(params["levels"]) - 1
    table = f"round(val*{steps}/255)*255/{steps}"
    return [f"format=gbrap,lutrgb=r='{table}':g='{table}':b='{table}',format={EFFECTS_FORMAT}"]


def _film_grain(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
    """Grain in the brightness alone, as Concat's (the same in red, green and blue): each pixel moved
    up or down by up to `amount` of 255, evenly, in a new pattern every frame (counted from the first
    frame the stack draws)."""
    return [f"noise=c0s={min(100, round(2 * params['amount']))}:c0f=t+u"]


# Cutout


def _hex_rgb(colour: str) -> tuple[float, float, float]:
    """A `#RRGGBB` colour's red, green and blue, 0 to 1."""
    return int(colour[1:3], 16) / 255, int(colour[3:5], 16) / 255, int(colour[5:7], 16) / 255


def chroma(red: float, green: float, blue: float) -> tuple[float, float]:
    """A display colour's chroma, BT.709's Cb and Cr (-0.5 to 0.5), as Concat's key measures it."""
    return -0.1146 * red - 0.3854 * green + 0.5 * blue, 0.5 * red - 0.4542 * green - 0.0458 * blue


# The display RGB's BT.709 Y, Cb and Cr at full range, whose planes a key reads: what the eyedropper
# picks and the preview measures, whatever matrix the picture's own frames came in.
_YCBCR = "scale=out_color_matrix=bt709:out_range=full,format=yuv444p"


def _smoothstep(edge: str, width: str, value: str) -> str:
    """An ffmpeg expression of 0 below `edge`, 1 past `edge` + `width`, smooth between (Concat's
    smoothstep); it keeps its step in the expression's variable 0."""
    return f"st(0,clip(({value}-{edge})/{width},0,1));ld(0)*ld(0)*(3-2*ld(0))"


def _chroma_key(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
    """A key on the display's colours, as Concat's: a pixel whose chroma (`chroma`) is within
    `similarity` % of the key `color`'s (of the farthest two chromas can be apart) is taken out, fading
    back in over `softness` % more; then, by `spill` %, what leans towards the key's hue has that lean
    taken out of its chroma, its luma kept, so that a green fringe or cast is cleaned off. Each a table
    of two planes (`lut2`): the alpha and the spill's amount from Cb and Cr, then red, green and blue
    each less that amount of the key's hue, and the picture's own alpha times the key's. One part: its
    labels run it on every frame."""
    key_cb, key_cr = chroma(*_hex_rgb(str(params["color"])))
    similarity, softness = float(params["similarity"]) / 100, max(float(params["softness"]) / 100, 0.001)
    distance = f"hypot((x-128)/255-({key_cb:.6f}),(y-128)/255-({key_cr:.6f}))/0.7071"
    keep = f"255*({_smoothstep(f'{similarity:.4f}', f'{softness:.4f}', distance)})"
    reach = math.hypot(key_cb, key_cr)
    # The key's hue, a unit chroma, and what one of it is in red, green and blue at the same luma.
    towards = (key_cb / reach, key_cr / reach) if reach > 1e-4 else (0.0, 0.0)
    lean = (1.5748 * towards[1], -0.1873 * towards[0] - 0.4681 * towards[1], 1.8556 * towards[0])
    spill = float(params["spill"]) / 100
    # How much of the key's hue to take out, of 255: the chroma's lean towards it, times `spill`.
    amount = f"clip({255 * spill:.4f}*max((x-128)/255*({towards[0]:.6f})+(y-128)/255*({towards[1]:.6f}),0),0,255)"
    cleaned = [f"[{plane}][{plane}amount]lut2=c0='clip(x-y*({step:.6f}),0,255)'[{plane}clean]" for plane, step in zip("rgb", lean)]
    return [
        f"format=gbrap,split[picture][measured];[measured]{_YCBCR},extractplanes=u+v[cb][cr];"
        f"[cb]split[cbkey][cbspill];[cr]split[crkey][crspill];"
        f"[cbkey][crkey]lut2=c0='{keep}'[keep];[cbspill][crspill]lut2=c0='{amount}',split=3[ramount][gamount][bamount];"
        f"[picture]extractplanes=r+g+b+a[r][g][b][a];{';'.join(cleaned)};[keep][a]lut2=c0='x*y/255'[alpha];"
        f"[gclean][bclean][rclean][alpha]mergeplanes=mapping=0x00102030:format=gbrap,format={EFFECTS_FORMAT}"
    ]


def _luma_key(params: dict[str, Value], size: tuple[int, int], clock: Clock, frame: tuple[int, int]) -> list[str]:
    """A key on the display's luma (BT.709), as Concat's: a pixel darker than `threshold` % is taken
    out, fading back in over `softness` % below it; with `invert`, a pixel lighter than it, fading over
    `softness` % above it. The picture's own alpha times the key's, by a table of the luma and the
    alpha (`lut2`). One part: its labels run it on every frame."""
    threshold, softness = float(params["threshold"]) / 100, max(float(params["softness"]) / 100, 0.001)
    level = "x/255"
    if float(params["invert"]) > 0.5:
        keep = f"(1-({_smoothstep(f'{threshold:.4f}', f'{softness:.4f}', level)}))"
    else:
        keep = f"({_smoothstep(f'{threshold - softness:.4f}', f'{softness:.4f}', level)})"
    return [
        f"format=gbrap,split[picture][measured];[measured]{_YCBCR},extractplanes=y[luma];"
        f"[picture]split[colour][own];[own]extractplanes=a[a];[luma][a]lut2=c0='y*{keep}'[alpha];"
        f"[colour][alpha]alphamerge,format={EFFECTS_FORMAT}"
    ]


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
    Effect(
        "chroma-key", "Chroma key", Category.CUTOUT, 10, "Takes out a screen's colour, green by default, so what is under the picture shows.",
        (
            colour_setting("color", "Key colour", "#00B140"),
            Setting("similarity", "Similarity", 1, 60, 30, 1, "%", intensity=True),
            Setting("softness", "Softness", 0, 50, 10, 1, "%"),
            Setting("spill", "Spill", 0, 100, 50, 1, "%"),
        ),
        _chroma_key,
    ),
    Effect(
        "luma-key", "Luma key", Category.CUTOUT, 20, "Takes out the dark of the picture, a logo's black, or inverted, the light.",
        (
            Setting("threshold", "Threshold", 0, 100, 10, 1, "%", intensity=True),
            Setting("softness", "Softness", 0, 50, 10, 1, "%"),
            Setting("invert", "Invert", 0, 1, 0, 1),
        ),
        _luma_key,
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
            "description": effect.description, "settings": [setting.listed() for setting in effect.settings],
        }
        for effect in effects()
    ]


def checked_video_effects(stack: list[VideoEffect], item: str, keyed: bool = False) -> list[VideoEffect]:
    """`stack`, each entry with every setting of its effect (a setting left out at its default, a
    colour in capitals). ValueError naming `item`, the entry's index and why, for an unknown effect, an
    unknown setting, a value out of its range or a colour not `#RRGGBB`, an effect already in the
    stack, or a key (a Cutout effect) unless the picture may be `keyed` (an Overlay)."""
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
        if effect.keys and not keyed:
            raise ValueError(f"{where} ({effect.id}) is a key (Cutout): only an Overlay takes one, over what is under it")
        for key, value in applied.params.items():
            setting = effect.setting(key)
            if setting is None:
                keys = ", ".join(setting.key for setting in effect.settings)
                raise ValueError(f"{where} ({effect.id}) has no setting {key!r}: its settings are {keys}")
            if setting.type == COLOUR:
                if not (isinstance(value, str) and _COLOUR.fullmatch(value)):
                    raise ValueError(f"{where} ({effect.id}) {key} is {value!r}; it is a colour, #RRGGBB")
            elif isinstance(value, str) or not (math.isfinite(value) and setting.min <= value <= setting.max):
                raise ValueError(f"{where} ({effect.id}) {key} is {repr(value) if isinstance(value, str) else format(value, 'g')}; it is {setting.min:g} to {setting.max:g}")
        params = {setting.key: _value(setting, applied.params.get(setting.key, setting.default)) for setting in effect.settings}
        checked.append(VideoEffect(effect.id, params, applied.enabled))
    return checked


def _value(setting: Setting, value: Value) -> Value:
    """A checked setting's value as it is kept: a colour in capitals, a number a float."""
    return str(value).upper() if setting.type == COLOUR else float(value)


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
    stack: list[VideoEffect], size: tuple[int, int], enable: str | None = None, label: str = "vfx", clock: Clock = Clock(),
    *,
    frame: tuple[int, int],
) -> list[str]:
    """The filters `stack` (checked, its sizes as drawn) is drawn through on a picture of `size`
    (width, height) on the Canvas `frame` (at the plan's size, short side 1080: `canvas.unscaled`):
    its enabled entries in order, on `EFFECTS_FORMAT`. Nothing for a stack with nothing enabled. With
    `enable` (an ffmpeg expression of `t`, an Adjustment Layer's span), each lone filter does its work
    only while it holds and passes the other frames through untouched; a part with labels of its own
    works throughout, which costs time but draws the same once laid over within the span. A builder's
    own labels are prefixed with `label` and the entry's place, which the caller makes unique in its
    filtergraph. An effect that changes with time counts the picture's own time by `clock`."""
    parts = [
        _labelled(part, f"{label}{i}_")
        for i, applied in enumerate(enabled_video_effects(stack))
        for part in get_effect(applied.id).build(applied.params, size, clock, frame)
    ]
    if not parts:
        return []
    return [f"format={EFFECTS_FORMAT}", *(parts if enable is None else [_enabled(part, enable) for part in parts])]


def _labelled(part: str, prefix: str) -> str:
    """`part` with each of its link labels and filter instance names (`filter@name`, which `sendcmd`
    addresses) prefixed (a builder's filters never name a stream). `[expr]` is a `sendcmd` flag."""
    labelled = re.sub(r"\[(?!expr\])([A-Za-z]\w*)\]", lambda found: f"[{prefix}{found[1]}]", part)
    return re.sub(r"@([A-Za-z]\w*)", lambda found: f"@{prefix}{found[1]}", labelled)


def _enabled(part: str, enable: str) -> str:
    """The filter `part` working only while `enable` holds, when it is one filter (every filter a
    builder uses alone supports ffmpeg's timeline)."""
    if "[" in part or ";" in part or "," in part:
        return part
    return f"{part}{':' if '=' in part else '='}enable='{enable}'"
