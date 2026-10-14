"""The Score and Detail prompts.

Adapted from openshorts' SCORE_PROMPT_TEMPLATE and DETAIL_PROMPT_TEMPLATE (gemini_worker.py, MIT
licence, see THIRD_PARTY_NOTICES.md). Kept: the 2-second test, full-range scoring, the
stands-alone and diversity rules, the hook playbook. Changed: the episodes are podcasts, mostly
Indonesian, read from automatic transcripts; the Detail pass reads the whole Transcript and is
asked for a target count; times are copied from the Transcript's labels, and each clip's opening
and closing words are quoted so that it can be cut inside a line; from v3 the transcript's lines are
sentences rather than caption or Whisper segments (see selection._Cutter.lines); the assessment fields
are in English for the reviewer; the JSON skeletons are gone, as the response schema constrains
the answer. Added: the Channel Profile and the Brief, in both passes so that a Brief can change the
shortlist (the Score pass gets the profile in short), few-shot examples in the Detail pass, and
in v3 the whole-sentence rule, a distinct `topic` per clip and spare clips; in v4 Emphasis in the
hook, a `hook_kicker`, and no emoji in either.
Each of these sections is left out when there is nothing to put in it.

Audio-signal mode (SELECTION_AUDIO_SIGNAL) sends the shortlisted Windows' audio with the Detail
request, each recording after an `audio_label`, and adds the AUDIO section, which asks the model to
hear laughter, tone, energy and pacing. A run with audio has the version `prompt_version(True)`,
PROMPT_VERSION with AUDIO_SUFFIX, so that its eval reports are kept apart from the text-only ones.

Bump PROMPT_VERSION whenever a template, the way it is filled, the response schemas in
app/llm.py, or a temperature, prompt limit or audio setting in SelectionTuning changes: eval
reports are kept per version.
"""

from collections.abc import Sequence
from typing import TYPE_CHECKING

from app.fewshot import Example
from app.profile import ChannelProfile
from app.transcript import timestamp

if TYPE_CHECKING:
    from app.selection import ScoredWindow, Window

PROMPT_VERSION = "v4"
# Added to PROMPT_VERSION for a run whose Detail request carried audio.
AUDIO_SUFFIX = "-audio"

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
- `reason`: at most 15 words, naming the moment itself, not the topic.{steering}

