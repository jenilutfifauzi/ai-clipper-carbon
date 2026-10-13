"""The Score and Detail prompts.

Adapted from openshorts' SCORE_PROMPT_TEMPLATE and DETAIL_PROMPT_TEMPLATE (gemini_worker.py, MIT
licence, see THIRD_PARTY_NOTICES.md). Kept: the 2-second test, full-range scoring, the
stands-alone and diversity rules, the hook playbook. Changed: the episodes are podcasts, mostly
Indonesian, read from automatic transcripts; the Detail pass reads the whole Transcript and is
asked for a target count; times are copied from the Transcript's labels; the assessment fields
are in English for the reviewer; the JSON skeletons are gone, as the response schema constrains
the answer.

Bump PROMPT_VERSION whenever a template, the way it is filled, the response schemas in
app/llm.py, or a temperature in SelectionTuning changes: eval reports are kept per version.
"""

from collections.abc import Sequence
from typing import TYPE_CHECKING

from app.transcript import Transcript, timestamp

if TYPE_CHECKING:
    from app.selection import ScoredWindow, Window

PROMPT_VERSION = "v1"

_LANGUAGES = {"id": "Indonesian", "en": "English"}

SCORE_TEMPLATE = """\
You are a senior short-form video strategist.
RANK these windows of one podcast episode by how well the best {min_secs:g}–{max_secs:g} second
moment inside each would work as a standalone TikTok, Reels or Shorts clip.

The episode is a conversation in {language}; the speakers may switch into English. The text is
an automatic transcript: it may lack punctuation and capitals, and some words are misheard, so
read for meaning.

Rules:
- Score EVERY window in this batch: exactly one entry per window, with the id you were given.
  Do not drop the weak ones; say they are weak.
- `score` must be an integer from 0 to 100, and the ranking is what matters: use the whole range
  instead of clustering. Most windows of a normal episode are not clippable, so reserve 70+ for
  the ones that pass the test below, and put greetings, housekeeping, sponsor reads, outros,
  rambling transitions and low-signal filler under 30, even when the topic is interesting.
- THE 2-SECOND TEST is the main criterion: would the first 2 seconds of this moment force a cold
  viewer (no context) to keep watching? Windows whose moments only work with earlier context
  score low.
- Prefer windows with a strong hook, conflict, surprise, controversy, strong emotion, a joke that
  lands, a confession or personal story, novelty, big numbers, or a clear payoff.
- `reason`: at most 15 words, naming the moment itself, not the topic.

TRANSCRIPT_LANGUAGE: {language}
EPISODE_DURATION: {duration}
WINDOWS:
{windows}
"""

