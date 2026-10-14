"""What the owner's uploads kept for every Job have in common: the Logos (app/logos.py) and the Media
Library (app/media.py). Each keeps its items' files in a folder, with an index of them in a JSON
file, changed under a lock; and each shrinks what it keeps to a longest side with ffmpeg."""

import threading
from pathlib import Path
from typing import Protocol

from pydantic import TypeAdapter

from app.storage import write_atomic


class Identified(Protocol):
    @property
    def id(self) -> str: ...


class Index[T: Identified]:
    """Items by their id, in the order they were added, kept in the JSON file `path`."""

    def __init__(self, path: Path, adapter: TypeAdapter[list[T]]) -> None:
        self.path = path
        self.adapter = adapter
        self._lock = threading.Lock()

    def all(self) -> list[T]:
        return self.adapter.validate_json(self.path.read_bytes()) if self.path.is_file() else []

    def find(self, item_id: str) -> T | None:
        return next((item for item in self.all() if item.id == item_id), None)

    def add(self, item: T) -> None:
        with self._lock:
            self._save([*self.all(), item])

    def remove(self, item_id: str) -> bool:
        """Take the item out; False when there was no such item."""
        with self._lock:
            items = self.all()
            kept = [item for item in items if item.id != item_id]
            if len(kept) == len(items):
                return False
            self._save(kept)
            return True

    def _save(self, items: list[T]) -> None:
        write_atomic(self.path, self.adapter.dump_json(items, indent=2))


def shrink(side: int, even: bool = False) -> str:
    """An ffmpeg scale filter that shrinks (never enlarges) a picture to fit `side` on its longest
    side, keeping its aspect; to even sizes when `even` (as H.264's 4:2:0 needs)."""
    divisible = ":force_divisible_by=2" if even else ""
    return f"scale='min({side},iw)':'min({side},ih)':force_original_aspect_ratio=decrease{divisible}"
