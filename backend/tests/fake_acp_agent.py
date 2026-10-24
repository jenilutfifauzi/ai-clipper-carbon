"""A fake ACP agent for test_agent_acp.py: speaks newline-delimited JSON-RPC on stdio, keeps each
message it receives in the JSONL file FAKE_ACP_LOG, and answers each `session/prompt` with the next
turn of the JSON file FAKE_ACP_SCRIPT, a list of turns, each a list of actions:

- `{"update": {...}}` sends a `session/update` notification carrying it.
- `{"permission": {"toolCall": {...}, "options": [...]}}` asks `session/request_permission` and
  waits for the answer (kept in the log as a response).
- `{"hold": true}` waits for `session/cancel`, then ends the turn `cancelled`.
- `{"crash": true}` exits with status 3 in the middle of the turn.
- `{"stop": "<reason>"}` ends the turn; without one it ends `end_turn`.

Turns are counted across processes from the log, so a restarted agent goes on with the next one.
FAKE_ACP_REFUSE_SESSION, when set, is the error `session/new` is answered with; FAKE_ACP_NO_HTTP, when
set, leaves MCP over HTTP out of its capabilities."""

import itertools
import json
import os
import sys

LOG = os.environ["FAKE_ACP_LOG"]
SCRIPT = os.environ["FAKE_ACP_SCRIPT"]
SESSION = "fake-session"
AUTH_METHODS = [
    {"id": "api-key", "name": "API Key", "_meta": {"api-key": {"provider": "openai"}}},
    {"id": "chat-gpt", "name": "ChatGPT", "description": "Sign in in the browser"},
]
ids = itertools.count(1000)


def write(message: dict) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def receive() -> dict | None:
    line = sys.stdin.readline()
    if not line:
        return None
    message = json.loads(line)
    with open(LOG, "a") as log:
        log.write(json.dumps(message) + "\n")
    return message


def prompts_so_far() -> int:
    with open(LOG) as log:
        return sum(1 for line in log if json.loads(line).get("method") == "session/prompt")


def wait_for(predicate) -> dict:
    while (message := receive()) is not None:
        if predicate(message):
            return message
    sys.exit(0)


def run_turn(request: dict) -> None:
    with open(SCRIPT) as script:
        turns = json.load(script)
    actions = turns[prompts_so_far() - 1]
    stop = "end_turn"
    for action in actions:
        if "update" in action:
            write({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": SESSION, "update": action["update"]}})
        elif "permission" in action:
            asked = next(ids)
            write({"jsonrpc": "2.0", "id": asked, "method": "session/request_permission", "params": {"sessionId": SESSION, **action["permission"]}})
            wait_for(lambda message: message.get("id") == asked and "method" not in message)
        elif action.get("hold"):
            wait_for(lambda message: message.get("method") == "session/cancel")
            stop = "cancelled"
        elif action.get("crash"):
            sys.exit(3)
        elif "stop" in action:
            stop = action["stop"]
    write({"jsonrpc": "2.0", "id": request["id"], "result": {"stopReason": stop}})


def main() -> None:
    with open(LOG, "a") as log:
        log.write(json.dumps({"started": os.getpid(), "argv0": os.path.basename(sys.argv[0]), "args": sys.argv[1:]}) + "\n")
    refusal = os.environ.get("FAKE_ACP_REFUSE_SESSION")
    http = not os.environ.get("FAKE_ACP_NO_HTTP")
    while (message := receive()) is not None:
        method = message.get("method")
        if method == "initialize":
            result = {"protocolVersion": 1, "agentCapabilities": {"mcpCapabilities": {"http": http}}, "authMethods": AUTH_METHODS}
            write({"jsonrpc": "2.0", "id": message["id"], "result": result})
        elif method == "session/new" and refusal:
            write({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32000, "message": refusal}})
        elif method == "session/new":
            write({"jsonrpc": "2.0", "id": message["id"], "result": {"sessionId": SESSION}})
        elif method == "authenticate":
            write({"jsonrpc": "2.0", "id": message["id"], "result": {}})
        elif method == "session/prompt":
            run_turn(message)
        elif "id" in message and method is not None:
            write({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "Method not found"}})


if __name__ == "__main__":
    main()
