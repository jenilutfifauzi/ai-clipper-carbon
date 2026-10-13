"""The Evaluation Harness: the found rule and recall on a hand-built example, and eval runs with
fakes at the ports on the 62-minute episode from conftest."""

import json
import re
from dataclasses import replace

import pytest
import yaml

from app.candidates import Candidate, Descriptions
from app.config import LlmChoice
from app.evaluation import EvalError, evaluate, gate, judge, recall
from app.ports import Ports
from app.prompts import PROMPT_VERSION
from app.references import Reference, ReferenceSetError
from test_jobs_api import create_job
from test_selection import clip

A = "https://www.youtube.com/watch?v=AAAAAAAAAAA"
B = "https://www.youtube.com/watch?v=BBBBBBBBBBB"
C = "https://www.youtube.com/watch?v=CCCCCCCCCCC"

# The fake Detail pass proposes these clips for every episode. On the 62-minute episode they become
# Candidate #1 at 715.65–771.45, #2 at 1979.65–2039.45 and #3 at 2999.65–3059.45.
CLIPS = [
    clip("11:56", "12:52", 92),
    clip("33:00", "34:00", 80, title="Rahasia Sukses Cuma Satu"),
    clip("50:00", "51:00", 70),
]


def entry(url: str, start: str, end: str, note: str, role: str = "eval") -> str:
    """A Reference Set entry, five lines long."""
    return f'- url: {url}\n  start: "{start}"\n  end: "{end}"\n  note: {note}\n  role: {role}\n'


# Candidate #1 covers all of A_FOUND; Candidate #2 ends before A_MISSED starts and covers 29.45 s
# of B_FOUND's 40 s.
A_FOUND = entry(A, "12:00", "12:40", "rugi 500 juta")
B_FOUND = entry("https://youtu.be/BBBBBBBBBBB", "33:30", "34:10", "rahasia sukses")
A_MISSED = entry(f"{A}&t=2040s", "34:00", "35:00", "setelah klip kedua")
C_FEWSHOT = entry("https://youtu.be/CCCCCCCCCCC", "20:00", "20:45", "contoh few-shot", "fewshot")
REFERENCES = A_FOUND + B_FOUND + A_MISSED + C_FEWSHOT


def reference(start: float, end: float) -> Reference:
    return Reference(A, start, end, "catatan", "eval", 1)


def candidate(start: float, end: float) -> Candidate:
    return Candidate(
        id=f"c{start:g}", start=start, end=end, predicted_score=50, hook_strength=50, emotion="", reason="",
        retention_notes="", hook_text="", title="", descriptions=Descriptions("", "", ""), hashtags=[],
        window_id="w001", window_score=50,
    )


def test_a_reference_is_found_when_one_candidate_covers_at_least_half_of_it():
    # Every reference is 40 s long, so half is 20 s.
    references = [
        reference(100, 140),  # #1 covers 20.2 s: just above half
        reference(200, 240),  # #2 covers 19.8 s: just below
        reference(300, 340),  # #3 and #4 cover 15 s each: 30 s together, but neither covers half
        reference(400, 440),  # #5 covers exactly half
        reference(500, 540),  # #6 covers 30 s of this one...
        reference(540, 580),  # ...and 30 s of this one
        reference(600, 640),  # #6 ends where it starts
    ]
    candidates = [
        candidate(80, 120.2), candidate(220.2, 260), candidate(285, 315), candidate(325, 355),
        candidate(420, 470), candidate(510, 570),
    ]
    results = judge(references, candidates)

    assert [(r.found, r.match and (r.match.rank, r.match.candidate_id, r.match.coverage)) for r in results] == [
        (True, (1, "c80", 0.505)),
        (False, (2, "c220.2", 0.495)),
        (False, (3, "c285", 0.375)),
        (True, (5, "c420", 0.5)),
        (True, (6, "c510", 0.75)),
        (True, (6, "c510", 0.75)),
        (False, None),
    ]
    assert recall(results) == 4 / 7

    # A second episode without Candidates finds nothing; recall is found ÷ total over both.
    empty = judge([reference(10, 50)], [])
    assert [(r.found, r.match) for r in empty] == [(False, None)]
    assert recall(empty) == 0
    assert recall(results + empty) == 4 / 8


