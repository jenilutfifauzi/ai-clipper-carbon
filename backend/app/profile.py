"""The Channel Profile: the owner's standing steering for Selection, one for the whole app.

Every field is optional free text; an empty profile is valid and steers nothing. Each Job keeps a
snapshot of the profile as it was when the Job was created (`Job.profile`), so an edit steers new
Jobs only.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from pydantic import StringConstraints, TypeAdapter

from app.storage import write_atomic

# In DATA_DIR.
PROFILE_FILE = "profile.json"

Text = Annotated[str, StringConstraints(strip_whitespace=True)]


@dataclass(frozen=True)
class ChannelProfile:
    niche: Text = ""
    audience: Text = ""
    clip_style: Text = ""
    # Things the channel's clips stay away from.
    avoid: Text = ""


_PROFILE = TypeAdapter(ChannelProfile)


class ProfileStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> ChannelProfile:
        """The saved profile, or an empty one before the first save."""
        return _PROFILE.validate_json(self.path.read_bytes()) if self.path.is_file() else ChannelProfile()

    def save(self, profile: ChannelProfile) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        write_atomic(self.path, _PROFILE.dump_json(profile, indent=2))
