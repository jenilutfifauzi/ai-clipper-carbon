"""Agent Threads (.scratch/agent-chat-ui/issues/04, ADR 0030): several chats per Candidate, each with
its own turns, the chat kept before Threads becoming the first. The store directly, then its routes on
the fake provider of test_agent_api_loop."""

import json
from datetime import UTC, datetime

import pytest

from app.agent.transcript_store import (
    NEW_TITLE,
    TranscriptTurn,
    append_turn,
    create_thread,
    delete_thread,
    legacy_transcript_path,
    list_threads,
    load_transcript,
    newest_thread,
    rename_thread,
    threads_dir,
)

from test_agent_api_loop import (  # noqa: F401  (fixtures)
    HOLD,
    agent_events,
    agent_url,
    answer,
    chat,
    job,
    send,
    served,
    until_finished,
)
from test_agent_sessions import wait_for_requests


def a_turn(turn_id: str, prompt: str) -> TranscriptTurn:
    return TranscriptTurn(id=turn_id, provider="deepseek", model=None, prompt=prompt, stop="end_turn", started_at=datetime.now(UTC))


def test_threads_are_made_listed_newest_first_renamed_and_deleted(tmp_path):
    assert list_threads(tmp_path, "cand") == []
    first = create_thread(tmp_path, "cand")
    second = create_thread(tmp_path, "cand")
    assert (first.title, second.title) == (NEW_TITLE, NEW_TITLE)
    assert [thread.id for thread in list_threads(tmp_path, "cand")] == [second.id, first.id]

    # A finished turn makes its Thread the newest.
    append_turn(tmp_path, "cand", first.id, a_turn("t1", "Hi"))
    assert [thread.id for thread in list_threads(tmp_path, "cand")] == [first.id, second.id]
    assert newest_thread(tmp_path, "cand").id == first.id

    renamed = rename_thread(tmp_path, "cand", second.id, "Captions")
    assert renamed.title == "Captions"
    assert {thread.id: thread.title for thread in list_threads(tmp_path, "cand")}[second.id] == "Captions"

    delete_thread(tmp_path, "cand", first.id)
    assert [thread.id for thread in list_threads(tmp_path, "cand")] == [second.id]
    assert not (threads_dir(tmp_path, "cand") / f"{first.id}.json").exists()
    with pytest.raises(LookupError):
        delete_thread(tmp_path, "cand", first.id)
    with pytest.raises(LookupError):
        rename_thread(tmp_path, "cand", "../../x", "No")

    # Without any, the newest is made.
    delete_thread(tmp_path, "cand", second.id)
    made = newest_thread(tmp_path, "cand")
    assert [thread.id for thread in list_threads(tmp_path, "cand")] == [made.id]


def test_a_threads_first_turn_titles_it_and_later_ones_dont(tmp_path):
    thread = create_thread(tmp_path, "cand")
    long = "Make   the captions bigger and yellow, then add a title over the first three seconds please"

    append_turn(tmp_path, "cand", thread.id, a_turn("t1", long))
    append_turn(tmp_path, "cand", thread.id, a_turn("t2", "And now?"))

    [titled] = list_threads(tmp_path, "cand")
    assert titled.title == "Make the captions bigger and yellow, then add a title over t"
    assert len(titled.title) == 60
    assert [turn.id for turn in load_transcript(tmp_path, "cand", thread.id)] == ["t1", "t2"]

    # A renamed Thread keeps its name.
    renamed = create_thread(tmp_path, "cand")
    rename_thread(tmp_path, "cand", renamed.id, "Mine")
    append_turn(tmp_path, "cand", renamed.id, a_turn("t3", "Hello"))
    assert {each.id: each.title for each in list_threads(tmp_path, "cand")}[renamed.id] == "Mine"


def test_the_chat_from_before_threads_becomes_the_first_thread(tmp_path):
    turns = [a_turn("t1", "Tighten the pauses"), a_turn("t2", "Thanks")]
    legacy = legacy_transcript_path(tmp_path, "cand")
    legacy.parent.mkdir(parents=True)
    legacy.write_text(json.dumps([turn.model_dump(mode="json") for turn in turns]))

    [thread] = list_threads(tmp_path, "cand")

    assert thread.title == "Tighten the pauses"
    assert [turn.id for turn in load_transcript(tmp_path, "cand", thread.id)] == ["t1", "t2"]
    # Moved, not copied; and not migrated again.
    assert not legacy.exists()
    assert [each.id for each in list_threads(tmp_path, "cand")] == [thread.id]


