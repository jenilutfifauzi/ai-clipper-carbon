"""The single-worker queue: submitted Jobs run one at a time on a background thread."""

import logging
import threading
from collections.abc import Callable
from queue import Queue

logger = logging.getLogger(__name__)


class Worker:
    def __init__(self, run: Callable[[str], object]) -> None:
        self._run = run
        self._queue: Queue[str | None] = Queue()
        self._stopping = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="job-worker", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def submit(self, job_id: str) -> None:
        self._queue.put(job_id)

    def stop(self, timeout: float = 5) -> None:
        """Stop after the running Job; Jobs still queued stay `queued`."""
        self._stopping.set()
        self._queue.put(None)
        self._thread.join(timeout)

    def _loop(self) -> None:
        while (job_id := self._queue.get()) is not None and not self._stopping.is_set():
            try:
                self._run(job_id)
            except Exception:
                logger.exception("Job %s failed outside its stages", job_id)
