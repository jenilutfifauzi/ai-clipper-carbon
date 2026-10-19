"""Media Words: the Words of a video from the Media Library, its whole sound transcribed once per
language and Whisper model and kept beside it (docs/adr/0020-media-words-and-cue-edits.md).

They live in `media/<id>.words/<language>-<model>.json` (the model's id made a file name), in seconds
into the item, in the shape of a Clip's Words (app/rendering.py's ClipWords, without its range). Every
Segment, Candidate and Job that shows the item reads the same file, so trimming, splitting or reusing
it never transcribes again; the file goes with the item's other derived files when it is deleted
(MediaStore.delete). A transcription is queued by a Candidate's preparation or render (app/rendering.py),
or by a Retry, which hears the item on the Whisper worker. The store remembers, in this process, what is
queued, so that the editor can say a Segment's captions are on their way. What failed it remembers on
disk, beside the Words, in `media/<id>.words/<language>-<model>.failed.json` (`MediaWordsFailure`: the
error, and whether transcribing a saved language again is what failed), until a Retry or a
transcription that succeeds, across restarts: a failed item isn't heard again by a preparation or a
render (the render fails, naming it). "Transcribe again" re-runs a saved language and replaces its file.
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
    """What a store has of an item's Media Words in a language."""

    # Saved.
    READY = "ready"
    # Queued to be transcribed (again) by a preparation, a render or a Retry.
    PENDING = "pending"
    # Its transcription failed (`MediaWordsStore.error`), until a Retry.
    FAILED = "failed"
    # None of these.
    NONE = "none"


class MediaWordsFailed(RuntimeError):
    """The item's transcription failed, now or before a Retry: its message is the error."""


@dataclass(frozen=True)
class MediaWords:
    """An item's Words in seconds into it, with the language and Whisper model they were transcribed with."""

    language: str
    model: str
    words: list[Word]


_WORDS = TypeAdapter(MediaWords)


@dataclass(frozen=True)
class MediaWordsFailure:
    """Why an item's transcription in a language with a Whisper model failed, and whether it was
    transcribing it again (though saved) that failed."""

    language: str
    model: str
    error: str
    again: bool = False


_FAILURE = TypeAdapter(MediaWordsFailure)


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
        # Those to transcribe again, though saved (until it runs; a failure keeps it on disk).
        self._again: set[tuple[str, str]] = set()

    def file(self, media_id: str, language: str) -> Path:
        return self.folder / words_folder(media_id) / f"{language}-{re.sub(r'[^A-Za-z0-9._-]+', '_', self.model)}.json"

    def failure_file(self, media_id: str, language: str) -> Path:
        return self.file(media_id, language).with_suffix(".failed.json")

    def _failure(self, media_id: str, language: str) -> MediaWordsFailure | None:
        """The item's failure in `language` with the store's model, until a Retry; None when there is
        none (or it doesn't validate)."""
        path = self.failure_file(media_id, language)
        try:
            failure = _FAILURE.validate_json(path.read_bytes())
        except (OSError, ValidationError):
            return None
        return failure if (failure.language, failure.model) == (language, self.model) else None

    def _forget_failure(self, media_id: str, language: str) -> MediaWordsFailure | None:
        failure = self._failure(media_id, language)
        self.failure_file(media_id, language).unlink(missing_ok=True)
        return failure

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
        """Pending while queued (even when saved, to be transcribed again), failed until a Retry (even
        when saved: transcribing it again failed), else ready or none."""
        key = (media_id, language)
        with self._lock:
            if key in self._queued:
                return MediaWordsStatus.PENDING
            if self._failure(media_id, language) is not None:
                return MediaWordsStatus.FAILED
        return MediaWordsStatus.READY if self.saved(media_id, language) is not None else MediaWordsStatus.NONE

    def error(self, media_id: str, language: str) -> str | None:
        """Why the item's transcription in `language` failed, until a Retry."""
        with self._lock:
            failure = self._failure(media_id, language)
        return failure.error if failure is not None else None

    def queue(self, media_id: str, language: str) -> None:
        """Note that the item's transcription in `language` is queued, until `transcribe` runs it;
        not when it is saved, or failed (until a Retry)."""
        if self.saved(media_id, language) is None:
            with self._lock:
                if self._failure(media_id, language) is None:
                    self._queued.add((media_id, language))

    def retry(self, media_id: str, language: str, again: bool = False) -> None:
        """Forget the item's failure in `language` and queue it; with `again` (or when transcribing it
        again is what failed), queue it even when it is saved, to be transcribed again and its file
        replaced."""
        key = (media_id, language)
        with self._lock:
            failure = self._forget_failure(media_id, language)
            if again or (failure is not None and failure.again):
                self._again.add(key)
            if key in self._again:
                self._queued.add(key)
                return
        self.queue(media_id, language)

    def unqueue(self, media_id: str, language: str) -> None:
        """Note that the item's transcription in `language` is no longer queued (its preparation failed first)."""
        with self._lock:
            self._queued.discard((media_id, language))

    def transcribe(
        self, media_id: str, language: str, hear: Callable[[], list[Word]], interrupted: tuple[type[BaseException], ...] = (),
    ) -> list[Word]:
        """The item's Words in `language`: those saved (unless it is to be transcribed again), else
        those `hear` gives (the item transcribed whole, in seconds into it), saved. A second call for
        the same item and language waits for the first and reads what it saved. MediaWordsFailed when
        `hear` raises anything but the `interrupted` exceptions (the app stopping), which is
        remembered, or when it failed before, until a Retry. Either way the item's transcription is no
        longer queued."""
        key = (media_id, language)
        with self._lock:
            run = self._runs.setdefault(key, threading.Lock())
        try:
            with run:
                with self._lock:
                    failure, again = self._failure(media_id, language), key in self._again
                if failure is not None:
                    raise MediaWordsFailed(failure.error)
                saved = self.saved(media_id, language)
                if saved is not None and not again:
                    return saved
                try:
                    words = hear()
                except interrupted:
                    raise
                except Exception as exc:
                    failed = self.failure_file(media_id, language)
                    failed.parent.mkdir(parents=True, exist_ok=True)
                    with self._lock:
                        write_atomic(failed, _FAILURE.dump_json(MediaWordsFailure(language, self.model, str(exc), again)))
                    raise MediaWordsFailed(str(exc)) from exc
                path = self.file(media_id, language)
                path.parent.mkdir(parents=True, exist_ok=True)
                write_atomic(path, _WORDS.dump_json(MediaWords(language, self.model, words)))
                with self._lock:
                    self._forget_failure(media_id, language)
                    self._again.discard(key)
                return words
        finally:
            with self._lock:
                self._queued.discard(key)
