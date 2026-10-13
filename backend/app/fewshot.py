"""Few-shot examples for the Detail pass: the owner's `fewshot` clips from the Reference Set.

An example is a clip's note and the Transcript excerpt of exactly its range. A fewshot episode
needs its Transcript only, so it comes from YouTube's captions alone: fetched once through the
Video Source without the video, then cached in DATA_DIR/fewshot/<video id>/. An episode without
captions in the Job's language is left out with a warning, rather than transcribed locally.
"""

import itertools
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter

from app.config import SelectionTuning
from app.references import Reference, load_reference_set, video_id
from app.storage import write_atomic
from app.transcript import Transcript, parse_json3, timestamp
from app.video_source import VideoSource

logger = logging.getLogger(__name__)

# In DATA_DIR.
FEWSHOT_DIR = "fewshot"

_TRANSCRIPT = TypeAdapter(Transcript)


@dataclass(frozen=True)
class Example:
    """A clip the owner posted, as the Detail pass sees it."""

    episode: str
    start: float
    end: float
    note: str
    # The episode's Words between start and end.
    text: str


def few_shot_examples(
    reference_set: Path,
    video_source: VideoSource,
    cache: Path,
    language: str,
    tuning: SelectionTuning,
    progress: Callable[[str], None] = lambda message: None,
) -> tuple[list[Example], list[str]]:
    """The examples made from the fewshot clips in `reference_set` (none without the file), capped
    as SelectionTuning says, and a warning for each clip left out for want of captions.

    Raises ReferenceSetError when the file is invalid, as when an episode is listed under both roles.
    """
    if not reference_set.is_file():
        return [], []
    episodes = load_reference_set(reference_set).episodes("fewshot")
    warnings: list[str] = []
    found: list[list[Example]] = []
    for n, (episode, references) in enumerate(episodes.items(), 1):
        left_out = f"its {_clips(len(references))} left out of the few-shot examples"
        try:
            transcript = _transcript(episode, video_source, cache, language, f"{n} of {len(episodes)}", progress)
        except Exception as exc:
            logger.warning("Couldn't fetch the captions of %s", episode, exc_info=True)
            warnings.append(f"Couldn't fetch the captions of {episode} ({exc}): {left_out}")
            continue
        if transcript is None:
            warnings.append(f"{episode} has no '{language}' YouTube captions: {left_out}")
            continue
        examples = []
        for reference in references:
            if example := _example(reference, transcript):
                examples.append(example)
            else:
                warnings.append(
                    f"{reference_set}:{reference.line}: the captions of {episode} have no words between "
                    f"{timestamp(reference.start)} and {timestamp(reference.end)}: that clip is left out "
                    "of the few-shot examples"
                )
        found.append(examples)
    return _capped(found, tuning), warnings


def _transcript(
    episode: str, video_source: VideoSource, cache: Path, language: str, which: str, progress: Callable[[str], None]
) -> Transcript | None:
    """The episode's Transcript from its YouTube captions, from the cache when it was fetched before."""
    video = video_id(episode)
    assert video is not None
    folder = cache / video
    path = folder / f"transcript.{language}.json"
    if path.is_file():
        return _TRANSCRIPT.validate_json(path.read_bytes())
    progress(f"Fetching the captions of few-shot episode {which}")
    folder.mkdir(parents=True, exist_ok=True)
    if (track := video_source.fetch_captions(episode, language, folder)) is None:
        return None
    transcript = parse_json3((folder / track).read_bytes(), language)
    write_atomic(path, _TRANSCRIPT.dump_json(transcript))
    return transcript


def _example(reference: Reference, transcript: Transcript) -> Example | None:
    """The clip with the Words whose middle falls inside it, or None when there are none."""
    words = [w.text for w in transcript.words if reference.start <= (w.start + w.end) / 2 < reference.end]
    if not words:
        return None
    return Example(reference.episode, reference.start, reference.end, " ".join(reference.note.split()), " ".join(words))


def _capped(episodes: list[list[Example]], tuning: SelectionTuning) -> list[Example]:
    """At most fewshot_max_examples lasting at most fewshot_max_secs together, taken in turn from
    each episode: every episode's first clip, then every episode's second, and so on."""
    chosen: list[Example] = []
    total = 0.0
    turns = [example for turn in itertools.zip_longest(*episodes) for example in turn if example is not None]
    for example in turns:
        if len(chosen) == tuning.fewshot_max_examples:
            break
        if total + example.end - example.start <= tuning.fewshot_max_secs:
            chosen.append(example)
            total += example.end - example.start
    if len(chosen) < len(turns):
        logger.info(
            "Using %d of %d few-shot clips (%.0f s): the cap is %d clips and %g s",
            len(chosen), len(turns), total, tuning.fewshot_max_examples, tuning.fewshot_max_secs,
        )
    return chosen


def _clips(count: int) -> str:
    return "clip is" if count == 1 else f"{count} clips are"
