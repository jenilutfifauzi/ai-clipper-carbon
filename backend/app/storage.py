"""Files on disk: written so that readers never see them half-written, and the room they take."""

import os
import shutil
import tempfile
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path


def write_atomic(path: Path, data: bytes) -> None:
    """Write via a temporary file and a rename, so readers never see a partial file."""
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as tmp:
        tmp.write(data)
        tmp.flush()
        os.fsync(tmp.fileno())
    Path(tmp.name).replace(path)


@dataclass(frozen=True)
class DiskUsage:
    # The size of every file in the data directory.
    used_bytes: int
    # The volume the data directory is on.
    free_bytes: int
    total_bytes: int
    # Whether free_bytes is below warning_below_bytes (Settings.low_disk_bytes).
    warning: bool
    warning_below_bytes: int


def disk_usage(folder: Path, warning_below: int) -> DiskUsage:
    used = 0
    for root, _, names in os.walk(folder):
        for name in names:
            # A download in progress renames its files as it goes.
            with suppress(FileNotFoundError):
                used += os.lstat(os.path.join(root, name)).st_size
    volume = shutil.disk_usage(folder)
    return DiskUsage(used, volume.free, volume.total, volume.free < warning_below, warning_below)
