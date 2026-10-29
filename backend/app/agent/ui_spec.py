"""Agent UI: what the Agent shows in the chat through the scoped server's `show_ui` tool, a spec of one
of five kinds that the Agent tab draws as a component (ADR 0031)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, model_validator

# The longest label of a choice: a button's line, not a paragraph.
LABEL_CHARS = 80


class _Spec(BaseModel):
    # A field the chat doesn't draw is refused rather than dropped, so the Agent learns it isn't shown.
    model_config = ConfigDict(extra="forbid")


class Choice(_Spec):
    label: str = Field(max_length=LABEL_CHARS)
    # What the owner's click sends as the next turn's message.
    prompt: str
    detail: str | None = None


class ChoicesUi(_Spec):
    """Alternatives the owner picks one of: the click sends its `prompt` as the next turn."""

    kind: Literal["choices"]
    title: str | None = None
    options: list[Choice] = Field(min_length=2, max_length=6)


class CandidateUi(_Spec):
    """The Candidate as it is now, which the chat draws from the editor's own: the spec carries none of
    it, only a note and, optionally, a frame that save_frame saved (its path) shown as its picture."""

    kind: Literal["candidate"]
    note: str | None = None
    frame: str | None = None


class TableUi(_Spec):
    kind: Literal["table"]
    title: str | None = None
    columns: list[str] = Field(min_length=1, max_length=8)
    rows: list[list[str | int | float]] = Field(max_length=50)

    @model_validator(mode="after")
    def _rows_fit(self) -> "TableUi":
        for index, row in enumerate(self.rows):
            if len(row) != len(self.columns):
                raise ValueError(f"rows[{index}] has {len(row)} cells, but there are {len(self.columns)} columns")
        return self


class KeyValue(_Spec):
    label: str
    value: str | int | float


class KeyValuesUi(_Spec):
    kind: Literal["key_values"]
    title: str | None = None
    items: list[KeyValue] = Field(min_length=1, max_length=20)


class ChecklistItem(_Spec):
    text: str
    done: bool


class CalloutUi(_Spec):
    """A note set apart by its tone, its body Markdown; with a checklist the owner reads (not ticks)."""

    kind: Literal["callout"]
    tone: Literal["info", "success", "warning", "danger"]
    title: str | None = None
    body: str
    checklist: list[ChecklistItem] | None = None


UiSpec = Annotated[ChoicesUi | CandidateUi | TableUi | KeyValuesUi | CalloutUi, Field(discriminator="kind")]

UI_SPEC: TypeAdapter[UiSpec] = TypeAdapter(UiSpec)


def is_show_ui(tool: str) -> bool:
    """Whether `tool` is show_ui, which an ACP agent may name with its `mcp__…__` prefix."""
    return tool == "show_ui" or tool.endswith("__show_ui")


def parsed(output: str | None) -> dict | None:
    """A finished show_ui call's output as the spec the chat draws, or None when it isn't one."""
    if output is None:
        return None
    try:
        return UI_SPEC.validate_json(output).model_dump(mode="json", exclude_none=True)
    except ValidationError:
        return None