DETAIL_TEMPLATE = """\
You are a senior short-form video editor and viral copywriter. Below is the FULL transcript of one
podcast episode, then a shortlist of windows that a first pass scored as its most promising
moments. Choose the best short clips for TikTok, Instagram Reels and YouTube Shorts.

The episode is a conversation in {language}; the speakers may switch into English. The transcript
is automatic: it may lack punctuation and capitals, and some words are misheard. Read for meaning,
and never copy a misheard word into a title, hook or description. Each line starts with the time
it begins, as [m:ss], or [h:mm:ss] from the first hour on.

TRANSCRIPT_LANGUAGE: {language}
EPISODE_DURATION: {duration}
CLIP_DURATION: {min_secs:g}–{max_secs:g} seconds
CLIP_COUNT: {count}

FULL TRANSCRIPT:
{transcript}

SHORTLISTED WINDOWS (time range, first-pass score and reason; the score is a hint, not a verdict):
{windows}

TIME CONTRACT — STRICT:
- `start` and `end` are times on the episode's timeline, written like the transcript's labels.
- `start` is the label of the line the clip opens with.
- `end` is the label of the first line AFTER the clip: the clip stops where that line begins.
  For example, a clip whose last line is [12:58] and whose next line is [13:02] has end "13:02".
- To cut inside a line, estimate the time with one decimal instead, e.g. "12:36.5".
- Each clip lasts {min_secs:g} to {max_secs:g} seconds (end minus start).

CLIP RULES:
- Build each clip from one shortlisted window and give its id as `window_id`. Stay within the
  window, except to take in a setup or a payoff that spills over its edge.
- THE 2-SECOND RULE: the clip MUST open on its strongest moment. If the first 2 seconds would not
  stop a cold viewer from scrolling, move the start or skip the clip.
- Start slightly before the hook and end slightly after the payoff. Never cut in the middle of a
  sentence.
- No greetings, intros, outros, sponsor reads or housekeeping unless they are the hook.
- STANDS ALONE: the clip must make sense to someone who has seen nothing else. If it opens on a
  pronoun, on a filler such as "jadi", "nah", "terus" or "itu", or on an answer whose question
  was asked earlier, move the start back to where the idea begins, or skip it. A brilliant moment
  that needs the previous five minutes is not a clip. Fix this by moving the START earlier, never
  by cutting the ending short: a clip that loses its payoff to gain context has traded down.
- WHOLE EPISODE: you can read everything that was said, so use it. Catch a setup that sits
  earlier, a callback that pays off, a point the speakers make better somewhere else.
- HOW MANY: return {count} clips. Work through EVERY shortlisted window: they were already scored
  as the best moments of the episode, so a window that yields nothing should be the exception.
  Two clips from one window are fine when they are genuinely different moments. Return fewer only
  when the material truly does not hold {count}, and never pad with a clip you would not publish.
- DIVERSITY: never return two clips that make the same point, tell the same story or land the
  same joke, even from different windows: keep the stronger one. Clips must not overlap.

HOOK PLAYBOOK for `viral_hook_text`, the overlay shown over the clip's first 3 seconds:
- At most about 40 characters (it is shown on at most 2 short lines), in TRANSCRIPT_LANGUAGE, in
  the speakers' own register (casual "gue/lo" if that is how they talk).
- Pick the strongest fitting pattern:
  - Open question: "Kenapa semua orang salah soal ini?"
  - Hot take: "Berhenti lakuin ini. Serius."
  - Number shock: "97% orang nggak sadar ini"
  - Story loop: "Email ini hampir bikin gue bangkrut"
  - POV: "POV: akhirnya lo ngerti juga"
  (Indonesian examples of the patterns: always write the hook in TRANSCRIPT_LANGUAGE.)
- ABOUT THIS MOMENT, NOT THE EPISODE: name the concrete thing that happens in this clip: the
  claim, the number, the name, the confession. A line that could sit on any clip of this episode
  is wrong. If nothing concrete can be named, quote the clip's strongest phrase.

COPY RULES, all written in {language}:
- `title`: at most 100 characters, curiosity-driven, no claim the clip doesn't deliver. It is also
  the YouTube Shorts title.
- `tiktok_description`, `instagram_description`, `shorts_description`: 1–2 punchy sentences that
  tease the payoff without spoiling it, in each platform's tone. No hashtags in them.
- `hashtags`: 3 to 5 topically relevant hashtags, each starting with #. No generic hashtag spam.

ASSESSMENT, written in English for the editor who reviews the clips:
- `reason`: one sentence, at most 20 words, naming what makes THIS moment worth a clip: the
  specific hook, claim, number or payoff, not the topic.
- `emotion`: the main emotion a viewer feels, in 1–2 words (e.g. funny, shocking, inspiring,
  relatable, heartwarming, controversial).
- `hook_strength`: an integer from 0 to 100: how hard the first 2 seconds stop the scroll.
- `retention_notes`: at most 25 words on what keeps viewers watching to the end (an open loop,
  tension, escalation, where the payoff lands) and any weak spot.
- `predicted_score`: an honest 0–100 estimate of the clip's viral potential, using the whole range.

Return the clips best first.
"""


def score_prompt(
    windows: Sequence["Window"], language: str, duration: float, min_secs: float, max_secs: float
) -> str:
    blocks = "\n".join(
        f'<window id="{w.id}" start="{timestamp(w.start)}" end="{timestamp(w.end)}">\n{w.text}\n</window>'
        for w in windows
    )
    return SCORE_TEMPLATE.format(
        language=_language(language),
        duration=timestamp(duration),
        min_secs=min_secs,
        max_secs=max_secs,
        windows=blocks,
    )


def detail_prompt(
    transcript: Transcript,
    shortlist: Sequence["ScoredWindow"],
    count: int,
    duration: float,
    min_secs: float,
    max_secs: float,
) -> str:
    """The Detail prompt: the whole Transcript one line per Segment, labelled with `timestamp()`."""
    lines = "\n".join(f"[{timestamp(segment.start)}] {segment.text}" for segment in transcript.segments)
    windows = "\n".join(
        f"- {w.id} [{timestamp(w.start)}–{timestamp(w.end)}] score {w.score}: {w.reason}"
        if w.score is not None
        else f"- {w.id} [{timestamp(w.start)}–{timestamp(w.end)}] not scored"
        for w in shortlist
    )
    return DETAIL_TEMPLATE.format(
        language=_language(transcript.language),
        duration=timestamp(duration),
        min_secs=min_secs,
        max_secs=max_secs,
        count=count,
        transcript=lines,
        windows=windows,
    )


def _language(code: str) -> str:
    name = _LANGUAGES.get(code.split("-")[0].lower())
    return f"{name} ({code})" if name else code