TRANSCRIPT_LANGUAGE: {language}
EPISODE_DURATION: {duration}
WINDOWS:
{windows}
"""

SCORE_PROFILE = """
- THE CHANNEL these clips are for, in short: {summary}
  Of two equally strong windows, the one that fits the channel scores higher.{avoid}"""
SCORE_AVOID = "\n  A window whose moment is something the channel avoids scores low."

SCORE_BRIEF = """
- THE BRIEF for this episode, from the channel's owner: "{brief}"
  It is a priority, not a filter. A window that fits it scores clearly higher than an equally
  strong one that doesn't, so that it reaches the next round; but every window is still scored on
  its own merits over the whole range, and filler does not become clippable by fitting the Brief."""

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

{steering}TIME CONTRACT — STRICT:
- `start` and `end` are times on the episode's timeline, written like the transcript's labels.
- `start` is the label of the line the clip's first word is in.
- `opening_words`: the clip's first 6 to 8 words, copied exactly as they are written in the
  transcript, misheard words included. The clip starts on the first of them, which may be in the
  middle of a line.
- `end` is the label of the first line AFTER the clip's last word.
  For example, a clip whose last word is in line [12:58] and whose next line is [13:02] has end
  "13:02".
- `closing_words`: the clip's last 6 to 8 words, copied exactly. The clip stops after the last of
  them, which may be in the middle of a line.
- Each clip lasts {min_secs:g} to {max_secs:g} seconds, from its opening words to its closing words.
  Check it: a clip more than a few seconds outside that range is thrown away. If a moment needs
  longer, start later or end at an earlier payoff.

CLIP RULES:
- Build each clip from one shortlisted window and give its id as `window_id`. Stay within the
  window, except to take in a setup or a payoff that spills over its edge.
- THE 2-SECOND RULE: the clip MUST open on its strongest moment. If the first 2 seconds would not
  stop a cold viewer from scrolling, move the start or skip the clip.
- WHOLE SENTENCES: transcript lines are not sentences; a line often starts in the middle of one
  and ends in the middle of the next. Read across the line breaks:
  - the opening words begin a sentence, never the tail of the sentence before it (in "...udah lama
    banget gitu ya pas umur dua puluh gue bangkrut total", a clip about going broke starts at
    "pas umur dua puluh", not at "udah lama banget");
  - the closing words end a sentence, after the payoff has been said in full: never stop in the
    middle of a sentence or a thought.
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
- SPARES: after those, add up to {spares} spare clips, the next-best moments, following every rule
  above: a clip may be rejected later (for overlapping or running on from another, or its
  length), and a spare takes its place. Give a spare only if you would publish it.
- DIVERSITY: `topic` names what the clip is about in 2 to 5 English words, and every clip's topic
  is different. Never return two clips that make the same point, tell the same story or land the
  same joke, even from different windows: keep the stronger one. Clips must not overlap, and two
  clips must not be back to back: one passage cut in two is one moment, so make it one clip, or
  keep its stronger half.

HOOK PLAYBOOK for `viral_hook_text`, the overlay shown over the clip's first 3 seconds:
- At most about 40 characters (it is shown on a few short lines), in TRANSCRIPT_LANGUAGE, in
  the speakers' own register (casual "gue/lo" if that is how they talk).
- EMPHASIS: wrap the 1 to 3 words that carry the hook (the claim, the number, the name) in
  asterisks, which show them in a highlight colour: "Gue pernah *rugi 500 juta*". Never more
  than one run of words in a short hook, never the whole hook.
- No emoji, in the hook or the kicker: they can't be drawn on the video.
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
- `hook_kicker`: a label of 1 or 2 words shown in a pill above the hook, at most 24 characters,
  in TRANSCRIPT_LANGUAGE: the clip's kind or its tease ("TERBONGKAR!", "FAKTA", "POV",
  "PLOT TWIST"). Leave it "" when no label adds anything; never repeat the hook's words.

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

DETAIL_PROFILE = """\
CHANNEL PROFILE, written by the channel's owner: the channel these clips are for. Prefer the
moments that fit it, and write the copy for its audience.{avoid}
{fields}"""
DETAIL_AVOID = "\nNever choose a moment built on something it says to avoid."

DETAIL_EXAMPLES = """\
EXAMPLES: clips the channel's owner posted from other episodes, each with the owner's note on why
it was chosen. Learn from them what this channel finds clip-worthy, then judge this episode's
moments on their own: never copy an example's content or wording.
{examples}"""
EXAMPLE = """\
<example duration="{duration:.0f} s">
Note: {note}
Transcript: {text}
</example>"""

DETAIL_BRIEF = """\
BRIEF for this episode, from the channel's owner: "{brief}"
It is a priority, not a filter: choose the moments that fit it first, then fill CLIP_COUNT with
the strongest other moments.{over_profile}"""
DETAIL_BRIEF_OVER_PROFILE = " Where it and the channel profile pull different ways, follow the Brief."

DETAIL_AUDIO = """\
AUDIO: before this prompt come recordings of the shortlisted windows, each introduced by its
window id and time range. They carry what the transcript can't: how things were said. Listen for
laughter (from the speakers or the room), the tone of voice, the energy, and the pacing, such as a
pause before a punchline or a burst of quick back-and-forth, and use them as signals: a moment
that makes the speakers laugh or lifts their energy is often the strongest clip, and one that reads
well but sounds flat is weaker than it looks. A window with no recording is judged on its
transcript alone. A recording's own clock starts at 0:00 at its window's start: always take `start`
and `end` from the transcript's labels, never from a recording."""
AUDIO_LABEL = "Audio of window {id} [{start}–{end}]:"

_PROFILE_FIELDS = (("niche", "Niche"), ("audience", "Audience"), ("clip_style", "Clip style"), ("avoid", "Avoid"))


