"""Audio Effects (GLOSSARY.md, Audio Effect; docs/adr/0017): the catalogue of sound treatments an
item's stack names, and the ffmpeg chain a stack is heard through.

Each effect in the registry has a stable id, a name, a group (the library's shelf: Clean, Voice, Tone,
Space) and an order among them, its settings (key, label, min, max, default, step, unit; one is the
intensity the stack's row shows) and a pure function from its settings to ffmpeg audio filters. A
built-in effect never changes what it sounds like, so that an app update can't change a saved
Candidate's sound: a revised one gets a new id, as a Look does. Concat (docs/referensi/concat) is the
reference for what each does and its settings' ranges, never for its code.

An item's stack is a list of applied effects (`AudioEffect`): a catalogue id, its settings and an
on/off switch. `checked_effects` refuses an unknown id, an unknown setting or a value out of range and
fills a setting left out with its default; `effect_chain` is the stack's enabled entries in order,
cut (or padded) to the item's length, so that an echo's tail is lost at its end.

The Clean group is the Inspector's three switches, hidden from its library: Reduce noise, Enhance
voice and Normalize loudness. Normalize isn't a fixed fragment: the renderer measures the item's
sound up to it and gives it the gain that takes it to its target (MEASURED_GAIN,
Renderer._levelled), before its chain is built; built unmeasured, it raises Unmeasured.

Video effects (#12) will join the same registry under another kind.
"""

import math
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum

# The most entries one item's stack holds.
AUDIO_EFFECTS_MAX = 20


class Group(StrEnum):
    """The library's shelves, in the order it shows them."""

    CLEAN = "Clean"
    VOICE = "Voice"
    TONE = "Tone"
    SPACE = "Space"


@dataclass(frozen=True)
class Setting:
    """One of an effect's knobs: a number from `min` to `max` in steps of `step`, `default` when left
    out. The `intensity` one is the slider of the effect's row in the stack."""

    key: str
    label: str
    min: float
    max: float
    default: float
    step: float
    unit: str = ""
    intensity: bool = False


# An effect's filters from its settings (each one given) at the chain's sample rate.
Build = Callable[[dict[str, float], int], list[str]]


@dataclass(frozen=True)
class Effect:
    """An entry of the catalogue: what the library lists, and the filters it is heard through."""

    id: str
    name: str
    group: Group
    order: int
    description: str
    settings: tuple[Setting, ...]
    build: Build = field(repr=False, compare=False)

    def setting(self, key: str) -> Setting | None:
        return next((setting for setting in self.settings if setting.key == key), None)


@dataclass(frozen=True)
class AudioEffect:
    """An Audio Effect applied to an item: the catalogue's effect `id`, its settings by key (once
    checked, every one of them), and whether it is heard (`enabled`), kept in the stack when off."""

    id: str
    params: dict[str, float] = field(default_factory=dict)
    enabled: bool = True


class EffectNotFound(LookupError):
    pass


# Builders. Each keeps its input's length, give or take a few samples (`effect_chain` cuts or pads it).


def _held(limit: float) -> str:
    """A limiter holding the sound under `limit` of full scale, its gain left alone and its lookahead
    taken back out, so the sound keeps its place."""
    return f"alimiter=limit={limit}:level=0:latency=1"


def _shifted(semitones: float, rate: int) -> list[str]:
    """Up or down by `semitones` at the same length: played at a sample rate that many semitones off,
    resampled back, then its tempo brought back."""
    ratio = 2 ** (semitones / 12)
    if ratio == 1:
        return []
    return [f"aresample={rate}", f"asetrate={round(rate * ratio)}", f"aresample={rate}", f"atempo={1 / ratio:.8f}"]


def _taps(delays: tuple[float, ...], decays: tuple[float, ...], scale: float, out_gain: float) -> str:
    """Reflections `delays` milliseconds (times `scale`) after the sound, at `decays` of it."""
    return (
        f"aecho=in_gain=0.8:out_gain={out_gain}:delays={'|'.join(str(round(delay * scale)) for delay in delays)}"
        f":decays={'|'.join(f'{decay:.3f}' for decay in decays)}"
    )


