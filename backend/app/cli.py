"""Run the pipeline without the UI: `python -m app.cli analyze <url>`."""

import argparse
import logging
import sys

from app.config import load_settings
from app.jobs import DEFAULT_LANGUAGE, JobOptions, JobStatus, JobStore
from app.pipeline import Pipeline
from app.ports import real_ports


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    analyze = commands.add_parser("analyze", help="download a YouTube episode and build its Transcript")
    analyze.add_argument("url")
    analyze.add_argument("--language", default=DEFAULT_LANGUAGE, help=f"Transcript language (default {DEFAULT_LANGUAGE})")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = load_settings()
    store = JobStore(settings.data_dir / "jobs")
    job = store.create(args.url, JobOptions(language=args.language))
    print(f"Job {job.id} in {store.job_dir(job.id)}", flush=True)

    job = Pipeline(store, real_ports(settings)).run(job.id)
    print(f"Status: {job.status}")
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
