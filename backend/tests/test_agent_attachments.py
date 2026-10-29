"""Agent Attachments (.scratch/agent-attachments/issues/01): what goes with an owner's message reaches
the Agent as context before the prompt, while the chat keeps the owner's own words and the
attachments' names. On the fake provider of test_agent_api_loop."""

import base64
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


# .scratch/agent-attachments/issues/02: another Candidate of the Job, as a style reference.


def test_a_referenced_candidate_goes_before_the_prompt_as_a_summary_of_its_edit(served, chat, job):
    candidate, other = job["candidates"]
    hook = "This is the hook of the clip whose style I like the most"
    assert served.patch(f"/api/jobs/{job['id']}/candidates/{other['id']}", json={"hook_text": hook, "hook_kicker": "WAIT"}).status_code == 200
    chat.replies = [answer("Matching it.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    sent = send(served, job, candidate, "Style it like that one", [{"kind": "candidate", "candidate_id": other["id"]}])
    assert sent.status_code == 202, sent.text
    started = until_finished(stream)[0][1]

    content = chat.requests[-1]["messages"][-1]["content"]
    name = "This is the hook of the clip whose style I like…"
    head, rest = content.split("\n", 1)
    assert head == f'<context kind="candidate" name="{name}">'
    body, prompt = rest.split("\n</context>\n\n")
    summary = json.loads(body)
    assert summary["id"] == other["id"]
    assert summary["hook_text"] == hook
    assert summary["hook_kicker"] == "WAIT"
    assert summary["canvas"] == {"width": 1080, "height": 1920}
    assert "word_edits" not in summary and "cue_edits" not in summary
    assert prompt == "Style it like that one"
    assert started["attachments"] == [{"kind": "candidate", "name": name, "id": None}]
    [kept] = served.get(f"{agent_url(job, candidate)}/transcript").json()
    assert kept["attachments"] == [{"kind": "candidate", "name": name, "id": None}]


def test_a_candidate_without_a_hook_is_named_by_its_id(served, chat, job):
    candidate, other = job["candidates"]
    assert served.patch(f"/api/jobs/{job['id']}/candidates/{other['id']}", json={"hook_text": ""}).status_code == 200
    chat.replies = [answer("Ok.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    sent = send(served, job, candidate, "Like that", [{"kind": "candidate", "candidate_id": other["id"]}])
    assert sent.status_code == 202, sent.text
    started = until_finished(stream)[0][1]

    assert started["attachments"] == [{"kind": "candidate", "name": other["id"], "id": None}]


def test_an_unknown_the_open_or_a_twice_referenced_candidate_is_refused(served, chat, job):
    candidate, other = job["candidates"]

    unknown = send(served, job, candidate, "Hi", [{"kind": "candidate", "candidate_id": "nope"}])
    itself = send(served, job, candidate, "Hi", [{"kind": "candidate", "candidate_id": candidate["id"]}])
    twice = send(served, job, candidate, "Hi", [{"kind": "candidate", "candidate_id": other["id"]}] * 2)

    assert [r.status_code for r in (unknown, itself, twice)] == [404, 400, 400]
    assert chat.requests == []


# .scratch/agent-attachments/issues/03: the Channel Profile, inlined.


def test_the_channel_profile_goes_before_the_prompt_as_the_profile_route_gives_it(served, chat, job):
    candidate = job["candidates"][0]
    profile = {"niche": "Finance podcasts", "audience": "First-time investors", "clip_style": "Calm, no shouting", "avoid": "Crypto hype"}
    assert served.put("/api/profile", json=profile).status_code == 200
    chat.replies = [answer("In your style.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    sent = send(served, job, candidate, "Edit it my way", [{"kind": "channel_profile"}])
    assert sent.status_code == 202, sent.text
    started = until_finished(stream)[0][1]

    content = chat.requests[-1]["messages"][-1]["content"]
    head, rest = content.split("\n", 1)
    assert head == '<context kind="channel_profile" name="Channel Profile">'
    body, prompt = rest.split("\n</context>\n\n")
    assert json.loads(body) == served.get("/api/profile").json() == profile
    assert prompt == "Edit it my way"
    assert started["attachments"] == [{"kind": "channel_profile", "name": "Channel Profile", "id": None}]
    [kept] = served.get(f"{agent_url(job, candidate)}/transcript").json()
    assert kept["attachments"] == [{"kind": "channel_profile", "name": "Channel Profile", "id": None}]


def test_the_channel_profile_goes_at_most_once(served, chat, job):
    candidate = job["candidates"][0]

    twice = send(served, job, candidate, "Hi", [{"kind": "channel_profile"}] * 2)

    assert twice.status_code == 400
    assert chat.requests == []


# .scratch/agent-attachments/issues/04: images the model sees.

# The first bytes of a PNG: the route serves what was sent, whatever it shows.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + bytes(range(32))
PNG = base64.b64encode(PNG_BYTES).decode()


def image(name: str = "shot.png", media_type: str = "image/png", data: str = PNG) -> dict:
    return {"kind": "image", "name": name, "media_type": media_type, "data": data}


def test_an_image_goes_to_the_model_with_the_prompt_and_is_kept_with_the_job(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("I see the caption.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    sent = send(served, job, candidate, "Fix this caption", [image()])
    assert sent.status_code == 202, sent.text
    started = until_finished(stream)[0][1]

    assert chat.requests[-1]["messages"][-1] == {
        "role": "user",
        "content": [
            {"type": "text", "text": "Fix this caption"},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{PNG}"}},
        ],
    }
    [attached] = started["attachments"]
    assert (attached["kind"], attached["name"]) == ("image", "shot.png")
    assert attached["id"]
    [kept] = served.get(f"{agent_url(job, candidate)}/transcript").json()
    assert kept["prompt"] == "Fix this caption"
    assert kept["attachments"] == [attached]
    shown = served.get(f"{agent_url(job, candidate)}/attachments/{attached['id']}")
    assert shown.status_code == 200
    assert shown.headers["content-type"] == "image/png"
    assert shown.content == PNG_BYTES


def test_an_image_goes_with_its_own_message_only(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Seen.")]
    stream = agent_events(served, job, candidate)
    next(stream)
    send(served, job, candidate, "Look", [image(), image("after.jpg", "image/jpeg")])
    until_finished(stream)

    chat.replies = [answer("Again.")]
    send(served, job, candidate, "Next")
    until_finished(stream)

    assert chat.requests[-1]["messages"][1:] == [
        {"role": "user", "content": "Look"},
        {"role": "assistant", "content": "Seen."},
        {"role": "user", "content": "Next"},
    ]


def test_an_image_of_another_type_over_5_mb_or_not_base64_is_refused(served, chat, job):
    candidate = job["candidates"][0]
    over = base64.b64encode(b"\0" * (5 * 1024 * 1024 + 1)).decode()

    svg = send(served, job, candidate, "Hi", [image("a.svg", "image/svg+xml")])
    too_big = send(served, job, candidate, "Hi", [image(data=over)])
    not_base64 = send(served, job, candidate, "Hi", [image(data="not base64!")])

    assert [r.status_code for r in (svg, too_big, not_base64)] == [422, 422, 422]
    assert chat.requests == []


def test_an_image_of_up_to_5_mb_is_accepted(served, chat, job):
    candidate = job["candidates"][0]
    chat.replies = [answer("Ok.")]
    stream = agent_events(served, job, candidate)
    next(stream)

    sent = send(served, job, candidate, "Hi", [image(data=base64.b64encode(b"\0" * 5 * 1024 * 1024).decode())])
    until_finished(stream)

    assert sent.status_code == 202, sent.text


def test_an_unknown_or_malformed_image_id_is_not_found(served, job):
    url = f"{agent_url(job, job['candidates'][0])}/attachments"

    assert served.get(f"{url}/0123456789abcdef").status_code == 404
    assert served.get(f"{url}/..%2F..%2Fjob.json").status_code == 404
    assert served.get(f"{url}/.png").status_code == 404