# Clean


def _denoise(params: dict[str, float], rate: int) -> list[str]:
    """The steady hum and hiss under the sound taken out (`afftdn`): with `strength`, a lower noise
    floor sought (-20 to -50 dB) and more taken off it (6 to 36 dB). No model is shipped."""
    strength = params["strength"] / 100
    return [f"afftdn=nf={-20 - 30 * strength:.1f}:nr={6 + 30 * strength:.1f}"]


def _enhance_voice(params: dict[str, float], rate: int) -> list[str]:
    """A voice cleared of its room, more of each with `amount`: the rumble cut, the hiss lightly
    taken out, the esses tamed, its level evened out, held under full scale."""
    amount = params["amount"] / 100
    return [
        "highpass=f=80", f"afftdn=nf={-25 - 20 * amount:.1f}:nr={6 + 18 * amount:.1f}", f"deesser=i={0.5 * amount:.2f}",
        f"acompressor=threshold={0.5 - 0.3 * amount:.2f}:ratio={2 + 2 * amount:.1f}:attack=15:release=120", _held(0.95),
    ]


NORMALIZE = "normalize"
# The setting the renderer gives a Normalize loudness entry once it has measured the item's sound up
# to it (Renderer._levelled): the gain, in dB, that takes it to its target. Never saved:
# `checked_effects` refuses it.
MEASURED_GAIN = "gain"
# In a Job's directory, beside its Effected copies (app/effected.py), and gone with it: the
# measurements of its items' sounds that Normalize loudness gives its gain from, one small JSON file
# each (Renderer._levelled). Never swept: they are a few bytes each.
MEASURED_DIR = "effected/loudness"
# The true peak Normalize loudness holds the sound under, in dBTP.
NORMALIZE_PEAK_DB = -1.5


class Unmeasured(ValueError):
    """A Normalize loudness entry built before its item's sound was measured."""


def _normalize(params: dict[str, float], rate: int) -> list[str]:
    """One steady gain, the one measured to take the sound to its target (`MEASURED_GAIN`), then its
    peaks held under NORMALIZE_PEAK_DB, looked for at four times the rate so that those between
    samples are caught too."""
    if MEASURED_GAIN not in params:
        raise Unmeasured("Normalize loudness needs its item's sound measured first")
    peak = 10 ** (NORMALIZE_PEAK_DB / 20)
    return [f"volume={params[MEASURED_GAIN]:.2f}dB", f"aresample={4 * rate}", _held(round(peak, 4)), f"aresample={rate}"]


def normalize_gain(loudness: float | None, target: float) -> float:
    """The gain in dB that takes a sound measured at `loudness` LUFS to `target`: none for a silent
    one (None)."""
    return 0.0 if loudness is None else target - loudness


# Voice


def _pitch(params: dict[str, float], rate: int) -> list[str]:
    return _shifted(params["semitones"], rate)


def _sweet(params: dict[str, float], rate: int) -> list[str]:
    """Lighter and closer: up a little (by `pitch`, or with `amount` when it is 0), the mud taken out,
    the presence and the air lifted, evened out, the esses tamed and a touch of a close wall."""
    strength = params["amount"] / 100
    semitones = params["pitch"] or 1 + 4 * strength
    return [
        *_shifted(semitones, rate),
        "highpass=f=90", "equalizer=f=320:t=q:w=1:g=-1.5",
        f"equalizer=f=4000:t=q:w=0.8:g={1 + 5 * strength:.2f}", f"equalizer=f=11000:t=q:w=0.7:g={1 + 6.5 * strength:.2f}",
        "compand=attacks=0.01:decays=0.2:points=-80/-80|-30/-25|-18/-13|-8/-5|0/-1.5:soft-knee=5",
        f"deesser=i={0.2 + 0.3 * strength:.3f}:m=0.45:f=0.55",
        f"aecho=in_gain=0.8:out_gain=0.8:delays=35:decays={0.01 + 0.05 * strength:.3f}",
        _held(0.94),
    ]


