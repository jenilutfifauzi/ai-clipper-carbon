"""The Reference Set: the owner's past clips, listed in eval/references.yaml.

Each entry is one clip: its episode's YouTube URL, start, end, a note, and a role. `eval` clips
measure Selection (app/evaluation.py); `fewshot` clips are examples for the prompts. An episode
has one role only, so the eval never scores clips the prompts have shown as examples.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlsplit

import yaml

from app.config import REPO_ROOT

REFERENCE_SET = REPO_ROOT / "eval" / "references.yaml"
EXAMPLE = REPO_ROOT / "eval" / "references.example.yaml"

Role = Literal["eval", "fewshot"]
ROLES: tuple[Role, ...] = ("eval", "fewshot")
FIELDS = ("url", "start", "end", "note", "role")

_VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}")
_HMS = re.compile(r"(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)")
_MS = re.compile(r"(\d+):([0-5]\d(?:\.\d+)?)")
_SECONDS = re.compile(r"\d+(?:\.\d+)?")


@dataclass(frozen=True)
class Reference:
    # https://www.youtube.com/watch?v=<id>, whichever form of the URL the file uses.
    episode: str
    start: float
    end: float
    note: str
    role: Role
    # The entry's first line in the file.
    line: int


@dataclass(frozen=True)
class ReferenceSet:
    path: Path
    references: list[Reference]

    def episodes(self, role: Role) -> dict[str, list[Reference]]:
        """The `role` references by episode, episodes in the order the file first lists them."""
        episodes: dict[str, list[Reference]] = {}
        for reference in self.references:
            if reference.role == role:
                episodes.setdefault(reference.episode, []).append(reference)
        return episodes


class ReferenceSetError(ValueError):
    """The file isn't a valid Reference Set. Each of `errors` reads `<path>:<line>: <problem>`."""

    def __init__(self, errors: list[str]) -> None:
        super().__init__("\n".join(errors))
        self.errors = errors


def video_id(url: str) -> str | None:
    """The video in a YouTube URL (watch, youtu.be, live, shorts or embed form), or None."""
    url = url.strip()
    try:
        parts = urlsplit(url if "://" in url else f"https://{url}")
    except ValueError:
        return None
    host = (parts.hostname or "").removeprefix("www.").removeprefix("m.")
    path = [part for part in parts.path.split("/") if part]
    if host == "youtu.be" and len(path) == 1:
        found = path[0]
    elif host in ("youtube.com", "music.youtube.com", "youtube-nocookie.com") and path == ["watch"]:
        found = parse_qs(parts.query).get("v", [""])[0]
    elif host in ("youtube.com", "youtube-nocookie.com") and len(path) == 2 and path[0] in ("live", "shorts", "embed"):
        found = path[1]
    else:
        return None
    return found if _VIDEO_ID.fullmatch(found) else None


def load_reference_set(path: Path) -> ReferenceSet:
    """The Reference Set at `path`. ReferenceSetError lists every problem in the file, by line."""
    try:
        root = yaml.compose(path.read_text(), Loader=yaml.SafeLoader)
    except yaml.MarkedYAMLError as exc:
        mark = exc.problem_mark or exc.context_mark
        raise ReferenceSetError([f"{path}:{mark.line + 1 if mark else 1}: not valid YAML: {exc.problem}"]) from None
    if root is None:
        return ReferenceSet(path, [])

    problems: list[tuple[int, str]] = []
    if not isinstance(root, yaml.SequenceNode):
        problems.append((_line(root), "expected a list of clips, each starting with `- url:`"))
        items = []
    else:
        items = root.value
    references = []
    for item in items:
        if (reference := _reference(item, problems)) is not None:
            references.append(reference)

    roles: dict[str, dict[str, int]] = {}
    for reference in references:
        roles.setdefault(reference.episode, {}).setdefault(reference.role, reference.line)
    for episode, lines in roles.items():
        if len(lines) > 1:
            problems.append((
                lines["fewshot"],
                f"{episode} is a fewshot episode here and an eval episode on line {lines['eval']}: "
                "an episode has one role only, or the eval would score clips the prompts show as examples",
            ))

    if problems:
        raise ReferenceSetError([f"{path}:{line}: {problem}" for line, problem in sorted(problems)])
    return ReferenceSet(path, references)


def _reference(item: yaml.Node, problems: list[tuple[int, str]]) -> Reference | None:
    """The entry `item`, or None after adding its problems to `problems`."""
    line = _line(item)
    if not isinstance(item, yaml.MappingNode):
        problems.append((line, f"expected a clip with the fields {', '.join(FIELDS)}"))
        return None
    count = len(problems)
    fields: dict[str, yaml.Node] = {}
    for key, value in item.value:
        name = key.value if isinstance(key, yaml.ScalarNode) else None
        if name not in FIELDS:
            problems.append((_line(key), f"unknown field {name!r} (the fields are {', '.join(FIELDS)})"))
        elif name in fields:
            problems.append((_line(key), f"{name} is given twice"))
        else:
            fields[name] = value
    if missing := [name for name in FIELDS if name not in fields]:
        problems.append((line, f"missing {', '.join(missing)}"))

    values = {name: text for name, node in fields.items() if (text := _text(name, node, problems)) is not None}
    video = None
    if "url" in values and (video := video_id(values["url"])) is None:
        problems.append((_line(fields["url"]), f"{values['url']!r} is not a YouTube video URL"))
    times = {}
    for name in ("start", "end"):
        if name in values:
            if (seconds := _seconds(values[name])) is None:
                problems.append((
                    _line(fields[name]),
                    f"{name} {values[name]!r} is not a time: write m:ss, h:mm:ss or seconds",
                ))
            else:
                times[name] = seconds
    if len(times) == 2 and times["end"] <= times["start"]:
        problems.append((_line(fields["end"]), f"end {values['end']} is not after start {values['start']}"))
    if "role" in values and values["role"] not in ROLES:
        problems.append((_line(fields["role"]), f"unknown role {values['role']!r}: use eval or fewshot"))

    if len(problems) > count:
        return None
    assert video is not None
    episode = f"https://www.youtube.com/watch?v={video}"
    return Reference(episode, times["start"], times["end"], values["note"], values["role"], line)


def _text(name: str, node: yaml.Node, problems: list[tuple[int, str]]) -> str | None:
    """A field's value as written (so 12:34 stays a time, not YAML's base-60 number), or None."""
    if not isinstance(node, yaml.ScalarNode):
        problems.append((_line(node), f"{name} must be a single value"))
        return None
    text = "" if node.tag == "tag:yaml.org,2002:null" else node.value.strip()
    if not text:
        problems.append((_line(node), f"{name} is empty"))
        return None
    return text


def _line(node: yaml.Node) -> int:
    return node.start_mark.line + 1


def _seconds(text: str) -> float | None:
    """Seconds from m:ss, h:mm:ss or plain seconds (decimals allowed), or None."""
    if match := _HMS.fullmatch(text):
        return int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
    if match := _MS.fullmatch(text):
        return int(match[1]) * 60 + float(match[2])
    return float(text) if _SECONDS.fullmatch(text) else None
