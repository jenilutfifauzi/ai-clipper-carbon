"""Run the pipeline without the UI: `python -m app.cli analyze <url>`, `reanalyze <job-id>` or
`retry <job-id>`. These wait in the foreground while the Job waits for Gemini's quota or for
Gemini to be less busy. `render <job-id> [<candidate-id> ...]` renders Clips.

`eval` measures Selection against the Reference Set, and `gate` checks an eval report against the gate.
"""

import argparse
import logging
import sys
from pathlib import Path

from app import fonts, looks
from app.candidates import Candidate
from app.clips import Clip
from app.config import Settings, load_settings
from app.evaluation import EvalError, evaluate, gate, gate_summary, latest_report, summary
from app.jobs import DEFAULT_LANGUAGE, JobConflict, JobNotFound, JobOptions, JobStatus, JobStore
from app.matte import MatteRunner, RvmMatter
from app.media import MEDIA_DIR, MediaStore
from app.model_download import MODELS_DIR
from app.person_model import PersonModel
from app.pipeline import Pipeline
from app.ports import real_ports
from app.profile import PROFILE_FILE, ProfileStore
from app.references import ReferenceSetError
from app.rendering import NothingToRender, Renders
from app.review import CandidateNotFound
from app.transcriber import WhisperTranscriber
from app.transcript import timestamp


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser("analyze", help="download a YouTube episode, build its Transcript, select Candidates")
    analyze.add_argument("url")
    analyze.add_argument("--language", default=DEFAULT_LANGUAGE, help=f"Transcript language (default {DEFAULT_LANGUAGE})")
    analyze.add_argument(
        "--transcribe-locally",
        action="store_true",
        help="ignore YouTube's captions and transcribe the whole episode with Whisper",
    )
    analyze.add_argument("--brief", help='what to look for in this episode, e.g. "find the funny moments"')
    reanalyze = commands.add_parser(
        "reanalyze",
        help="select Candidates again from an existing Job's Transcript, with its Brief and Channel Profile "
        "snapshot, replacing its Candidates except those edited, selected or added in review",
    )
    reanalyze.add_argument("job_id")
    retry = commands.add_parser(
        "retry",
        help="resume a Job that failed, was interrupted or is waiting for quota, from the stage it stopped in",
    )
    retry.add_argument("job_id")
    render = commands.add_parser(
        "render",
        help="render Clips of a Job's Candidates, one at a time, replacing their earlier Clips",
    )
    render.add_argument("job_id")
    render.add_argument("candidate_ids", nargs="*", help="the Candidates to render (default: those selected in review)")
    commands.add_parser(
        "eval", help="select Candidates for every eval episode of eval/references.yaml and write an eval report"
    )
    check = commands.add_parser("gate", help="check an eval report against the gate, once its postable counts are in")
    check.add_argument("report", nargs="?", type=Path, help="the report's folder (default: the newest report)")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    if args.command == "eval":
        return _evaluate(settings)
    if args.command == "gate":
        return _gate(args.report)

    fonts.use(settings.data_dir / fonts.IMPORTED_DIR)
    looks.use(settings.data_dir / looks.IMPORTED_DIR)
    media = MediaStore(settings.data_dir / MEDIA_DIR, settings.ffmpeg_bin, settings.ffprobe_bin)
    store = JobStore(settings.data_dir / "jobs", media.sizes)
    if args.command == "render":
        return _render(settings, store, args.job_id, args.candidate_ids or None)
    pipeline = Pipeline(store, real_ports(settings), settings)
    if args.command == "analyze":
        options = JobOptions(language=args.language, brief=args.brief, transcribe_locally=args.transcribe_locally)
        job = store.create(args.url, options, ProfileStore(settings.data_dir / PROFILE_FILE).load())
        print(f"Job {job.id} in {store.job_dir(job.id)}", flush=True)
    else:
        try:
            job = store.get(args.job_id)
        except JobNotFound:
            print(f"No Job {args.job_id} in {store.root}")
            return 1
        if args.command == "reanalyze" and store.load_transcript(job.id) is None:
            print(f"Job {job.id} has no Transcript yet")
            return 1
        if args.command == "retry" and job.status is JobStatus.REVIEW:
            print(f"Job {job.id} is in review: nothing to retry. `make reanalyze JOB={job.id}` selects Candidates again")
            return 1
    try:
        job = pipeline.run_until_done(
            job.id, waiting=lambda job: print(f"Waiting for {settings.llm_name}: {job.message}", flush=True)
        )
    except JobConflict as exc:
        print(exc)
        return 1

    print(f"Status: {job.status}")
    for warning in job.warnings:
        print(f"Warning ({warning.stage}): {warning.message}")
    if job.status is JobStatus.ERROR:
        print(f"Error while {job.stage}: {job.error}")
        return 1

    assert job.source is not None
    meta = job.source.metadata
    transcript = store.load_transcript(job.id)
    assert transcript is not None
    print(f"Source: {meta.duration:.1f} s, {meta.width}x{meta.height} {meta.codec} @ {meta.fps:g} fps")
    print(f"Transcript: {len(transcript.words)} words ({transcript.source}, {transcript.language})")
    print(f"First words: {' '.join(word.text for word in transcript.words[:20])}")

    if job.options.brief:
        print(f"Brief: {job.options.brief}")
    candidates = store.load_candidates(job.id) or []
    print(f"Candidates: {len(candidates)} (prompt {job.prompt_version})")
    for rank, candidate in enumerate(candidates, 1):
        span = f"{timestamp(candidate.start)}–{timestamp(candidate.end)}"
        score = "manual" if candidate.predicted_score is None else f"score {candidate.predicted_score}"
        print(f"{rank:2}. {span} ({candidate.end - candidate.start:.0f} s)  {score}  {candidate.title}")
        print(f"    Hook: {candidate.hook_text}")
    return 0