def _deep(params: dict[str, float], rate: int) -> list[str]:
    """Down by `pitch` semitones, with `body` dB more chest and a little less edge."""
    return [
        *_shifted(params["pitch"], rate),
        "highpass=f=50", f"equalizer=f=150:t=q:w=1:g={params['body']:.2f}", "equalizer=f=2500:t=q:w=0.9:g=-1.5", _held(0.94),
    ]


def _chipmunk(params: dict[str, float], rate: int) -> list[str]:
    """Up by `pitch` semitones, the rumble left behind."""
    return [*_shifted(params["pitch"], rate), "highpass=f=120", _held(0.94)]


def _robot(params: dict[str, float], rate: int) -> list[str]:
    """A metallic voice: phased (faster with `depth`), flanged and pushed in the upper middle."""
    return [
        f"aphaser=type=t:speed={0.5 + params['depth'] * 0.15:.2f}:decay=0.6",
        "flanger=delay=2:depth=4:speed=0.8", "equalizer=f=1800:t=q:w=1.2:g=3", _held(0.94),
    ]


def _megaphone(params: dict[str, float], rate: int) -> list[str]:
    """A handheld horn: the middle band only, pushed by `drive`."""
    return [
        "highpass=f=500", "lowpass=f=3000", f"equalizer=f=1600:t=q:w=2:g={3 + params['drive'] * 0.8:.2f}", _held(0.88),
    ]


def _whisper(params: dict[str, float], rate: int) -> list[str]:
    """Breathy: the low end taken away, the presence and the air lifted by `air`."""
    air = params["air"]
    return [
        "highpass=f=500", f"equalizer=f=3200:t=q:w=1.4:g={2 + air * 0.6:.2f}",
        f"equalizer=f=7500:t=q:w=1.2:g={1 + air * 0.5:.2f}", _held(0.92),
    ]


# Tone


def _bass(params: dict[str, float], rate: int) -> list[str]:
    """`gain` dB more low end."""
    return [f"bass=g={params['gain']:.2f}:f=110:w=0.6", _held(0.95)]


def _treble(params: dict[str, float], rate: int) -> list[str]:
    """`gain` dB more sparkle, above 9 kHz."""
    return [f"treble=g={params['gain']:.2f}:f=9000:w=0.7", _held(0.95)]


def _bright(params: dict[str, float], rate: int) -> list[str]:
    """`gain` dB more air and presence, above 6 kHz."""
    return [f"treble=g={params['gain']:.2f}:f=6000:w=0.8", _held(0.95)]


def _telephone(params: dict[str, float], rate: int) -> list[str]:
    """The narrow band of a phone line: steep cuts below 350 Hz and above 3.2 kHz, the middle pushed
    up by `drive`, held under full scale."""
    return [
        "highpass=f=350:p=2", "highpass=f=350:p=2", "lowpass=f=3200:p=2", "lowpass=f=3200:p=2",
        f"equalizer=f=1700:t=q:w=1.2:g={2 + params['drive'] * 0.8:.2f}",
        _held(0.9),
    ]


def _radio(params: dict[str, float], rate: int) -> list[str]:
    """A small speaker on a long wave: the middle band, crunched to fewer bits as `noise` rises."""
    bits = round(16 - params["noise"] / 100 * 12)
    return ["highpass=f=300", "lowpass=f=3400", f"acrusher=bits={bits}:mode=log:mix=0.6", _held(0.9)]


def _vinyl(params: dict[str, float], rate: int) -> list[str]:
    """An old turntable: band-limited, its middle warmed by `warmth`."""
    return ["highpass=f=250", "lowpass=f=5000", f"equalizer=f=1200:t=q:w=1.5:g={2 + params['warmth'] * 0.4:.2f}", _held(0.95)]


