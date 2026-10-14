"""The Evaluation Harness: Selection measured against the owner's eval references.

`evaluate` analyzes every eval episode of the Reference Set with the current prompts and Channel
Profile, without a Brief, through the Pipeline that every Job runs, so the Detail pass also gets
the few-shot examples from the same Reference Set's fewshot clips. It writes a report to
eval/reports/<prompt version>/<UTC time>/:
- report.md: the LLM, recall, the found and missed references, and each episode's top 5 Candidates
  with preview links, for the owner to judge;
- report.json: the same, for scripts;
- postable.yaml: where the owner writes how many of each episode's top 5 they would post.
With SELECTION_AUDIO_SIGNAL on, the report goes under the audio variant's version (see
prompts.prompt_version), records how many shortlisted Windows were heard, and is compared with the
best text-only report on the same Reference Set (see `comparison`).

`gate` reads a report and its postable counts back. The gate is recall of at least 60% and at
least 3 of the top 5 postable on every eval episode.
"""

import itertools
import logging
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import yaml
from pydantic import TypeAdapter, ValidationError

from app.candidates import Candidate
from app.config import REFERENCE_SET, REPO_ROOT, LlmChoice, Settings
from app.jobs import TRANSCRIPT_FILE, Job, JobOptions, JobStatus, JobStore
from app.pipeline import Pipeline
from app.ports import Ports
from app.profile import PROFILE_FILE, ChannelProfile, ProfileStore
from app.prompts import prompt_version
from app.references import EXAMPLE, Reference, load_reference_set, video_id
from app.selection import Selection
from app.storage import write_atomic
from app.transcript import TranscriptSource, timestamp

logger = logging.getLogger(__name__)

REPORTS_DIR = REPO_ROOT / "eval" / "reports"
REPORT_FILE = "report.md"
REPORT_JSON = "report.json"
POSTABLE_FILE = "postable.yaml"

# A reference is found when one Candidate covers at least this share of its duration.
FOUND_COVERAGE = 0.5
# How many of each episode's best Candidates the owner judges.
TOP = 5
GATE_RECALL = 0.6
GATE_POSTABLE = 3


@dataclass(frozen=True)
class Match:
    """The Candidate covering most of a reference."""

    # Its place in the ranking, 1 for the best.
    rank: int
    candidate_id: str
    start: float
    end: float
    # The share of the reference's duration it covers.
    coverage: float


@dataclass(frozen=True)
class WindowTrace:
    """The Window holding most of a reference. For a missed reference, a low score or no place on
    the shortlist points at the Score pass; a place on the shortlist points at the Detail pass."""

    id: str
    score: int | None
    shortlisted: bool


@dataclass(frozen=True)
class ReferenceResult:
    start: float
    end: float
    note: str
    # The reference's line in the Reference Set.
    line: int
    found: bool
    # None when no Candidate overlaps the reference.
    match: Match | None
    window: WindowTrace | None = None


@dataclass(frozen=True)
class EpisodeReport:
    url: str
    job_id: str
    # Whether the Job, with its Source and Transcript, existed before the run.
    reused: bool
    duration: float
    transcript_source: TranscriptSource
    found: int
    total: int
    recall: float
    references: list[ReferenceResult]
    # All of them, best first.
    candidates: list[Candidate]
    # How many few-shot examples the Detail pass was shown.
    examples: int
    # The Job's warnings, e.g. a few-shot episode left out for want of captions.
    warnings: list[str]
    # How many Windows were shortlisted, and of them how many the Detail pass heard the audio of
    # (None with audio-signal mode off); None in reports made before these were recorded.
    shortlisted: int | None = None
    audio_windows: int | None = None


@dataclass(frozen=True)
class EvalReport:
    prompt_version: str
    created_at: datetime
    reference_set: str
    # The Channel Profile every eval Job was analyzed with.
    profile: ChannelProfile
    found: int
    total: int
    recall: float
    episodes: list[EpisodeReport]
    # The LLM every eval Job was analyzed with; None in reports made before that was recorded.
    llm: LlmChoice | None = None
    # Whether audio-signal mode was on.
    audio_signal: bool = False


@dataclass(frozen=True)
class Gate:
    report: EvalReport
    # Per eval episode, the owner's count of postable Candidates in its top 5; None until judged.
    postable: dict[str, int | None]
    status: Literal["pass", "fail", "pending"]


class EvalError(RuntimeError):
    """No report can be made or read; the message says why."""


_REPORT = TypeAdapter(EvalReport)