def test_eval_run_reuses_transcribed_jobs_takes_only_captions_from_fewshot_episodes_and_keeps_every_report(
    client, settings, video_source, transcriber, llm, from_episode, wait_for_status, tmp_path
):
    llm.clips = CLIPS
    # Episode A was analyzed before, from another form of its URL, with an empty Channel Profile.
    earlier = wait_for_status(create_job(client, url="https://youtu.be/AAAAAAAAAAA")["id"], "review")
    assert client.put("/api/profile", json={"niche": "Podcast bisnis"}).status_code == 200
    references = tmp_path / "eval-references.yaml"
    references.write_text(REFERENCES)
    ports = Ports(video_source, transcriber, llm)
    deepseek = replace(
        settings,
        llm_provider="openai",
        llm_base_url="https://api.deepseek.com",
        llm_model="deepseek-flash",
        llm_thinking=True,
    )

    report, folder = evaluate(deepseek, ports, references, tmp_path / "reports")

    # A's Source and Transcript are reused; B is fetched once; of C, only the captions are fetched.
    assert video_source.calls == [("https://youtu.be/AAAAAAAAAAA", "id"), (B, "id")]
    assert video_source.caption_calls == [(C, "id")]
    assert transcriber.calls == []
    assert len(llm.detail_requests) == 3
    # Both episodes are analyzed with the current profile and C's clip as a few-shot example; the
    # reused Job's profile snapshot is replaced by the current profile.
    assert all("- Niche: Podcast bisnis\n" in r.prompt and "Note: contoh few-shot\n" in r.prompt for r in llm.detail_requests[1:])
    assert client.get(f"/api/jobs/{earlier['id']}").json()["profile"]["niche"] == "Podcast bisnis"
    assert report.profile.niche == "Podcast bisnis"
    assert [(e.examples, e.warnings) for e in report.episodes] == [(1, []), (1, [])]
    assert [(e.url, e.job_id == earlier["id"], e.reused, e.found, e.total) for e in report.episodes] == [
        (A, True, True, 1, 2),
        (B, False, False, 1, 1),
    ]
    assert (report.prompt_version, report.found, report.total, report.recall) == (PROMPT_VERSION, 2, 3, 2 / 3)
    assert report.llm == LlmChoice("openai", "deepseek-flash", thinking=True)
    [found, missed] = report.episodes[0].references
    assert (found.found, found.match.rank, found.match.coverage) == (True, 1, 1.0)
    assert (missed.found, missed.match, missed.line) == (False, None, 11)
    assert report.episodes[1].references[0].match.coverage == round(29.45 / 40, 6)

    assert folder.parent == tmp_path / "reports" / PROMPT_VERSION
    saved = json.loads((folder / "report.json").read_text())
    assert (saved["prompt_version"], saved["recall"], len(saved["episodes"])) == (PROMPT_VERSION, 2 / 3, 2)
    assert saved["llm"] == {"provider": "openai", "model": "deepseek-flash", "thinking": True}
    assert [len(episode["candidates"]) for episode in saved["episodes"]] == [3, 3]

    text = (folder / "report.md").read_text()
    assert "**Recall: 66.7%** (2 of 3 references found" in text
    assert "\nLLM: openai deepseek-flash, thinking enabled\n" in text
    assert "\nChannel Profile: niche: Podcast bisnis\n" in text
    assert " · 1 few-shot example · 3 Candidates\n" in text
    assert f"- **Found** [12:00–12:40]({A}&t=720s) (line 1): rugi 500 juta. Candidate #1 (11:55–12:51) covers 100.0%." in text
    assert f"- **Missed** [34:00–35:00]({A}&t=2040s) (line 11): setelah klip kedua. No Candidate overlaps it." in text
    assert f"2. **Rahasia Sukses Cuma Satu**: [32:59–33:59]({B}&t=1979s) (60 s), score 80" in text
    assert "   - Hook: Ini yang nggak pernah dibahas" in text
    assert "   - Reason: A concrete confession lands in the first two seconds." in text

    assert yaml.safe_load((folder / "postable.yaml").read_text()) == {A: None, B: None}
    assert gate(folder).status == "pending"
    (folder / "postable.yaml").write_text(f'"{A}": 3\n"{B}": 2\n')
    assert gate(folder).status == "fail"
    (folder / "postable.yaml").write_text(f'"{A}": 3\n"{B}": 3\n')
    assert gate(folder).postable == {A: 3, B: 3}
    assert gate(folder).status == "pass"

    # A second run, with Gemini, reuses both Jobs and C's cached captions, and leaves the first report in place.
    again, second = evaluate(settings, ports, references, tmp_path / "reports")
    assert again.llm == LlmChoice("gemini", settings.gemini_model)
    assert len(video_source.calls) == 2
    assert len(video_source.caption_calls) == 1
    assert second != folder
    assert {path.name for path in folder.iterdir()} == {"report.md", "report.json", "postable.yaml"}


def test_gate_fails_below_60_percent_recall_however_many_are_postable(
    settings, video_source, transcriber, llm, from_episode, tmp_path
):
    llm.clips = CLIPS
    references = tmp_path / "references.yaml"
    references.write_text(A_FOUND + A_MISSED)
    report, folder = evaluate(settings, Ports(video_source, transcriber, llm), references, tmp_path / "reports")
    assert (report.found, report.total) == (1, 2)

    (folder / "postable.yaml").write_text(f'"{A}": 3\n')
    assert gate(folder).status == "fail"
    (folder / "postable.yaml").write_text(f'"{A}": 2\n"{B}": 3\n')
    with pytest.raises(EvalError, match=re.escape(f"{B} is not an eval episode of this report")):
        gate(folder)
    (folder / "postable.yaml").write_text(f'"{A}": 4\n')
    with pytest.raises(EvalError, match=re.escape(f"the count for {A} must be a whole number from 0 to 3, not 4")):
        gate(folder)


def test_eval_run_refuses_an_episode_listed_under_both_roles(settings, video_source, transcriber, llm, tmp_path):
    references = tmp_path / "references.yaml"
    references.write_text(A_FOUND + entry("https://youtu.be/AAAAAAAAAAA", "20:00", "20:45", "contoh", "fewshot"))

    with pytest.raises(ReferenceSetError, match="is a fewshot episode here and an eval episode on line 1"):
        evaluate(settings, Ports(video_source, transcriber, llm), references, tmp_path / "reports")
    assert video_source.calls == []
    assert not (tmp_path / "reports").exists()