def _lofi(params: dict[str, float], rate: int) -> list[str]:
    """A small old speaker: no top end, and the grain of `bits` bits."""
    return ["lowpass=f=3200", f"acrusher=bits={round(params['bits'])}:mode=log:mix=0.8", _held(0.9)]


def _distorted(params: dict[str, float], rate: int) -> list[str]:
    """Driven hard (up to 8 times louder at full `drive`), crushed and clipped."""
    drive = params["drive"] / 100
    return [f"volume={1 + drive * 7:.2f}", f"acrusher=bits=6:mode=lin:mix={drive * 0.7:.2f}", _held(0.85)]


# Space


def _echo(params: dict[str, float], rate: int) -> list[str]:
    """One repeat `delay` seconds later, at `decay` of the sound."""
    return [f"aecho=in_gain=1:out_gain=0.75:delays={round(params['delay'] * 1000)}:decays={params['decay']:.3f}"]


def _room(params: dict[str, float], rate: int) -> list[str]:
    """A room's early reflections, further apart as `size` grows."""
    return [_taps((23, 41, 67, 97), (0.32, 0.24, 0.17, 0.11), 0.4 + params["size"] / 100 * 1.6, 0.88)]


def _hall(params: dict[str, float], rate: int) -> list[str]:
    """A concert hall's long, even reflections, scaled by `size`."""
    return [_taps((60, 110, 180, 270), (0.5, 0.4, 0.3, 0.2), 0.5 + params["size"] / 100 * 1.5, 0.85)]


def _plate(params: dict[str, float], rate: int) -> list[str]:
    """A studio plate: dense, bright, short reflections, scaled by `size`."""
    return [_taps((8, 17, 29, 43), (0.45, 0.35, 0.25, 0.15), 0.5 + params["size"] / 100 * 1.5, 0.9)]


def _cathedral(params: dict[str, float], rate: int) -> list[str]:
    """Stone and height: strong reflections that take a while to arrive, scaled by `size`."""
    return [_taps((120, 230, 390, 600), (0.6, 0.5, 0.4, 0.3), 0.5 + params["size"] / 100 * 1.5, 0.9)]


def _stadium(params: dict[str, float], rate: int) -> list[str]:
    """An arena's two far, dulled echoes, further off with `size` (1 to 10)."""
    size = params["size"]
    return [
        f"aecho=in_gain=0.8:out_gain=0.88:delays={round(120 + size * 18)}|{round(240 + size * 36)}:decays=0.450|0.280",
        "lowpass=f=6500",
    ]


def _underwater(params: dict[str, float], rate: int) -> list[str]:
    """Under the surface: everything above a few hundred Hz (lower as `depth` grows) cut away, the low
    end swelling."""
    depth = params["depth"]
    return [
        f"lowpass=f={800 - depth * 40:.0f}:p=2", f"lowpass=f={800 - depth * 40:.0f}:p=2",
        f"equalizer=f=200:t=q:w=2:g={2 + depth * 0.3:.2f}", _held(0.92),
    ]


def _size(default: float) -> tuple[Setting, ...]:
    """A Space preset's one knob: its size, 0 to 100 %."""
    return (Setting("size", "Size", 0, 100, default, 1, "%", intensity=True),)


def _gain(default: float) -> tuple[Setting, ...]:
    """A shelf's one knob: its gain, 0 to 12 dB."""
    return (Setting("gain", "Gain", 0, 12, default, 0.5, "dB", intensity=True),)