def judge(references: Sequence[Reference], candidates: Sequence[Candidate]) -> list[ReferenceResult]:
    """Each reference with the Candidate covering most of it (ties to the better ranked). It is
    found when that one Candidate covers at least FOUND_COVERAGE of its duration; Candidates
    that only cover that much together don't find it."""
    results = []
    for reference in references:
        match = None
        for rank, candidate in enumerate(candidates, 1):
            covered = _overlap(reference.start, reference.end, candidate.start, candidate.end)
            coverage = round(covered / (reference.end - reference.start), 6)
            if covered > 0 and (match is None or coverage > match.coverage):
                match = Match(rank, candidate.id, candidate.start, candidate.end, coverage)
        found = match is not None and match.coverage >= FOUND_COVERAGE
        results.append(ReferenceResult(reference.start, reference.end, reference.note, reference.line, found, match))
    return results


def recall(results: Sequence[ReferenceResult]) -> float:
    """Found ÷ total."""
    return sum(result.found for result in results) / len(results) if results else 0.0


def evaluate(
    settings: Settings, ports: Ports, references: Path = REFERENCE_SET, reports_dir: Path = REPORTS_DIR
) -> tuple[EvalReport, Path]:
    """Analyze every eval episode with the current prompts and profile, write the report, and
    return it and its folder.

    An episode with a Job that has its Source and Transcript (see `transcribed_job`) is analyzed
    again from them, its profile snapshot replaced by the current profile; otherwise a new Job runs
    the whole pipeline. fewshot episodes are only read for their captions, as few-shot examples.
    The LLM's quota waits are slept through. Raises ReferenceSetError for an invalid Reference Set
    and EvalError when an episode fails.
    """
    if not references.is_file():
        raise EvalError(f"No Reference Set at {shown(references)}: copy {shown(EXAMPLE)} to it and list your past clips")
    reference_set = load_reference_set(references)
    if not (episodes := reference_set.episodes("eval")):
        raise EvalError(f"{shown(references)} has no eval references")

    created_at = datetime.now(UTC)
    store = JobStore(settings.data_dir / "jobs")
    pipeline = Pipeline(store, ports, replace(settings, reference_set=references))
    profile = ProfileStore(settings.data_dir / PROFILE_FILE).load()
    results = [_episode(store, pipeline, url, clips, references, profile) for url, clips in episodes.items()]
    found = sum(episode.found for episode in results)
    total = sum(episode.total for episode in results)
    audio = settings.selection_audio_signal
    report = EvalReport(
        prompt_version(audio), created_at, shown(references), profile, found, total, found / total, results,
        settings.llm, audio,
    )
    return report, _write(report, reports_dir)


def transcribed_job(store: JobStore, url: str, options: JobOptions) -> Job | None:
    """The newest Job of the episode at `url` (in any YouTube URL form) that has its Source and
    Transcript and selects the way `options` do: the same language, duration range and Brief."""
    video = video_id(url)
    for job in store.all():
        if (
            video is not None
            and video_id(job.url) == video
            and _selecting(job.options) == _selecting(options)
            and job.source is not None
            and (store.job_dir(job.id) / TRANSCRIPT_FILE).is_file()
        ):
            return job
    return None


def gate(folder: Path) -> Gate:
    """The gate status of the report in `folder`, from its recall and the owner's postable counts."""
    try:
        report = _REPORT.validate_json((folder / REPORT_JSON).read_bytes())
    except FileNotFoundError:
        raise EvalError(f"No eval report in {shown(folder)}") from None
    postable = _postable(folder / POSTABLE_FILE, report)
    judged = [count for count in postable.values() if count is not None]
    if report.recall < GATE_RECALL or any(count < GATE_POSTABLE for count in judged):
        status = "fail"
    elif len(judged) < len(postable):
        status = "pending"
    else:
        status = "pass"
    return Gate(report, postable, status)


def latest_report(reports_dir: Path = REPORTS_DIR) -> Path | None:
    """The folder of the newest report."""
    return max((path.parent for path in reports_dir.glob(f"*/*/{REPORT_JSON}")), key=lambda f: f.name, default=None)


