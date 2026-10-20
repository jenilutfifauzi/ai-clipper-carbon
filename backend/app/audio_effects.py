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


def _telephone(params: dict[str, float], rate: int) -> list[str]:
    """The narrow band of a phone line: steep cuts below 350 Hz and above 3.2 kHz, the middle pushed
    up by `drive`, held under full scale."""
    return [
        "highpass=f=350:p=2", "highpass=f=350:p=2", "lowpass=f=3200:p=2", "lowpass=f=3200:p=2",
        f"equalizer=f=1700:t=q:w=1.2:g={2 + params['drive'] * 0.8:.2f}",
        "alimiter=limit=0.9:level=0:latency=1",
    ]


def _echo(params: dict[str, float], rate: int) -> list[str]:
    """One repeat `delay` seconds later, at `decay` of the sound."""
    return [f"aecho=in_gain=1:out_gain=0.75:delays={round(params['delay'] * 1000)}:decays={params['decay']:.3f}"]


def _pitch(params: dict[str, float], rate: int) -> list[str]:
    """Up or down by `semitones` at the same length: played at a sample rate that many semitones off,
    resampled back, then its tempo brought back."""
    ratio = 2 ** (params["semitones"] / 12)
    if ratio == 1:
        return []
    return [f"aresample={rate}", f"asetrate={round(rate * ratio)}", f"aresample={rate}", f"atempo={1 / ratio:.8f}"]


_EFFECTS = (
    Effect(
        "pitch", "Pitch", Group.VOICE, 10, "Up or down by semitones, the length untouched.",
        (Setting("semitones", "Semitones", -12, 12, 0, 0.5, "st", intensity=True),), _pitch,
    ),
    Effect(
        "telephone", "Telephone", Group.TONE, 40, "The narrow band of a phone line.",
        (Setting("drive", "Drive", 0, 10, 3, 0.5, intensity=True),), _telephone,
    ),
    Effect(
        "echo", "Echo", Group.SPACE, 10, "One repeat, fading.",
        (Setting("delay", "Delay", 0.05, 1, 0.25, 0.05, "s"), Setting("decay", "Decay", 0.1, 0.9, 0.4, 0.05, intensity=True)), _echo,
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
