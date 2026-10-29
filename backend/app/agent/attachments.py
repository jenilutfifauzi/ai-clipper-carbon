"""Agent Attachments: what goes with one owner's message besides its words (GLOSSARY). A turn request
names them; `resolve` turns them into the context the Agent reads before the prompt, and into what
the chat keeps of them. Only the owner's own words are kept as the turn's prompt."""

import base64
import binascii
import json
import re
import secrets
from collections.abc import Sequence
from dataclasses import dataclass, field
from html import escape
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, TypeAdapter, field_validator

from app.candidates import Candidate
from app.canvas import canvas_for
from app.jobs import JobStore
from app.profile import ChannelProfile, ProfileStore
from app.storage import write_atomic

# How many go with one message.
MAX_ATTACHMENTS = 6
# A text file's text, in UTF-8 bytes.
MAX_TEXT_BYTES = 50 * 1024
# An image, decoded.
MAX_IMAGE_BYTES = 5 * 1024 * 1024
# The pictures a model is sent, and the extension each is kept under.
IMAGE_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
ImageType = Literal["image/png", "image/jpeg", "image/webp", "image/gif"]
# Where a Job keeps the images sent to its Agent, each as <id>.<extension>.
IMAGES_DIR = Path("agent") / "attachments"
IMAGE_ID = re.compile(r"[0-9a-f]{16}")

# A referenced Candidate's name: its hook, cut to this many characters.
MAX_HOOK_NAME = 48
# What a Candidate's summary leaves out: edits tied to its own range's Words and Cues, of no use as
# a style reference.
RANGE_BOUND = ("word_edits", "cue_edits")

_CANDIDATE = TypeAdapter(Candidate)
_PROFILE = TypeAdapter(ChannelProfile)

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class TextAttachment(BaseModel):
    """A text file's text (a brief, a style guide, a script), read in the browser."""

    kind: Literal["text"] = "text"
    name: Name
    text: str

    @field_validator("text")
    @classmethod
    def _at_most_50_kb(cls, text: str) -> str:
        if len(text.encode()) > MAX_TEXT_BYTES:
            raise ValueError(f"is over {MAX_TEXT_BYTES // 1024} KB")
        return text


class ImageAttachment(BaseModel):
    """A picture the model sees: a screenshot of the edit to fix, a reference look."""

    kind: Literal["image"] = "image"
    name: Name
    media_type: ImageType
    # Base64, as the providers are sent it.
    data: str

    @field_validator("data")
    @classmethod
    def _base64_of_at_most_5_mb(cls, data: str) -> str:
        try:
            decoded = base64.b64decode(data, validate=True)
        except binascii.Error as error:
            raise ValueError("isn't base64") from error
        if len(decoded) > MAX_IMAGE_BYTES:
            raise ValueError(f"is over {MAX_IMAGE_BYTES // 1024 // 1024} MB")
        return data


class CandidateAttachment(BaseModel):
    """Another Candidate of the Job, whose edit goes with the message as a style reference."""

    kind: Literal["candidate"] = "candidate"
    candidate_id: str = Field(min_length=1)


class ChannelProfileAttachment(BaseModel):
    """The Channel Profile, as it is now."""

    kind: Literal["channel_profile"] = "channel_profile"


# What a turn request may attach, told apart by `kind`.
Attachment = Annotated[
    ImageAttachment | TextAttachment | CandidateAttachment | ChannelProfileAttachment, Field(discriminator="kind")
]
Attachments = Annotated[list[Attachment], Field(max_length=MAX_ATTACHMENTS)]


class SentAttachment(BaseModel):
    """What a turn's record and its `turn_started` keep of one attachment, for the chips in the chat."""

    kind: str
    name: str
    # An image's id, by which it is kept with the Job; None for any other kind.
    id: str | None = None


class ImageInput(BaseModel):
    """An image as a driver hands it to the model, with the message it goes with."""

    media_type: ImageType
    # Base64.
    data: str


@dataclass(frozen=True)
class ResolvedAttachments:
    # The <context> blocks the Agent reads before the prompt; "" when there are none.
    context: str = ""
    sent: list[SentAttachment] = field(default_factory=list)
    # The images the model sees with the prompt, in the order attached.
    images: list[ImageInput] = field(default_factory=list)

    def prompt(self, prompt: str) -> str:
        """What the driver is given as the owner's message: the context, then their words."""
        return f"{self.context}\n\n{prompt}" if self.context else prompt


