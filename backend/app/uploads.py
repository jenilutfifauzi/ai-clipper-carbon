"""Receiving an uploaded master file: a multipart/form-data request streamed to disk as it arrives,
never held in memory whole.

The file is written to the uploads folder under a temporary name. Only once the request's closing
boundary has arrived is it complete, and only then does it become a Job (JobStore.create moves it
into the Job's directory). An upload that is cut short leaves no Job, and its partial file is
deleted, here or (after a crash) when the app next starts.
"""

import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from anyio import to_thread
from python_multipart.multipart import MultipartParser, parse_options_header
from starlette.requests import ClientDisconnect, Request

UPLOADS_DIR = "uploads"
# The form's fields: the Job's options (JobOptions as JSON) and then the file.
OPTIONS_FIELD = "options"
FILE_FIELD = "file"
# What is gathered in memory before it is written out, and how often the free space is checked again.
WRITE_BYTES = 4 * 2**20
CHECK_BYTES = 256 * 2**20
# The most a form field other than the file may hold.
FIELD_BYTES = 64 * 2**10


class NotEnoughSpace(OSError):
    """The volume hasn't the room for the upload and the reserve kept after it."""


class BadUpload(ValueError):
    """The request isn't a whole upload of the form's fields and one file."""


@dataclass(frozen=True)
class Received:
    # The complete file, in the uploads folder, and its name on the owner's machine.
    path: Path
    name: str
    fields: dict[str, str]


def free_bytes(folder: Path) -> int:
    return shutil.disk_usage(folder).free


def check_room(folder: Path, size: int, reserve: int) -> None:
    """Raise NotEnoughSpace unless the volume of `folder` has room for `size` more bytes and `reserve` after them."""
    free = free_bytes(folder)
    if free < size + reserve:
        raise NotEnoughSpace(
            f"Not enough free disk space for this upload: it needs {_gb(size)}, plus {_gb(reserve)} to "
            f"work with, and only {_gb(free)} is free. Delete old Jobs or free some space, then upload again."
        )


async def receive[T](
    request: Request, folder: Path, reserve: int, accept: Callable[[dict[str, str]], T]
) -> tuple[Received, T]:
    """Stream the request's file into `folder`. `accept` is called with the fields that came before
    the file, before any of the file is written, and may raise to refuse them; what it returns is
    returned with the upload.

    Refused before anything is written (NotEnoughSpace) when the Content-Length leaves less than
    `reserve` free, and stopped (NotEnoughSpace again) if the free space runs short while it comes,
    as another program fills the disk. BadUpload for anything that isn't a whole form with a file.
    """
    content_type, params = parse_options_header(request.headers.get("content-type"))
    if content_type != b"multipart/form-data" or b"boundary" not in params:
        raise BadUpload("Send the file as multipart/form-data")
    try:
        length = int(request.headers["content-length"])
    except (KeyError, ValueError):
        raise BadUpload("The upload needs a Content-Length") from None
    folder.mkdir(parents=True, exist_ok=True)
    check_room(folder, length, reserve)

    form = _Form()
    parser = MultipartParser(params[b"boundary"], form.callbacks())
    path = folder / f"{uuid4().hex}.part"
    accepted: T | None = None
    received = checked = 0
    try:
        with open(path, "wb") as file:
            async for chunk in request.stream():
                parser.write(chunk)
                if form.error:
                    raise BadUpload(form.error)
                if form.file_name is not None and accepted is None:
                    accepted = accept(form.fields)
                if len(form.data) >= WRITE_BYTES or form.ended:
                    await to_thread.run_sync(file.write, form.take())
                received += len(chunk)
                if received - checked >= CHECK_BYTES:
                    checked = received
                    check_room(folder, length - received, reserve)
            if not form.ended or form.file_name is None:
                raise BadUpload("The upload was cut short" if form.file_name else "The upload has no file")
    except ClientDisconnect:
        path.unlink(missing_ok=True)
        raise BadUpload("The upload was cut short: the browser stopped sending") from None
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    assert accepted is not None
    return Received(path, form.file_name, form.fields), accepted


def stage(file: Path, folder: Path, reserve: int) -> Received:
    """Stage a file on this Mac in `folder` as an upload is received, leaving the file where it is: a
    clone where the volume can make one (APFS), a copy otherwise. Refused (NotEnoughSpace) unless the
    volume has room for a copy and `reserve` after it, as an upload would be; BadUpload for a path
    that isn't a file."""
    if not file.is_file():
        raise BadUpload(f"No file {file}")
    folder.mkdir(parents=True, exist_ok=True)
    check_room(folder, file.stat().st_size, reserve)
    path = folder / f"{uuid4().hex}.part"
    try:
        # Clone where the volume can (clonefile(2) with -c on the Mac, a reflink with GNU cp), and copy where it can't.
        clone = ["-c"] if sys.platform == "darwin" else ["--reflink=auto"]
        done = subprocess.run(["cp", *clone, str(file), str(path)], capture_output=True, text=True)
        if done.returncode != 0:
            raise BadUpload(f"Can't copy {file}: {done.stderr.strip()}")
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return Received(path, file.name, {})


class _Form:
    """The parser's callbacks: the fields gathered, and the file's bytes since the last `take()`."""

    def __init__(self) -> None:
        self.fields: dict[str, str] = {}
        self.file_name: str | None = None
        self.data = bytearray()
        self.ended = False
        self.error: str | None = None
        self._header_field = bytearray()
        self._header_value = bytearray()
        self._disposition = b""
        self._field: str | None = None
        self._value = bytearray()
        self._in_file = False

    def take(self) -> bytes:
        data = bytes(self.data)
        self.data.clear()
        return data

    def callbacks(self) -> dict[str, Callable[..., None]]:
        return {
            "on_part_begin": self._part_begin,
            "on_header_field": lambda data, start, end: self._header_field.extend(data[start:end]),
            "on_header_value": lambda data, start, end: self._header_value.extend(data[start:end]),
            "on_header_end": self._header_end,
            "on_headers_finished": self._headers_finished,
            "on_part_data": self._part_data,
            "on_part_end": self._part_end,
            "on_end": self._end,
        }

    def _part_begin(self) -> None:
        self._disposition = b""
        self._value.clear()

    def _header_end(self) -> None:
        if bytes(self._header_field).lower() == b"content-disposition":
            self._disposition = bytes(self._header_value)
        self._header_field.clear()
        self._header_value.clear()

    def _headers_finished(self) -> None:
        _, params = parse_options_header(self._disposition)
        name = params.get(b"name", b"").decode(errors="replace")
        if name == FILE_FIELD and b"filename" in params:
            if self.file_name is not None:
                self.error = "Upload one file at a time"
            self.file_name = Path(params[b"filename"].decode(errors="replace")).name or "upload"
            self._in_file = True
        else:
            self._field = name

    def _part_data(self, data: bytes, start: int, end: int) -> None:
        if self._in_file:
            self.data.extend(data[start:end])
        elif len(self._value) + end - start > FIELD_BYTES:
            self.error = f"The form field {self._field!r} is too long"
        else:
            self._value.extend(data[start:end])

    def _part_end(self) -> None:
        if self._in_file:
            self._in_file = False
        elif self._field:
            self.fields[self._field] = self._value.decode(errors="replace")

    def _end(self) -> None:
        self.ended = True


def _gb(size: int) -> str:
    """Decimal units, as Finder and the disk meter count them."""
    return f"{size / 1e9:.1f} GB" if size >= 10**8 else f"{size / 1e6:.0f} MB"