def summary(report: EvalReport, folder: Path) -> str:
    """The run in a few lines, for the terminal."""
    lines = [
        f"Eval of prompt {report.prompt_version} with {report.llm}{', audio signal on' if report.audio_signal else ''}: "
        f"{len(report.episodes)} eval episodes, {report.total} references"
    ]
    for episode in report.episodes:
        how = "reused" if episode.reused else "new"
        lines.append(
            f"  {episode.url}  Job {episode.job_id} ({how}): "
            f"{episode.found} of {episode.total} found ({percent(episode.recall)}){_heard(episode, ', ')}"
        )
        lines += [
            f"    missed {span(result.start, result.end)} (line {result.line}): {_flat(result.note)}"
            for result in episode.references
            if not result.found
        ]
        lines += [f"    warning: {warning}" for warning in episode.warnings]
    lines.append(f"Recall: {percent(report.recall)} ({report.found} of {report.total}; the gate needs {percent(GATE_RECALL)})")
    if report.audio_signal:
        lines += ["Compared with text-only selection:", *(f"  {line}" for line in comparison(report, {}, folder.parent.parent))]
    lines += [
        f"Report: {shown(folder / REPORT_FILE)}",
        f"Next: write the postable counts in {shown(folder / POSTABLE_FILE)}, then run `make gate REPORT={shown(folder)}`",
    ]
    return "\n".join(lines)


def gate_summary(result: Gate, folder: Path) -> str:
    report = result.report
    met = {True: "met", False: "not met"}
    lines = [
        f"Eval report {shown(folder)} (prompt {report.prompt_version})",
        f"Recall: {percent(report.recall)}, needs {percent(GATE_RECALL)}: {met[report.recall >= GATE_RECALL]}",
    ]
    for url, count in result.postable.items():
        if count is None:
            lines.append(f"{url}: not judged yet")
        else:
            lines.append(f"{url}: {count} of the top {TOP} postable, needs {GATE_POSTABLE}: {met[count >= GATE_POSTABLE]}")
    lines.append({
        "pass": "Gate: passed",
        "fail": "Gate: failed",
        "pending": f"Gate: pending, until every episode has a count in {shown(folder / POSTABLE_FILE)}",
    }[result.status])
    if report.audio_signal:
        lines += ["Compared with text-only selection:", *(f"  {line}" for line in comparison(report, result.postable, folder.parent.parent))]
    return "\n".join(lines)


def best_text_only(reports_dir: Path, reference_set: str) -> tuple[Path, EvalReport, dict[str, int | None]] | None:
    """The folder, report and postable counts of the best text-only report (audio-signal mode off)
    on the same Reference Set in `reports_dir`: the highest recall, then the most Candidates judged
    postable, then the newest."""
    best = None
    for path in reports_dir.glob(f"*/*/{REPORT_JSON}"):
        try:
            report = _REPORT.validate_json(path.read_bytes())
        except (OSError, ValidationError):
            continue
        if report.audio_signal or report.reference_set != reference_set:
            continue
        try:
            postable = _postable(path.parent / POSTABLE_FILE, report)
        except EvalError:
            postable = {}
        key = (report.recall, sum(count for count in postable.values() if count is not None), report.created_at)
        if best is None or key > best[0]:
            best = (key, path.parent, report, postable)
    return None if best is None else best[1:]


def comparison(report: EvalReport, postable: dict[str, int | None], reports_dir: Path) -> list[str]:
    """An audio-signal report, with its postable counts, next to the best text-only report: the
    recall, and per episode the references found and the postable counts."""
    best = best_text_only(reports_dir, report.reference_set)
    if best is None:
        return [
            f"No text-only report on {report.reference_set} in {shown(reports_dir)} to compare with: "
            "run `make eval` with SELECTION_AUDIO_SIGNAL=false."
        ]
    folder, other, other_postable = best
    lines = [
        f"Best text-only report: {shown(folder)} (prompt {other.prompt_version}, {other.llm}), "
        "the highest recall, then the most postable",
        f"- Recall: {percent(other.recall)} ({other.found} of {other.total}) text-only, "
        f"{percent(report.recall)} ({report.found} of {report.total}) with audio",
    ]
    episodes = {episode.url: episode for episode in other.episodes}
    for episode in report.episodes:
        if (text_only := episodes.get(episode.url)) is None:
            lines.append(f"- {episode.url}: not in the text-only report")
            continue
        lines.append(
            f"- {episode.url}: found {text_only.found} of {text_only.total} text-only, "
            f"{episode.found} of {episode.total} with audio; postable {_count(other_postable.get(episode.url))} "
            f"text-only, {_count(postable.get(episode.url))} with audio"
        )
    return lines


def _count(count: int | None) -> str:
    return "not judged" if count is None else str(count)


def _heard(episode: EpisodeReport, separator: str) -> str:
    """How many shortlisted Windows the Detail pass heard, in audio-signal mode."""
    if episode.audio_windows is None:
        return ""
    return f"{separator}audio for {episode.audio_windows} of {episode.shortlisted} shortlisted Windows"


