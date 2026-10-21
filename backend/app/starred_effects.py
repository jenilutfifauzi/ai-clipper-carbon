"""Starred effects: the owner's favourite Video and Audio Effects, one list for the whole app (ADR 0014).

The list holds catalogue ids, in the order they were starred. It is not part of any Candidate and
not in MCP. An id the catalogues no longer have is kept: the libraries just don't show it.
"""

from pathlib import Path
from typing import Annotated

from pydantic import AfterValidator, Field, StringConstraints, TypeAdapter

from app.storage import write_atomic

# In DATA_DIR.
STARRED_FILE = "starred_effects.json"

# A catalogue id as both registries name them: lower-case words joined by hyphens.
EffectId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=64)]


def _unique(ids: list[str]) -> list[str]:
    if len(set(ids)) != len(ids):
        raise ValueError("an effect is starred at most once")
    return ids


Starred = Annotated[list[EffectId], Field(max_length=200), AfterValidator(_unique)]

_STARRED = TypeAdapter(Starred)


class StarredStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> list[str]:
        """The starred ids, or none before the first save."""
        return _STARRED.validate_json(self.path.read_bytes()) if self.path.is_file() else []

    def save(self, ids: list[str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(self.path, _STARRED.dump_json(ids, indent=2))
