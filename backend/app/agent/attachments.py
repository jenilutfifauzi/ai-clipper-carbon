"""Agent Attachments: what goes with one owner's message besides its words (GLOSSARY). A turn request
names them; `resolve` turns them into the context the Agent reads before the prompt, and into what
the chat keeps of them. Only the owner's own words are kept as the turn's prompt."""

from collections.abc import Sequence
from dataclasses import dataclass, field
from html import escape
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.jobs import JobStore

# How many go with one message.
MAX_ATTACHMENTS = 6
# A text file's text, in UTF-8 bytes.
MAX_TEXT_BYTES = 50 * 1024

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


# What a turn request may attach. Each later kind joins as a union member discriminated on `kind`:
# Annotated[TextAttachment | CandidateAttachment | ..., Field(discriminator="kind")].
Attachment = TextAttachment
Attachments = Annotated[list[Attachment], Field(max_length=MAX_ATTACHMENTS)]


class SentAttachment(BaseModel):
    """What a turn's record and its `turn_started` keep of one attachment, for the chips in the chat."""

    kind: str
    name: str
    # An image's id, by which it is kept with the Job; None for any other kind.
    id: str | None = None


@dataclass(frozen=True)
class ResolvedAttachments:
    # The <context> blocks the Agent reads before the prompt; "" when there are none.
    context: str = ""
    sent: list[SentAttachment] = field(default_factory=list)

    def prompt(self, prompt: str) -> str:
        """What the driver is given as the owner's message: the context, then their words."""
        return f"{self.context}\n\n{prompt}" if self.context else prompt


def resolve(store: JobStore, job_id: str, candidate_id: str, attachments: Sequence[Attachment]) -> ResolvedAttachments:
    """The context and the chat's record of what goes with a message to the Agent on `candidate_id`."""
    blocks = [_block(attachment.kind, attachment.name, attachment.text) for attachment in attachments]
    return ResolvedAttachments(
        context="\n\n".join(blocks),
        sent=[SentAttachment(kind=attachment.kind, name=attachment.name) for attachment in attachments],
    )


def _block(kind: str, name: str, body: str) -> str:
    return f'<context kind="{kind}" name="{escape(name)}">\n{body}\n</context>'
