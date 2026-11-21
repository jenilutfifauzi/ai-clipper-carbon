"""This machine, among those the owner runs the app on.

An account's documents are the same on each of them (ADR 0033), while a Job's media are on the one
it was made on: each Job names that machine, its Host.
"""

import json
import socket
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from app.documents import FileDocument

# In DATA_DIR, beside the accounts.
MACHINE_FILE = "machine.json"


@dataclass(frozen=True)
class Machine:
    # Made once and kept in MACHINE_FILE: a host name changes with the network a laptop is on.
    id: str
    # What the owner reads on the other machines: MACHINE_NAME, or the host name as it is now.
    name: str


def this_machine(data_dir: Path, name: str | None = None) -> Machine:
    """The machine whose data directory `data_dir` is, named `name` when given."""
    kept = FileDocument(data_dir / MACHINE_FILE)
    saved = kept.read()
    if saved is None:
        kept.write(json.dumps({"id": uuid4().hex}).encode())
        # Another process starting at once may have written first: all take what was kept.
        saved = kept.read() or b"{}"
    return Machine(json.loads(saved)["id"], name or socket.gethostname())
