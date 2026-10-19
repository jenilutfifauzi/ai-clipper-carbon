"""Media Words: the Words of a video from the Media Library, its whole sound transcribed once per
language and Whisper model and kept beside it (docs/adr/0020-media-words-and-cue-edits.md).

They live in `media/<id>.words/<language>-<model>.json` (the model's id made a file name), in seconds
into the item, in the shape of a Clip's Words (app/rendering.py's ClipWords, without its range). Every
Segment, Candidate and Job that shows the item reads the same file, so trimming, splitting or reusing
it never transcribes again; the file goes with the item's other derived files when it is deleted
(MediaStore.delete). A transcription is queued by a Candidate's preparation or render (app/rendering.py),
which hears the item on the Whisper worker; the store remembers what is queued in this process, so that
the editor can say a Segment's captions are on their way. The item's own language, the Captions switch
and remembered failures come with later tickets.
"""

import re
import threading
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from app.storage import write_atomic
from app.transcript import Word


class MediaWordsStatus(StrEnum):
    """What a store has of an item's Media Words in a language. (A remembered failure comes with ticket 05.)"""

    # Saved.
    READY = "ready"
    # Queued to be transcribed by a preparation or a render.
    PENDING = "pending"
    # Neither.
    NONE = "none"


@dataclass(frozen=True)
class MediaWords:
    """An item's Words in seconds into it, with the language and Whisper model they were transcribed with."""

    language: str
    model: str
    words: list[Word]


_WORDS = TypeAdapter(MediaWords)


def words_folder(media_id: str) -> str:
    """The folder of the item's Media Words, relative to the Media Library's."""
    return f"{media_id}.words"


class MediaWordsStore:
    """The Media Words of the items in `folder` (the Media Library's), transcribed with the Whisper `model`."""

    def __init__(self, folder: Path, model: str) -> None:
        self.folder = folder
        self.model = model
        self._lock = threading.Lock()
        # The transcriptions queued, by item and language.
        self._queued: set[tuple[str, str]] = set()
        # One run per item and language at a time.
        self._runs: dict[tuple[str, str], threading.Lock] = {}

    def file(self, media_id: str, language: str) -> Path:
        return self.folder / words_folder(media_id) / f"{language}-{re.sub(r'[^A-Za-z0-9._-]+', '_', self.model)}.json"

    def saved(self, media_id: str, language: str) -> list[Word] | None:
        """The item's Words in `language` with the store's model, in seconds into it; None when
        there are none (or they don't validate)."""
        path = self.file(media_id, language)
        if not path.is_file():
            return None
        try:
            saved = _WORDS.validate_json(path.read_bytes())
        except ValidationError:
            return None
        return saved.words if (saved.language, saved.model) == (language, self.model) else None

    def status(self, media_id: str, language: str) -> MediaWordsStatus:
        if self.saved(media_id, language) is not None:
            return MediaWordsStatus.READY
        with self._lock:
            return MediaWordsStatus.PENDING if (media_id, language) in self._queued else MediaWordsStatus.NONE

    def queue(self, media_id: str, language: str) -> None:
        """Note that the item's transcription in `language` is queued, until `transcribe` runs it."""
        if self.saved(media_id, language) is None:
            with self._lock:
                self._queued.add((media_id, language))

    def unqueue(self, media_id: str, language: str) -> None:
        """Note that the item's transcription in `language` is no longer queued (its preparation failed first)."""
        with self._lock:
            self._queued.discard((media_id, language))

    def transcribe(self, media_id: str, language: str, hear: Callable[[], list[Word]]) -> list[Word]:
        """The item's Words in `language`: those saved, else those `hear` gives (the item transcribed
        whole, in seconds into it), saved. A second call for the same item and language waits for the
        first and reads what it saved. Either way the item's transcription is no longer queued."""
        with self._lock:
            run = self._runs.setdefault((media_id, language), threading.Lock())
        try:
            with run:
                saved = self.saved(media_id, language)
                if saved is not None:
                    return saved
                words = hear()
                path = self.file(media_id, language)
                path.parent.mkdir(parents=True, exist_ok=True)
                write_atomic(path, _WORDS.dump_json(MediaWords(language, self.model, words)))
                return words
        finally:
            with self._lock:
                self._queued.discard((media_id, language))