def markdown(report: EvalReport, folder: Path) -> str:
    lines = [
        f"# Eval report: prompt {report.prompt_version}",
        "",
        f"{report.created_at:%Y-%m-%d %H:%M} UTC · Reference Set `{report.reference_set}` · "
        f"{len(report.episodes)} eval episodes, {report.total} references",
        "",
        f"LLM: {report.llm}",
        "",
        *(
            [
                "Audio signal: on. The Detail pass also heard each shortlisted Window's audio "
                "(laughter, tone, energy, pacing).",
                "",
            ]
            if report.audio_signal
            else []
        ),
        f"**Recall: {percent(report.recall)}** ({report.found} of {report.total} references found; "
        f"the gate needs {percent(GATE_RECALL)}).",
        "",
        f"The gate also needs at least {GATE_POSTABLE} postable Candidates in each episode's top {TOP}. "
        f"Watch them below, write how many you would post in `{POSTABLE_FILE}` next to this report, "
        f"then run `make gate REPORT={shown(folder)}`.",
        "",
        f"Channel Profile: {_profile(report.profile)}",
        "",
        "| Episode | Job | Found | Recall |",
        "|---|---|---|---|",
        *(
            f"| {episode.url} | `{episode.job_id}` | {episode.found} of {episode.total} | {percent(episode.recall)} |"
            for episode in report.episodes
        ),
    ]
    if report.audio_signal:
        lines += ["", "## Compared with text-only selection", "", *comparison(report, {}, folder.parent.parent)]
    for episode in report.episodes:
        lines += _episode_markdown(episode)
    return "\n".join(lines) + "\n"


def percent(share: float) -> str:
    return f"{100 * share:.1f}%"


def span(start: float, end: float) -> str:
    return f"{timestamp(start)}–{timestamp(end)}"


def shown(path: Path) -> str:
    """`path`, relative to the repo root when it's inside it."""
    return str(path.relative_to(REPO_ROOT)) if path.is_relative_to(REPO_ROOT) else str(path)


def _episode(
    store: JobStore, pipeline: Pipeline, url: str, references: list[Reference], path: Path, profile: ChannelProfile
) -> EpisodeReport:
    options = JobOptions()
    job = transcribed_job(store, url, options)
    reused = job is not None
    if job is None:
        job = store.create(url, options, profile)
        logger.info("Eval: %s in a new Job %s", url, job.id)
    else:
        logger.info("Eval: %s from Job %s's Transcript", url, job.id)
        store.update(job.id, profile=profile)
    job = pipeline.run_until_done(job.id)
    if job.status is not JobStatus.REVIEW:
        raise EvalError(f"{url}: Job {job.id} stopped ({job.status}) while {job.stage}: {job.error}")

    assert job.source is not None
    duration = job.source.metadata.duration
    for reference in references:
        if reference.end > duration + 1:
            raise EvalError(
                f"{shown(path)}:{reference.line}: the clip ends at {timestamp(reference.end)}, "
                f"after the end of {url} ({timestamp(duration)})"
            )
    selection = store.load_selection(job.id)
    transcript = store.load_transcript(job.id)
    assert selection is not None and transcript is not None
    results = [
        replace(result, window=_window(result, selection)) for result in judge(references, selection.candidates)
    ]
    found = sum(result.found for result in results)
    return EpisodeReport(
        url, job.id, reused, duration, transcript.source, found, len(results), recall(results), results,
        selection.candidates, len(selection.examples), [warning.message for warning in job.warnings],
        len(selection.shortlist), len(selection.audio_windows) if selection.audio_signal else None,
    )


def _selecting(options: JobOptions) -> tuple:
    return options.language, options.min_secs, options.max_secs, options.brief


def _window(result: ReferenceResult, selection: Selection) -> WindowTrace | None:
    def covered(window) -> float:
        return _overlap(result.start, result.end, window.start, window.end)

    best = max(selection.windows, key=lambda w: (covered(w), -1 if w.score is None else w.score), default=None)
    if best is None or covered(best) == 0:
        return None
    return WindowTrace(best.id, best.score, best.id in selection.shortlist)


def _overlap(start: float, end: float, other_start: float, other_end: float) -> float:
    return max(0.0, min(end, other_end) - max(start, other_start))


def _write(report: EvalReport, reports_dir: Path) -> Path:
    """Write the report into a new folder, never over an earlier report."""
    base = reports_dir / report.prompt_version / f"{report.created_at:%Y-%m-%dT%H-%M-%SZ}"
    for n in itertools.count(1):
        folder = base if n == 1 else base.with_name(f"{base.name}-{n}")
        try:
            folder.mkdir(parents=True)
            break
        except FileExistsError:
            continue
    write_atomic(folder / REPORT_JSON, _REPORT.dump_json(report, indent=2))
    write_atomic(folder / REPORT_FILE, markdown(report, folder).encode())
    write_atomic(folder / POSTABLE_FILE, _postable_template(report, folder).encode())
    return folder


