"""Listeners: what is told each time something changes, such as the Faces (app/fonts.py) or the Text
Presets (app/text_presets.py), whether for good (a cache to clear) or while a block runs (the
editor's event stream, app/events.py)."""

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager


class Listeners:
    """Callables to call, with no arguments, each time something changes. Each is called on the
    thread making the change, and must return quickly."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._listeners: tuple[Callable[[], None], ...] = ()

    def add(self, listener: Callable[[], None]) -> None:
        """Call `listener` from now on."""
        with self._lock:
            self._listeners = (*self._listeners, listener)

    @contextmanager
    def watching(self, listener: Callable[[], None]) -> Iterator[None]:
        """Call `listener` until the block ends."""
        self.add(listener)
        try:
            yield
        finally:
            with self._lock:
                self._listeners = tuple(other for other in self._listeners if other is not listener)

    def notify(self) -> None:
        """Call each listener."""
        for listener in self._listeners:
            listener()
