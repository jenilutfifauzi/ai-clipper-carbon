"""A local HTTP server that honours Range, in place of a downloaded model's upstream release
(app/model_download.py): what it serves, what it was asked, and how it cuts or pauses an answer."""

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


@dataclass
class Served:
    """What the local server serves at its one path, and what it was asked."""

    body: bytes
    # Each request's Range header (None without one).
    ranges: list[str | None] = field(default_factory=list)
    # Close the connection after this many bytes of the next answer (then serve whole again).
    cut_at: int | None = None
    # Wait for `go` after this many bytes of each answer.
    pause_at: int | None = None
    go: threading.Event = field(default_factory=threading.Event)
    # Answer every request whole, as a server that doesn't take Range.
    ignore_range: bool = False


@contextmanager
def serve(body: bytes, path: str) -> Iterator[tuple[Served, str]]:
    """A local server for `body` at `path`, honouring Range; its state and its URL."""
    state = Served(body)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

        def do_GET(self) -> None:
            if self.path != path:
                self.send_error(404)
                return
            asked = self.headers.get("Range")
            state.ranges.append(asked)
            body, start = state.body, 0
            if asked and not state.ignore_range:
                start = int(asked.removeprefix("bytes=").removesuffix("-"))
                if start >= len(body):
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{len(body)}")
                    self.end_headers()
                    return
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{len(body) - 1}/{len(body)}")
            else:
                self.send_response(200)
            rest = body[start:]
            self.send_header("Content-Length", str(len(rest)))
            self.end_headers()
            cut, state.cut_at = state.cut_at, None
            if cut is not None:
                self.wfile.write(rest[:cut])
                self.wfile.flush()
                self.close_connection = True
                return
            if state.pause_at is not None:
                self.wfile.write(rest[: state.pause_at])
                self.wfile.flush()
                state.go.wait(10)
                rest = rest[state.pause_at :]
            self.wfile.write(rest)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield state, f"http://127.0.0.1:{server.server_port}{path}"
    finally:
        state.go.set()
        server.shutdown()
        server.server_close()