_EFFECTS = (
    # Clean: the Inspector's switches, not the library's shelves.
    Effect(
        "denoise", "Reduce noise", Group.CLEAN, 10, "Takes the steady hum and hiss out from under the sound.",
        (Setting("strength", "Strength", 0, 100, 50, 1, "%", intensity=True),), _denoise,
    ),
    Effect(
        "enhance-voice", "Enhance voice", Group.CLEAN, 20, "Clears the room out of a voice: rumble, hiss, sibilance and uneven level.",
        (Setting("amount", "Amount", 0, 100, 60, 1, "%", intensity=True),), _enhance_voice,
    ),
    Effect(
        NORMALIZE, "Normalize loudness", Group.CLEAN, 30,
        "Brings the sound to one loudness: measured up to here in the stack, then one steady gain to the target.",
        (Setting("target", "Target", -30, -12, -23, 1, "LUFS", intensity=True),), _normalize,
    ),
    # Voice
    Effect(
        "pitch", "Pitch", Group.VOICE, 10, "Up or down by semitones, the length untouched.",
        (Setting("semitones", "Semitones", -12, 12, 0, 0.5, "st", intensity=True),), _pitch,
    ),
    Effect(
        "sweet", "Sweet", Group.VOICE, 20, "Brighter, lighter and closer. At pitch 0, the pitch follows the amount.",
        (Setting("amount", "Amount", 0, 100, 65, 1, "%", intensity=True), Setting("pitch", "Pitch", 0, 8, 0, 0.5, "st")), _sweet,
    ),
    Effect(
        "deep", "Deep", Group.VOICE, 30, "Lower and fuller, the length untouched.",
        (Setting("pitch", "Pitch", -8, -1, -3, 0.5, "st", intensity=True), Setting("body", "Body", 0, 8, 3, 0.5, "dB")), _deep,
    ),
    Effect(
        "chipmunk", "Chipmunk", Group.VOICE, 40, "Higher and squeakier, the length untouched.",
        (Setting("pitch", "Pitch", 3, 12, 7, 0.5, "st", intensity=True),), _chipmunk,
    ),
    Effect(
        "robot", "Robot", Group.VOICE, 50, "Metallic and modulated.",
        (Setting("depth", "Depth", 1, 10, 5, 0.5, intensity=True),), _robot,
    ),
    Effect(
        "megaphone", "Megaphone", Group.VOICE, 60, "Harsh and mid-heavy, through a handheld horn.",
        (Setting("drive", "Drive", 1, 10, 5, 0.5, intensity=True),), _megaphone,
    ),
    Effect(
        "whisper", "Whisper", Group.VOICE, 70, "Airy and breathy: less low end, more presence.",
        (Setting("air", "Air", 1, 10, 5, 0.5, intensity=True),), _whisper,
    ),
    # Tone
    Effect("bass", "Bass", Group.TONE, 10, "More low end.", _gain(5), _bass),
    Effect("treble", "Treble", Group.TONE, 20, "More sparkle.", _gain(4), _treble),
    Effect("bright", "Bright", Group.TONE, 30, "Air and presence: a lift above 6 kHz.", _gain(5), _bright),
    Effect(
        "telephone", "Telephone", Group.TONE, 40, "The narrow band of a phone line.",
        (Setting("drive", "Drive", 0, 10, 3, 0.5, intensity=True),), _telephone,
    ),
    Effect(
        "radio", "Radio", Group.TONE, 50, "A small speaker on a long wave: a narrow band, a little crunch.",
        (Setting("noise", "Noise", 0, 100, 30, 1, "%", intensity=True),), _radio,
    ),
    Effect(
        "vinyl", "Vinyl", Group.TONE, 60, "Warm and band-limited, like an old record.",
        (Setting("warmth", "Warmth", 0, 10, 5, 0.5, intensity=True),), _vinyl,
    ),
    Effect(
        "lofi", "Lo-fi", Group.TONE, 70, "A small old speaker: no top end, and a grain to the sound.",
        (Setting("bits", "Bits", 4, 12, 8, 1, intensity=True),), _lofi,
    ),
    Effect(
        "distorted", "Distorted", Group.TONE, 80, "Driven hard and clipped.",
        (Setting("drive", "Drive", 0, 100, 50, 1, "%", intensity=True),), _distorted,
    ),
    # Space
    Effect(
        "echo", "Echo", Group.SPACE, 10, "One repeat, fading.",
        (Setting("delay", "Delay", 0.05, 1, 0.25, 0.05, "s"), Setting("decay", "Decay", 0.1, 0.9, 0.4, 0.05, intensity=True)), _echo,
    ),
    Effect("room", "Room", Group.SPACE, 20, "A room's early reflections.", _size(40), _room),
    Effect("hall", "Hall", Group.SPACE, 30, "A concert hall: long, even reflections.", _size(50), _hall),
    Effect("plate", "Plate", Group.SPACE, 40, "A studio plate: dense, bright and short.", _size(40), _plate),
    Effect("cathedral", "Cathedral", Group.SPACE, 50, "Stone and height: reflections that take a while to arrive.", _size(55), _cathedral),
    Effect(
        "stadium", "Stadium", Group.SPACE, 60, "The far echoes of a vast arena.",
        (Setting("size", "Size", 1, 10, 6, 0.5, intensity=True),), _stadium,
    ),
    Effect(
        "underwater", "Underwater", Group.SPACE, 70, "Under the surface: muffled, the low end swelling.",
        (Setting("depth", "Depth", 1, 10, 5, 0.5, intensity=True),), _underwater,
    ),
)
_BY_ID = {effect.id: effect for effect in _EFFECTS}


