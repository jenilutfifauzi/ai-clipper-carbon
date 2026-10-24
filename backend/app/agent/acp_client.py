"""Our client of the Agent Client Protocol (version 1, agentclientprotocol.com): an ACP agent run as
a subprocess speaking JSON-RPC 2.0 over newline-delimited JSON on stdio.

`AcpConnection` is the transport: one reader task routes responses to the requests waiting on them,
notifications and the agent's own requests to their handlers. `AcpAgent` is one Agent Session's
agent: launched on its first turn, kept between turns, started afresh after it exits; its `run_turn`
is the session's driver. Its permission requests are answered without a dialog: allowed for the
scoped MCP server's tools, rejected for everything else."""

import asyncio
import itertools
import json
import logging
import os
import signal
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from pathlib import Path
from typing import Any

from app.agent.api_loop import tool_summary
from app.agent.driver import TurnContext
from app.agent.events import AgentEvent, Stop, TextDelta, ThoughtDelta, ToolFinished, ToolStarted, TurnFinished

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = 1
# The scoped MCP server's name as the agent knows it: its tools are `mcp__ai-clipper__<tool>`.
MCP_SERVER_NAME = "ai-clipper"
MCP_TOOL_PREFIX = f"mcp__{MCP_SERVER_NAME}__"
# A line of JSON may be long (a tool call's whole input); the default 64 KiB limit isn't enough.
LINE_LIMIT = 16 * 2**20
# How long a stopped turn waits for the agent to answer its prompt `cancelled`.
CANCEL_GRACE_SECS = 5.0
# How long a sign-in's agent is given to answer `initialize`, and the owner to finish signing in.
INITIALIZE_TIMEOUT_SECS = 30.0
LOGIN_TIMEOUT_SECS = 10 * 60.0
# How long a process is given to exit before it is killed.
EXIT_GRACE_SECS = 2.0
# Claude Code's built-in tools that touch the shell, files or the web: refused outright through the
# adapter's `_meta`, whatever the owner's own Claude Code settings allow.
CLAUDE_CODE_DISALLOWED = ["Bash", "BashOutput", "KillShell", "Edit", "MultiEdit", "Write", "NotebookEdit", "WebFetch", "WebSearch"]
# ACP's stop reasons as an Agent Turn's.
STOPS: dict[str, Stop] = {
    "end_turn": "end_turn",
    "max_tokens": "step_limit",
    "max_turn_requests": "step_limit",
    "refusal": "end_turn",
    "cancelled": "cancelled",
}

NotificationHandler = Callable[[str, dict[str, Any]], None]
RequestHandler = Callable[[str, dict[str, Any]], Awaitable[Any]]


class AcpError(Exception):
    """The agent answered a request with an error."""


class AcpExited(Exception):
    """The agent's process exited."""


class MethodNotFound(Exception):
    """A request from the agent this client doesn't serve (it claims no `fs` and no `terminal`)."""


