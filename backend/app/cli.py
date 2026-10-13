"""Run the pipeline without the UI: `python -m app.cli analyze <url>`, or `reanalyze <job-id>`."""

import argparse
import logging
import sys

from app.config import load_settings
from app.jobs import DEFAULT_LANGUAGE, JobNotFound, JobOptions, JobStatus, JobStore
from app.pipeline import Pipeline
from app.ports import real_ports
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
    reanalyze = commands.add_parser(
        "reanalyze", help="select Candidates again from an existing Job's Transcript, replacing its Candidates"
    )
    reanalyze.add_argument("job_id")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    store = JobStore(settings.data_dir / "jobs")
    pipeline = Pipeline(store, real_ports(settings), settings)
    if args.command == "analyze":
        job = store.create(args.url, JobOptions(language=args.language, transcribe_locally=args.transcribe_locally))
        print(f"Job {job.id} in {store.job_dir(job.id)}", flush=True)
        job = pipeline.run(job.id)
    else:
        try:
            store.get(args.job_id)
        except JobNotFound:
            print(f"No Job {args.job_id} in {store.root}")
            return 1
        if store.load_transcript(args.job_id) is None:
            print(f"Job {args.job_id} has no Transcript yet")
            return 1
        job = pipeline.run(args.job_id, start=JobStatus.ANALYZING)

    print(f"Status: {job.status}")
    for warning in job.warnings:
        print(f"Warning: {warning}")
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

    candidates = store.load_candidates(job.id) or []
    print(f"Candidates: {len(candidates)} (prompt {job.prompt_version})")
    for rank, candidate in enumerate(candidates, 1):
        span = f"{timestamp(candidate.start)}–{timestamp(candidate.end)}"
        print(f"{rank:2}. {span} ({candidate.end - candidate.start:.0f} s)  score {candidate.predicted_score}  {candidate.title}")
        print(f"    Hook: {candidate.hook_text}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