def _render(settings: Settings, store: JobStore, job_id: str, candidate_ids: list[str] | None) -> int:
    mattes = MatteRunner(PersonModel(settings.data_dir / MODELS_DIR), RvmMatter, settings.ffmpeg_bin)
    renders = Renders(store, settings, WhisperTranscriber(settings), mattes=mattes)
    try:
        renders.request(job_id, candidate_ids)
    except JobNotFound:
        print(f"No Job {job_id} in {store.root}")
        return 1
    except CandidateNotFound as exc:
        print(f"Job {job_id} has no Candidate {exc}")
        return 1
    except NothingToRender as exc:
        print(f"{exc}, or name Candidates: python -m app.cli render {job_id} <candidate-id> ...")
        return 1
    except JobConflict as exc:
        print(f"{exc}: Candidates can be rendered once it is in review")
        return 1

    failed = 0

    def rendered(clip: Clip, candidate: Candidate) -> None:
        nonlocal failed
        name = candidate.title or f"Candidate {candidate.id}"
        if clip.error or clip.output is None:
            failed += 1
            print(f"{candidate.id} failed: {clip.error}  ({name})", flush=True)
            return
        out = clip.output
        print(
            f"{candidate.id} {out.duration:.1f} s Clip in {out.render_secs:.1f} s with {out.encoder}, "
            f"{out.size_bytes / 1e6:.1f} MB: {store.job_dir(job_id) / out.video}  ({name})",
            flush=True,
        )

    try:
        renders.run(job_id, rendered)
    except JobConflict:
        print(f"The app is rendering Job {job_id}: it renders these Clips too")
        return 0
    return 1 if failed else 0


def _evaluate(settings: Settings) -> int:
    try:
        report, folder = evaluate(settings, real_ports(settings))
    except (EvalError, ReferenceSetError, JobConflict) as exc:
        print(exc)
        return 1
    print(summary(report, folder))
    return 0


def _gate(folder: Path | None) -> int:
    folder = folder or latest_report()
    if folder is None:
        print("No eval reports yet: run `make eval`")
        return 1
    try:
        result = gate(folder)
    except EvalError as exc:
        print(exc)
        return 1
    print(gate_summary(result, folder))
    return 0


if __name__ == "__main__":
    sys.exit(main())