class AcpConnection:
    """One agent process and the JSON-RPC spoken with it."""

    def __init__(self, process: asyncio.subprocess.Process, label: str, on_notification: NotificationHandler, on_request: RequestHandler) -> None:
        self._process = process
        self._label = label
        self._on_notification = on_notification
        self._on_request = on_request
        self._ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future] = {}
        self._reader = asyncio.create_task(self._read())
        self._stderr = asyncio.create_task(self._log_stderr())

    @classmethod
    async def start(
        cls, command: list[str], cwd: Path, label: str, on_notification: NotificationHandler, on_request: RequestHandler
    ) -> "AcpConnection":
        """Launch `command` (an argv list, no shell) in `cwd`, with this process's environment, so the
        CLI finds its own login."""
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=cwd,
            env=dict(os.environ),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=LINE_LIMIT,
            # A group of its own, so that closing it ends what it started too (npx's node, the CLI).
            start_new_session=True,
        )
        return cls(process, label, on_notification, on_request)

    @property
    def alive(self) -> bool:
        return self._process.returncode is None and not self._reader.done()

    async def request(self, method: str, params: dict[str, Any]) -> Any:
        if not self.alive:
            raise AcpExited(f"{self._label} isn't running")
        request_id = next(self._ids)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self._write({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            return await future
        finally:
            self._pending.pop(request_id, None)

    async def notify(self, method: str, params: dict[str, Any]) -> None:
        await self._write({"jsonrpc": "2.0", "method": method, "params": params})

    async def close(self) -> None:
        """End the process: asked to exit, then killed."""
        if self._process.returncode is None:
            self._signal(signal.SIGTERM)
            try:
                await asyncio.wait_for(self._process.wait(), EXIT_GRACE_SECS)
            except TimeoutError:
                self._signal(signal.SIGKILL)
                await self._process.wait()
        for task in (self._reader, self._stderr):
            task.cancel()
        await asyncio.gather(self._reader, self._stderr, return_exceptions=True)
        self._fail_pending()

    def _signal(self, number: signal.Signals) -> None:
        """Signal its process group, which it leads."""
        with suppress(ProcessLookupError, PermissionError):
            os.killpg(self._process.pid, number)

    async def _write(self, message: dict[str, Any]) -> None:
        stdin = self._process.stdin
        try:
            stdin.write((json.dumps(message) + "\n").encode())
            await stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as error:
            raise AcpExited(f"{self._label} stopped") from error

    async def _read(self) -> None:
        try:
            while line := await self._process.stdout.readline():
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    logger.warning("%s wrote a line that isn't JSON: %.200s", self._label, line)
                    continue
                self._route(message)
        finally:
            code = await self._process.wait()
            logger.info("%s exited with status %s", self._label, code)
            self._fail_pending(code)

    def _route(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        if method is None:
            future = self._pending.get(message.get("id"))
            if future is None or future.done():
                return
            if "error" in message:
                future.set_exception(AcpError(message["error"].get("message") or json.dumps(message["error"])))
                return
            future.set_result(message.get("result"))
            return
        if "id" not in message:
            self._on_notification(method, message.get("params") or {})
            return
        asyncio.create_task(self._answer(message["id"], method, message.get("params") or {}))

    async def _answer(self, request_id: Any, method: str, params: dict[str, Any]) -> None:
        try:
            reply = {"jsonrpc": "2.0", "id": request_id, "result": await self._on_request(method, params)}
        except MethodNotFound:
            reply = {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}
        except Exception as error:
            logger.exception("Answering %s's %s failed", self._label, method)
            reply = {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32603, "message": str(error)}}
        with suppress(AcpExited):
            await self._write(reply)

    async def _log_stderr(self) -> None:
        while line := await self._process.stderr.readline():
            logger.info("%s: %s", self._label, line.decode(errors="replace").rstrip())

    def _fail_pending(self, code: int | None = None) -> None:
        status = f" (exit status {code})" if code is not None else ""
        for future in self._pending.values():
            if not future.done():
                future.set_exception(AcpExited(f"{self._label} stopped{status}"))


def client_capabilities() -> dict[str, Any]:
    """No file system and no terminal: the agent reaches the Candidate through the scoped server only."""
    return {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False}


def scoped_server(url: str, headers: dict[str, str]) -> dict[str, Any]:
    return {"type": "http", "name": MCP_SERVER_NAME, "url": url, "headers": [{"name": name, "value": value} for name, value in headers.items()]}


def session_meta(provider_id: str) -> dict[str, Any] | None:
    """Claude Code's adapter passes `_meta.claudeCode.options` to the Agent SDK: the scoped server's
    tools allowed without asking, the shell, files and the web refused."""
    if provider_id != "claude-code":
        return None
    return {"claudeCode": {"options": {"allowedTools": [f"mcp__{MCP_SERVER_NAME}"], "disallowedTools": CLAUDE_CODE_DISALLOWED}}}


def login_method(auth_methods: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The sign-in `authenticate` is called with: the agent's first method that the agent runs itself
    (a browser sign-in), passing over API keys, gateways, and methods run in a terminal."""
    return next(
        (
            method
            for method in auth_methods
            if method.get("type", "agent") == "agent" and not {"api-key", "gateway"} & set(method.get("_meta") or {})
        ),
        None,
    )


def names_scoped_tool(*values: Any) -> bool:
    """Whether any of `values` (a title, a `_meta`) names one of the scoped server's tools."""
    return any(MCP_TOOL_PREFIX in text for value in values for text in _strings(value))


def permission_outcome(params: dict[str, Any], known: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """The answer to `session/request_permission`: an allow option for a scoped tool, else a reject
    option, else `cancelled`. `known` holds the turn's tool calls by id, whose title or `_meta` names
    the tool when the request carries its id only."""
    tool_call = params.get("toolCall") or {}
    earlier = known.get(tool_call.get("toolCallId"), {})
    is_scoped = names_scoped_tool(tool_call.get("title"), tool_call.get("_meta"), earlier.get("title"), earlier.get("_meta"))
    options = params.get("options") or []
    kinds = ("allow_once", "allow_always") if is_scoped else ("reject_once", "reject_always")
    chosen = next((option for kind in kinds for option in options if option.get("kind") == kind), None)
    if chosen is None:
        return {"outcome": {"outcome": "cancelled"}}
    return {"outcome": {"outcome": "selected", "optionId": chosen["optionId"]}}


def tool_name(update: dict[str, Any]) -> str:
    """A tool call's tool, without its `mcp__<server>__` prefix: Claude Code's adapter names it in
    `_meta.claudeCode.toolName`, others in the title."""
    meta = update.get("_meta") or {}
    name = (meta.get("claudeCode") or {}).get("toolName") or update.get("name") or update.get("title") or "tool"
    return name.split("__", 2)[-1] if name.startswith("mcp__") else name


async def start_login(command: list[str], cwd: Path, label: str) -> asyncio.Task:
    """Sign in to an agent: a short-lived client `initialize`s it and calls `authenticate` with its
    `login_method`, which opens the browser on this Mac. Returns once that is under way, with the
    task that waits for the owner to finish and then ends the process. Raises AcpError when the agent
    offers no such sign-in, AcpExited or TimeoutError when it doesn't answer."""
    cwd.mkdir(parents=True, exist_ok=True)
    connection = await AcpConnection.start(command, cwd, label, lambda method, params: None, _refuse)
    try:
        result = await asyncio.wait_for(
            connection.request("initialize", {"protocolVersion": PROTOCOL_VERSION, "clientCapabilities": client_capabilities()}),
            INITIALIZE_TIMEOUT_SECS,
        )
        method = login_method((result or {}).get("authMethods") or [])
        if method is None:
            raise AcpError(f"{label} offers no sign-in in the browser")
    except BaseException:
        await connection.close()
        raise

    async def finish() -> None:
        try:
            await asyncio.wait_for(connection.request("authenticate", {"methodId": method["id"]}), LOGIN_TIMEOUT_SECS)
            logger.info("Signed in to %s", label)
        except Exception as error:
            logger.warning("Signing in to %s didn't finish: %s", label, error)
        finally:
            await connection.close()

    return asyncio.create_task(finish())


async def _refuse(method: str, params: dict[str, Any]) -> Any:
    raise MethodNotFound(method)


class AcpAgent:
    """One Agent Session's ACP agent: one process, kept between its turns."""

    def __init__(self, provider_id: str, label: str, command: list[str], sandbox: Path) -> None:
        self.provider_id = provider_id
        self._label = label
        self._command = command
        self._sandbox = sandbox
        self._connection: AcpConnection | None = None
        self._session_id: str | None = None
        self._turn: str | None = None
        self._updates: asyncio.Queue[dict[str, Any] | None] | None = None
        self._tool_calls: dict[str, dict[str, Any]] = {}

    async def run_turn(self, context: TurnContext) -> AsyncIterator[AgentEvent]:
        """The session's driver: send the prompt (the system prompt in front of a new process's
        first), yield what the agent streams, end with its stop reason. Stopped, it sends
        `session/cancel`; a process that exits mid-turn fails the turn, and the next starts a new one."""
        is_new = await self._ensure_started(context)
        text = f"{context.system}\n\n{context.prompt}" if is_new else context.prompt
        updates: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self._turn, self._updates, self._tool_calls = context.turn, updates, {}
        params = {"sessionId": self._session_id, "prompt": [{"type": "text", "text": text}]}
        prompt = asyncio.ensure_future(self._connection.request("session/prompt", params))
        # Its answer follows every update the agent sent before it, so this ends the queue.
        prompt.add_done_callback(lambda _: updates.put_nowait(None))
        try:
            while (update := await updates.get()) is not None:
                for event in self._events(context.turn, update):
                    yield event
            result = prompt.result() or {}
        except asyncio.CancelledError:
            await self._cancel(prompt)
            raise
        finally:
            self._turn, self._updates = None, None
        yield TurnFinished(turn=context.turn, stop=STOPS.get(result.get("stopReason"), "end_turn"))

    async def close(self) -> None:
        if self._connection is not None:
            await self._connection.close()
        self._connection = None

    async def _ensure_started(self, context: TurnContext) -> bool:
        """Launch, `initialize` and open its ACP session unless it runs; True when it was launched now."""
        if self._connection is not None and self._connection.alive:
            return False
        await self.close()
        self._sandbox.mkdir(parents=True, exist_ok=True)
        self._connection = await AcpConnection.start(self._command, self._sandbox, self._label, self._notified, self._requested)
        await self._connection.request("initialize", {"protocolVersion": PROTOCOL_VERSION, "clientCapabilities": client_capabilities()})
        params: dict[str, Any] = {"cwd": str(self._sandbox), "mcpServers": [scoped_server(context.tools.url, context.tools.headers)]}
        if (meta := session_meta(self.provider_id)) is not None:
            params["_meta"] = meta
        result = await self._connection.request("session/new", params)
        self._session_id = result["sessionId"]
        return True

    async def _cancel(self, prompt: asyncio.Future) -> None:
        """Ask the agent to stop and give it a moment to answer the prompt `cancelled`."""
        if self._connection is None or not self._connection.alive:
            return
        with suppress(AcpExited):
            await self._connection.notify("session/cancel", {"sessionId": self._session_id})
        with suppress(Exception):
            await asyncio.wait_for(asyncio.shield(prompt), CANCEL_GRACE_SECS)

    def _notified(self, method: str, params: dict[str, Any]) -> None:
        if method == "session/update" and self._updates is not None and params.get("sessionId") == self._session_id:
            self._updates.put_nowait(params.get("update") or {})

    async def _requested(self, method: str, params: dict[str, Any]) -> Any:
        if method != "session/request_permission":
            raise MethodNotFound(method)
        if self._turn is None:
            return {"outcome": {"outcome": "cancelled"}}
        return permission_outcome(params, self._tool_calls)

    def _events(self, turn: str, update: dict[str, Any]) -> list[AgentEvent]:
        kind = update.get("sessionUpdate")
        if kind in ("agent_message_chunk", "agent_thought_chunk"):
            content = update.get("content")
            text = content.get("text") if isinstance(content, dict) else None
            if not text:
                return []
            return [TextDelta(turn=turn, delta=text) if kind == "agent_message_chunk" else ThoughtDelta(turn=turn, delta=text)]
        call = update.get("toolCallId")
        if kind == "tool_call" and call:
            self._tool_calls[call] = dict(update)
            name = tool_name(update)
            raw = update.get("rawInput")
            started = ToolStarted(turn=turn, call=call, tool=name, summary=tool_summary(name, raw) if isinstance(raw, dict) else "")
            return [started, *self._finished(turn, call, update)]
        if kind == "tool_call_update" and call:
            earlier = self._tool_calls.setdefault(call, {})
            if earlier.get("finished"):
                return []
            earlier.update({key: value for key, value in update.items() if key in ("title", "_meta")})
            return self._finished(turn, call, update)
        return []

    def _finished(self, turn: str, call: str, update: dict[str, Any]) -> list[AgentEvent]:
        status = update.get("status")
        if status not in ("completed", "failed"):
            return []
        self._tool_calls[call]["finished"] = True
        error = None if status == "completed" else _content_text(update.get("content")) or "The tool call failed"
        return [ToolFinished(turn=turn, call=call, ok=status == "completed", error=error)]


def _content_text(content: Any) -> str | None:
    """The text of a tool call's content blocks (`{type: "content", content: {type: "text", text}}`)."""
    texts = [
        block["content"]["text"]
        for block in content or []
        if isinstance(block, dict) and isinstance(block.get("content"), dict) and isinstance(block["content"].get("text"), str)
    ]
    return "\n".join(texts) or None


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for item in value.values() for text in _strings(item)]
    if isinstance(value, list):
        return [text for item in value for text in _strings(item)]
    return []
