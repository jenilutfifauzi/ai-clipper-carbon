"""What the owner's uploads kept for every Job have in common: the Logos (app/logos.py) and the Media
Library (app/media.py). Each keeps its items' files in a folder, with an index of them in a JSON
file, changed under a lock; and each shrinks what it keeps to a longest side with ffmpeg."""

from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from pydantic import TypeAdapter

from app.documents import Document, document_of


class Identified(Protocol):
    @property
    def id(self) -> str: ...


class Index[T: Identified]:
    """Items by their id, in the order they were added, kept in the JSON document `path`."""

    def __init__(self, path: Path | Document, adapter: TypeAdapter[list[T]]) -> None:
        self._doc = document_of(path)
        self.adapter = adapter

    def all(self) -> list[T]:
        saved = self._doc.read()
        return [] if saved is None else self.adapter.validate_json(saved)

    def version(self) -> object | None:
        """What differs once the items have changed; None while none were ever added."""
        return self._doc.version()

    def find(self, item_id: str) -> T | None:
        return next((item for item in self.all() if item.id == item_id), None)

    def add(self, *items: T) -> None:
        with self._doc.changing():
            self._save([*self.all(), *items])

    def change(self, item_id: str, change: Callable[[T], T]) -> T | None:
        """Replace the item with what `change` makes of it, and return that; None when there is no such item."""
        with self._doc.changing():
            items = self.all()
            found = next((i for i, item in enumerate(items) if item.id == item_id), None)
            if found is None:
                return None
            items[found] = change(items[found])
            self._save(items)
            return items[found]

    def remove(self, item_id: str) -> bool:
        """Take the item out; False when there was no such item."""
        with self._doc.changing():
            items = self.all()
            kept = [item for item in items if item.id != item_id]
            if len(kept) == len(items):
                return False
            self._save(kept)
            return True

    def _save(self, items: list[T]) -> None:
        self._doc.write(self.adapter.dump_json(items, indent=2))


def shrink(side: int, even: bool = False) -> str:
    """An ffmpeg scale filter that shrinks (never enlarges) a picture to fit `side` on its longest
    side, keeping its aspect; to even sizes when `even` (as H.264's 4:2:0 needs)."""
    divisible = ":force_divisible_by=2" if even else ""
    return f"scale='min({side},iw)':'min({side},ih)':force_original_aspect_ratio=decrease{divisible}"