def _episode_markdown(episode: EpisodeReport) -> list[str]:
    reuse = "reused its Source and Transcript" if episode.reused else "new"
    source = "YouTube captions" if episode.transcript_source == "youtube" else "Whisper transcription"
    lines = [
        "",
        f"## {episode.url}",
        "",
        f"Job `{episode.job_id}` ({reuse}) · {timestamp(episode.duration)} · {source} · "
        f"{episode.examples} few-shot example{'' if episode.examples == 1 else 's'} · "
        f"{len(episode.candidates)} Candidates{_heard(episode, ' · ')}",
        "",
        *(f"- Warning: {_flat(warning)}" for warning in episode.warnings),
        *([""] if episode.warnings else []),
        f"### References: {episode.found} of {episode.total} found ({percent(episode.recall)})",
        "",
    ]
    for result in episode.references:
        if result.match is None:
            matched = "No Candidate overlaps it."
        else:
            match = result.match
            matched = f"Candidate #{match.rank} ({span(match.start, match.end)}) covers {percent(match.coverage)}."
        if not result.found and (window := result.window):
            score = "got no score" if window.score is None else f"scored {window.score}"
            matched += f" Its Window {window.id} {score} and was {'' if window.shortlisted else 'not '}shortlisted."
        lines.append(
            f"- **{'Found' if result.found else 'Missed'}** {_link(episode.url, result.start, result.end)} "
            f"(line {result.line}): {_flat(result.note)}. {matched}"
        )

    lines += ["", f"### Top {TOP} Candidates", ""]
    for rank, candidate in enumerate(episode.candidates[:TOP], 1):
        finds = [
            span(result.start, result.end)
            for result in episode.references
            if result.found and result.match and result.match.rank == rank
        ]
        lines += [
            f"{rank}. **{_flat(candidate.title)}**: {_link(episode.url, candidate.start, candidate.end)} "
            f"({candidate.end - candidate.start:.0f} s), score {candidate.predicted_score}"
            + (f", finds the reference at {', '.join(finds)}" if finds else ""),
            f"   - Hook: {_flat(candidate.hook_text)}",
            f"   - Reason: {_flat(candidate.reason)}",
        ]
    if not episode.candidates:
        lines.append("No Candidates.")
    return lines


def _link(url: str, start: float, end: float) -> str:
    """A Markdown link that plays the episode from `start`."""
    return f"[{span(start, end)}]({url}&t={int(start)}s)"


def _flat(text: str) -> str:
    return " ".join(text.split())


def _profile(profile: ChannelProfile) -> str:
    fields = {
        "niche": profile.niche, "audience": profile.audience, "clip style": profile.clip_style, "avoid": profile.avoid,
    }
    return "; ".join(f"{name}: {_flat(text)}" for name, text in fields.items() if text) or "empty"


def _postable_template(report: EvalReport, folder: Path) -> str:
    lines = [
        f"# Postable Candidates per eval episode, prompt {report.prompt_version} (recall {percent(report.recall)}).",
        f"# Watch each episode's top {TOP} in {REPORT_FILE} and write how many of them you would post.",
        f"# Then run: make gate REPORT={shown(folder)}",
        f"# The gate passes with recall of at least {percent(GATE_RECALL)} and at least {GATE_POSTABLE} "
        "postable on every episode.",
    ]
    lines += [f'"{episode.url}":   # 0 to {min(TOP, len(episode.candidates))}' for episode in report.episodes]
    return "\n".join(lines) + "\n"


def _postable(path: Path, report: EvalReport) -> dict[str, int | None]:
    try:
        counts = yaml.safe_load(path.read_text()) or {}
    except FileNotFoundError:
        counts = {}
    except yaml.YAMLError as exc:
        raise EvalError(f"{shown(path)} is not valid YAML: {exc}") from None
    if not isinstance(counts, dict):
        raise EvalError(f'{shown(path)}: expected one `"<episode URL>": <count>` line per episode')
    tops = {episode.url: min(TOP, len(episode.candidates)) for episode in report.episodes}
    for url, count in counts.items():
        if url not in tops:
            raise EvalError(f"{shown(path)}: {url} is not an eval episode of this report")
        if count is not None and (type(count) is not int or not 0 <= count <= tops[url]):
            raise EvalError(f"{shown(path)}: the count for {url} must be a whole number from 0 to {tops[url]}, not {count!r}")
    return {url: counts.get(url) for url in tops}
