"""Agent Attachments (.scratch/agent-attachments/issues/01): what goes with an owner's message reaches
the Agent as context before the prompt, while the chat keeps the owner's own words and the
attachments' names. On the fake provider of test_agent_api_loop."""

import json

from app.agent.transcript_store import load_transcript, newest_thread

from test_agent_api_loop import (  # noqa: F401  (fixtures)
    agent_events,
    agent_url,
    answer,
    chat,
    job,
    served,
    until_finished,
)


def send(client, job: dict, candidate: dict, prompt: str, attachments: list[dict] | None = None):
    body = {"provider": "deepseek", "prompt": prompt, "tab": "tab-a"}
    if attachments is not None:
        body["attachments"] = attachments
    return client.post(f"{agent_url(job, candidate)}/turns", json=body)


def test_a_text_file_goes_before_the_prompt_and_the_chat_keeps_its_name(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Following the brief.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    sent = send(served, job, candidate, "Edit it like the brief says", [{"kind": "text", "name": "brief.md", "text": "Short hooks only."}])
    started = until_finished(stream)[0][1]

    assert sent.status_code == 202, sent.text
    assert chat.requests[-1]["messages"][-1] == {
        "role": "user",
        "content": '<context kind="text" name="brief.md">\nShort hooks only.\n</context>\n\nEdit it like the brief says',
    }
    assert started["prompt"] == "Edit it like the brief says"
    assert started["attachments"] == [{"kind": "text", "name": "brief.md", "id": None}]
    [kept] = served.get(f"{agent_url(job, candidate)}/transcript").json()
    assert kept["prompt"] == "Edit it like the brief says"
    assert kept["attachments"] == [{"kind": "text", "name": "brief.md", "id": None}]


def test_the_history_holds_the_owners_words_without_the_files(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Done.")]
    stream = agent_events(served, job, candidate)
    next(stream)
    send(served, job, candidate, "First", [{"kind": "text", "name": "a.txt", "text": "Only this time."}])
    until_finished(stream)

    chat.replies = [answer("Again.")]
    send(served, job, candidate, "Second")
    until_finished(stream)

    assert chat.requests[-1]["messages"][1:] == [
        {"role": "user", "content": "First"},
        {"role": "assistant", "content": "Done."},
        {"role": "user", "content": "Second"},
    ]


def test_a_name_with_quotes_cant_break_out_of_its_context_block(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Ok.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    send(served, job, candidate, "Read it", [{"kind": "text", "name": 'a"b<c>.txt', "text": "x"}])
    until_finished(stream)

    assert chat.requests[-1]["messages"][-1]["content"].startswith('<context kind="text" name="a&quot;b&lt;c&gt;.txt">\n')


def test_too_many_attachments_or_too_big_a_text_file_is_refused(served, chat, job):
    candidate = job["candidates"][0]
    small = {"kind": "text", "name": "a.txt", "text": "x"}

    seven = send(served, job, candidate, "Hi", [small] * 7)
    too_big = send(served, job, candidate, "Hi", [{"kind": "text", "name": "big.txt", "text": "é" * 25_601}])
    unknown_kind = send(served, job, candidate, "Hi", [{"kind": "video", "name": "a.mp4"}])
    no_prompt = send(served, job, candidate, "", [small])

    assert [r.status_code for r in (seven, too_big, unknown_kind, no_prompt)] == [422, 422, 422, 422]
    assert chat.requests == []


def test_six_attachments_of_up_to_50_kb_each_are_accepted(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Ok.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    sent = send(served, job, candidate, "Hi", [{"kind": "text", "name": f"{n}.txt", "text": "x" * 50 * 1024} for n in range(6)])
    until_finished(stream)

    assert sent.status_code == 202, sent.text


def test_a_transcript_from_before_attachments_still_loads(tmp_path):
    thread = newest_thread(tmp_path, "cand")
    path = tmp_path / "agent" / "cand" / f"{thread.id}.json"
    path.write_text(json.dumps([{"id": "t1", "provider": "deepseek", "model": None, "prompt": "Hi", "stop": "end_turn", "started_at": "2026-01-01T00:00:00Z"}]))

    [loaded] = load_transcript(tmp_path, "cand", thread.id)

    assert loaded.attachments == []
