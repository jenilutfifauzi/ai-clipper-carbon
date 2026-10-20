"""Looks (GLOSSARY.md, Look; docs/adr/0013): named sets of Adjust values a Grade lays over its own
Adjust at an intensity (app/grading.py says how).

Built-in Looks are data files shipped with the app, one per Look in LOOKS_DIR: a stable id, a name,
a category (the Filters tab's shelf: Cinematic, Film, Retro, Portrait, Black & White, Vibe), an order
among them, and the Adjust values, any dial left out at neutral. Adding a Look is adding a file. A
shipped Look never changes, so that an app update can't recolour a saved Candidate: a revised one gets
a new id (and file).
"""

import json
from dataclasses import dataclass, fields
from functools import cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, StringConstraints, TypeAdapter

from app.candidates import Adjust
from app.config import LOOKS_DIR

LookId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,60}$")]


class LookNotFound(LookupError):
    pass


@dataclass(frozen=True)
class Look:
    """A named Adjust a Grade's `look` names, built in."""

    id: LookId
    name: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    # Its shelf in the Filters tab, and its place: the shelves are in the order of their first Look.
    category: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    order: Annotated[int, Field(ge=0)]
    adjust: Adjust = Adjust()


_LOOK = TypeAdapter(Look)


def builtin_looks(folder: Path = LOOKS_DIR) -> list[Look]:
    """The built-in Looks of `folder`'s data files, by their order. ValueError for a file that isn't a
    valid Look (an unknown field, or a dial out of its range, included), or for two with one id."""
    looks = []
    for path in sorted(folder.glob("*.json")):
        try:
            given = json.loads(path.read_bytes())
            if unknown := sorted(given.keys() - {f.name for f in fields(Look)}):
                raise ValueError(f"no field {', '.join(unknown)}")
            if unknown := sorted(given.get("adjust", {}).keys() - {f.name for f in fields(Adjust)}):
                raise ValueError(f"no dial {', '.join(unknown)}")
            looks.append(_LOOK.validate_python(given))
        except ValueError as exc:
            raise ValueError(f"Built-in Look {path.name}: {exc}") from None
    ids = [look.id for look in looks]
    if twice := sorted({look_id for look_id in ids if ids.count(look_id) > 1}):
        raise ValueError(f"Two built-in Looks have the id {', '.join(twice)}")
    return sorted(looks, key=lambda look: (look.order, look.id))


@cache
def _builtins() -> tuple[Look, ...]:
    return tuple(builtin_looks())


def all_looks() -> list[Look]:
    """Every Look, by its order."""
    return list(_builtins())


def get_look(look_id: str) -> Look:
    """The Look `look_id`; LookNotFound for none."""
    for look in _builtins():
        if look.id == look_id:
            return look
    raise LookNotFound(look_id)