class UnknownCandidate(LookupError):
    """A referenced Candidate the Job doesn't have."""


class BadAttachments(ValueError):
    """Attachments that can't go together, or with a message to this Candidate."""


def resolve(
    store: JobStore, profiles: ProfileStore, job_id: str, candidate_id: str, attachments: Sequence[Attachment]
) -> ResolvedAttachments:
    """The context, the images and the chat's record of what goes with a message to the Agent on
    `candidate_id`. Each image is kept with the Job, for the chat to show it again. Raises
    UnknownCandidate for a Candidate the Job doesn't have, and BadAttachments for the open
    Candidate, one referenced twice or the Channel Profile twice. A referenced Candidate is read
    here, for the owner: the Agent's own tools still reach only the open one."""
    blocks, sent, images = [], [], []
    candidates: dict[str, Candidate] | None = None
    referenced: set[str] = set()
    if sum(isinstance(attachment, ChannelProfileAttachment) for attachment in attachments) > 1:
        raise BadAttachments("The Channel Profile goes with a message at most once")
    for attachment in attachments:
        if isinstance(attachment, ImageAttachment):
            image_id = _keep_image(store.job_dir(job_id), attachment)
            images.append(ImageInput(media_type=attachment.media_type, data=attachment.data))
            sent.append(SentAttachment(kind=attachment.kind, name=attachment.name, id=image_id))
            continue
        if isinstance(attachment, TextAttachment):
            name, body = attachment.name, attachment.text
        elif isinstance(attachment, ChannelProfileAttachment):
            # As the /profile route gives it.
            name, body = "Channel Profile", _PROFILE.dump_json(profiles.load()).decode()
        else:
            if candidates is None:
                candidates = {each.id: each for each in store.load_candidates(job_id) or []}
            name, body = _candidate(candidates, candidate_id, referenced, attachment.candidate_id)
        blocks.append(_block(attachment.kind, name, body))
        sent.append(SentAttachment(kind=attachment.kind, name=name))
    return ResolvedAttachments(context="\n\n".join(blocks), sent=sent, images=images)


def image_path(job_dir: Path, image_id: str) -> tuple[Path, str] | None:
    """Where an image sent to the Job's Agent is kept, and its media type; None for an id that isn't
    one (which also keeps a request inside the folder) or that names no image."""
    if not IMAGE_ID.fullmatch(image_id):
        return None
    for media_type, extension in IMAGE_TYPES.items():
        if (path := job_dir / IMAGES_DIR / f"{image_id}.{extension}").is_file():
            return path, media_type
    return None


def _keep_image(job_dir: Path, image: ImageAttachment) -> str:
    image_id = secrets.token_hex(8)
    folder = job_dir / IMAGES_DIR
    folder.mkdir(parents=True, exist_ok=True)
    write_atomic(folder / f"{image_id}.{IMAGE_TYPES[image.media_type]}", base64.b64decode(image.data))
    return image_id


def _candidate(candidates: dict[str, Candidate], open_id: str, referenced: set[str], wanted: str) -> tuple[str, str]:
    """A referenced Candidate's name and summary: its edit as get_candidate gives it, without what
    only its own range's Words and Cues make sense of."""
    if wanted == open_id:
        raise BadAttachments("A message can't reference the Candidate it edits")
    if wanted in referenced:
        raise BadAttachments(f"Candidate {wanted} is referenced twice")
    found = candidates.get(wanted)
    if found is None:
        raise UnknownCandidate(f"This Job has no Candidate {wanted}")
    referenced.add(wanted)
    width, height = canvas_for(found.aspect).size
    summary = {key: value for key, value in _CANDIDATE.dump_python(found, mode="json").items() if key not in RANGE_BOUND}
    return _hook_name(found.hook_text) or found.id, json.dumps(summary | {"canvas": {"width": width, "height": height}}, ensure_ascii=False)


def _hook_name(hook: str) -> str:
    """A hook on one line without its Emphasis marks, cut to MAX_HOOK_NAME characters."""
    line = " ".join(hook.replace("*", "").split())
    return line if len(line) <= MAX_HOOK_NAME else f"{line[: MAX_HOOK_NAME - 1].rstrip()}…"


def _block(kind: str, name: str, body: str) -> str:
    return f'<context kind="{kind}" name="{escape(name)}">\n{body}\n</context>'