def score_prompt(
    windows: Sequence["Window"],
    language: str,
    duration: float,
    min_secs: float,
    max_secs: float,
    profile: ChannelProfile,
    brief: str | None,
    profile_chars: int,
) -> str:
    """The Score prompt, with the profile's fields each cut to `profile_chars` characters."""
    blocks = "\n".join(
        f'<window id="{w.id}" start="{timestamp(w.start)}" end="{timestamp(w.end)}">\n{w.text}\n</window>'
        for w in windows
    )
    steering = ""
    if fields := _profile_fields(profile):
        summary = " ".join(f"{label}: {_sentence(_shortened(text, profile_chars))}" for label, text in fields)
        steering += SCORE_PROFILE.format(summary=summary, avoid=SCORE_AVOID if profile.avoid else "")
    if brief:
        steering += SCORE_BRIEF.format(brief=_flat(brief))
    return SCORE_TEMPLATE.format(
        language=_language(language),
        duration=timestamp(duration),
        min_secs=min_secs,
        max_secs=max_secs,
        windows=blocks,
        steering=steering,
    )


def detail_prompt(
    lines: Sequence[tuple[float, str]],
    language: str,
    shortlist: Sequence["ScoredWindow"],
    count: int,
    spares: int,
    duration: float,
    min_secs: float,
    max_secs: float,
    profile: ChannelProfile,
    brief: str | None,
    examples: Sequence[Example],
    audio: bool = False,
) -> str:
    """The Detail prompt: the whole Transcript as (start, text) lines, each labelled with
    `timestamp()`, then the AUDIO section when `audio` (recordings come with the request), the
    profile in full, the examples and the Brief."""
    transcript = "\n".join(f"[{timestamp(start)}] {text}" for start, text in lines)
    windows = "\n".join(
        f"- {w.id} [{timestamp(w.start)}–{timestamp(w.end)}] score {w.score}: {w.reason}"
        if w.score is not None
        else f"- {w.id} [{timestamp(w.start)}–{timestamp(w.end)}] not scored"
        for w in shortlist
    )
    sections = [DETAIL_AUDIO] if audio else []
    if fields := _profile_fields(profile):
        listed = "\n".join(f"- {label}: {_indented(text)}" for label, text in fields)
        sections.append(DETAIL_PROFILE.format(avoid=DETAIL_AVOID if profile.avoid else "", fields=listed))
    if examples:
        shown = "\n".join(EXAMPLE.format(duration=e.end - e.start, note=e.note, text=e.text) for e in examples)
        sections.append(DETAIL_EXAMPLES.format(examples=shown))
    if brief:
        over_profile = DETAIL_BRIEF_OVER_PROFILE if fields else ""
        sections.append(DETAIL_BRIEF.format(brief=_flat(brief), over_profile=over_profile))
    return DETAIL_TEMPLATE.format(
        language=_language(language),
        duration=timestamp(duration),
        min_secs=min_secs,
        max_secs=max_secs,
        count=count,
        spares=spares,
        transcript=transcript,
        windows=windows,
        steering="".join(f"{section}\n\n" for section in sections),
    )


def prompt_version(audio: bool) -> str:
    """The version of a run's prompts: with AUDIO_SUFFIX when its Detail request carried audio."""
    return PROMPT_VERSION + AUDIO_SUFFIX if audio else PROMPT_VERSION


def audio_label(window: "ScoredWindow") -> str:
    """The text that introduces a Window's recording in the Detail request."""
    return AUDIO_LABEL.format(id=window.id, start=timestamp(window.start), end=timestamp(window.end))


def _profile_fields(profile: ChannelProfile) -> list[tuple[str, str]]:
    """The (label, text) of each field that isn't empty."""
    return [(label, text) for name, label in _PROFILE_FIELDS if (text := getattr(profile, name))]


def _flat(text: str) -> str:
    return " ".join(text.split())


def _shortened(text: str, chars: int) -> str:
    """`text` on one line, cut at a word to at most `chars` characters and an ellipsis."""
    text = _flat(text)
    if len(text) <= chars:
        return text
    return text[: chars + 1].rsplit(" ", 1)[0][:chars].rstrip(" ,;:.") + "…"


def _sentence(text: str) -> str:
    return text if text[-1] in ".!?…" else f"{text}."


def _indented(text: str) -> str:
    """Text of several lines, its blank lines dropped and the others indented under a list item's first."""
    return "\n  ".join(line.strip() for line in text.splitlines() if line.strip())


def _language(code: str) -> str:
    name = _LANGUAGES.get(code.split("-")[0].lower())
    return f"{name} ({code})" if name else code