def test_the_routes_list_make_rename_and_delete_threads(served, chat, job):
    candidate = job["candidates"][0]
    url = f"{agent_url(job, candidate)}/threads"

    [first] = served.get(url).json()
    made = served.post(url)
    assert made.status_code == 201
    second = made.json()
    assert [thread["id"] for thread in served.get(url).json()] == [second["id"], first["id"]]

    renamed = served.patch(f"{url}/{second['id']}", json={"title": "  Captions "})
    assert renamed.status_code == 200 and renamed.json()["title"] == "Captions"
    assert served.patch(f"{url}/{second['id']}", json={"title": "  "}).status_code == 422
    assert served.patch(f"{url}/nope", json={"title": "x"}).status_code == 404
    assert served.get(f"{agent_url(job, candidate)}/transcript", params={"thread": "nope"}).status_code == 404

    assert served.delete(f"{url}/{first['id']}").status_code == 204
    assert served.delete(f"{url}/{first['id']}").status_code == 404
    assert served.delete(f"{url}/{second['id']}").status_code == 204
    # The last deleted, a fresh one is made on the next access.
    [fresh] = served.get(url).json()
    assert fresh["id"] not in (first["id"], second["id"])


def test_a_thread_cant_be_deleted_while_a_turn_runs_in_it(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [HOLD]
    [thread] = served.get(f"{agent_url(job, candidate)}/threads").json()
    stream = agent_events(served, job, candidate)
    next(stream)
    send(served, job, candidate, "Take your time")
    wait_for_requests(chat, 1)

    assert served.delete(f"{agent_url(job, candidate)}/threads/{thread['id']}").status_code == 409

    served.post(f"{agent_url(job, candidate)}/cancel", json={"tab": "tab-a"})
    until_finished(stream)
    assert served.delete(f"{agent_url(job, candidate)}/threads/{thread['id']}").status_code == 204


def test_each_thread_keeps_its_own_turns_and_history(served, chat, job):
    candidate = job["candidates"][0]
    base = agent_url(job, candidate)
    [first] = served.get(f"{base}/threads").json()
    stream = agent_events(served, job, candidate)
    next(stream)

    chat.replies = [answer("Hello there.")]
    # Without a thread: the newest.
    turn = send(served, job, candidate, "Hi").json()["turn"]
    started = until_finished(stream)[0][1]
    assert started["thread"] == first["id"]

    second = served.post(f"{base}/threads").json()
    chat.replies = [answer("Fresh.")]
    sent = served.post(f"{base}/turns", json={"provider": "deepseek", "prompt": "Start over", "tab": "tab-a", "thread": second["id"]})
    assert sent.status_code == 202
    assert until_finished(stream)[0][1]["thread"] == second["id"]

    # The second Thread's turn saw none of the first's.
    assert chat.requests[-1]["messages"][1:] == [{"role": "user", "content": "Start over"}]
    assert [kept["prompt"] for kept in served.get(f"{base}/transcript", params={"thread": first["id"]}).json()] == ["Hi"]
    assert [kept["prompt"] for kept in served.get(f"{base}/transcript", params={"thread": second["id"]}).json()] == ["Start over"]
    # Without a thread: the newest, now the second, titled from its prompt.
    assert [kept["prompt"] for kept in served.get(f"{base}/transcript").json()] == ["Start over"]
    assert [(thread["id"], thread["title"]) for thread in served.get(f"{base}/threads").json()] == [
        (second["id"], "Start over"),
        (first["id"], "Hi"),
    ]
    # A turn of a Thread other than the newest is still found to undo (it saved nothing: 409, not 404).
    assert served.post(f"{base}/turns/{turn}/revert").status_code == 409

    # Back in the first Thread, its own turns are the history.
    chat.replies = [answer("Again.")]
    served.post(f"{base}/turns", json={"provider": "deepseek", "prompt": "Again?", "tab": "tab-a", "thread": first["id"]})
    until_finished(stream)
    assert chat.requests[-1]["messages"][1:] == [
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": "Hello there."},
        {"role": "user", "content": "Again?"},
    ]