def effects() -> list[Effect]:
    """The catalogue, by group (`Group`'s order) and then by order."""
    shelves = list(Group)
    return sorted(_EFFECTS, key=lambda effect: (shelves.index(effect.group), effect.order))


def get_effect(effect_id: str) -> Effect:
    try:
        return _BY_ID[effect_id]
    except KeyError:
        raise EffectNotFound(effect_id) from None


def catalogue() -> list[dict]:
    """The catalogue as plain data, as the editor and the agent read it: each effect's id, name, group,
    order, description and settings."""
    return [
        {
            "id": effect.id, "name": effect.name, "group": effect.group.value, "order": effect.order, "description": effect.description,
            "settings": [vars(setting) for setting in effect.settings],
        }
        for effect in effects()
    ]


def checked_effects(stack: list[AudioEffect], item: str) -> list[AudioEffect]:
    """`stack`, each entry with every setting of its effect (a setting left out at its default).
    ValueError naming `item`, the entry's index and why, for an unknown effect, an unknown setting or
    a value out of its range."""
    if len(stack) > AUDIO_EFFECTS_MAX:
        raise ValueError(f"{item} has {len(stack)} audio effects; at most {AUDIO_EFFECTS_MAX}")
    checked = []
    for i, applied in enumerate(stack):
        where = f"{item}'s audio_effects[{i}]"
        try:
            effect = get_effect(applied.id)
        except EffectNotFound:
            raise ValueError(f"{where}: there is no audio effect {applied.id!r} (list_assets kind audio_effects)") from None
        for key, value in applied.params.items():
            setting = effect.setting(key)
            if setting is None:
                keys = ", ".join(setting.key for setting in effect.settings)
                raise ValueError(f"{where} ({effect.id}) has no setting {key!r}: its settings are {keys}")
            if not (math.isfinite(value) and setting.min <= value <= setting.max):
                raise ValueError(f"{where} ({effect.id}) {key} is {value:g}; it is {setting.min:g} to {setting.max:g}")
        params = {setting.key: float(applied.params.get(setting.key, setting.default)) for setting in effect.settings}
        checked.append(AudioEffect(effect.id, params, applied.enabled))
    return checked


def enabled_effects(stack: list[AudioEffect]) -> list[AudioEffect]:
    """The entries of `stack` that are heard."""
    return [applied for applied in stack if applied.enabled]


def effect_chain(stack: list[AudioEffect], rate: int, length: float) -> list[str]:
    """The filters `stack` (checked) is heard through, at sample rate `rate`: its enabled entries in
    order, then cut or padded to `length` seconds, its input's (an echo's tail is lost at the end).
    Nothing for a stack with nothing enabled."""
    heard = enabled_effects(stack)
    if not heard:
        return []
    built = [part for applied in heard for part in get_effect(applied.id).build(applied.params, rate)]
    return [*built, f"apad=whole_dur={length:.3f}", f"atrim=duration={length:.3f}"]
