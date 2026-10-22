"""The MCP server: AI Clipper's workflow as tools for an agent such as Claude Code, served at /mcp by
the app itself (streamable HTTP), in the same process as the API and its Worker.

A tool calls the API's route in this process, so the API's rules and messages are the tools': a
failed call is a tool error carrying the API's `detail`. Three tools call services directly, where no
route fits: `wait_for_job` follows the Job's changes as its events route does, `create_job_from_file`
stages a file on this Mac as an upload, `add_asset` gives one to the Logo or Media store (a font
it posts to the fonts route), and `generate_speech` follows the Narration it starts to its end as its
events route does.
"""

import asyncio
import dataclasses
import json
import logging
import types
from collections.abc import Callable
from contextlib import aclosing
from pathlib import Path
from typing import Annotated, Any, Literal, Union, get_args, get_origin, get_type_hints

import httpx
from anyio import to_thread
from fastapi import FastAPI
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import AwareDatetime, BaseModel, BeforeValidator, ConfigDict, Field, TypeAdapter, ValidationError, WithJsonSchema, create_model

from app.api import (
    PICTURES_ROUTE,
    SHAPES_MAX,
    CandidateUpdate,
    ExportPresetBody,
    PresetBody,
    TextPresetBody,
    TextPresetChange,
    no_framing_keys,
    no_old_overlays,
    no_old_segments,
    no_old_text_layers,
)
from app.candidates import (
    CUE_MAX_SCALE,
    CUE_MIN_SCALE,
    EXPOSURE_EV,
    KICKER_MAX_CHARS,
    SWITCHED_THICKNESS,
    TEMPERATURE_K,
    Adjust,
    AdjustmentLayer,
    Ease,
    Framing,
    Grade,
    LayoutOverride,
    MusicClip,
    Overlay,
    Segment,
    Shape,
    ShapeKind,
    ShapeStyle,
    TextLayer,
    TextStyle,
    CueEdit,
    Transition,
    WordEdit,
    ease_name,
)
from app.config import REPO_ROOT
from app.events import SETTLED, JobProgress, job_events
from app.jobs import Job, JobNotFound, JobOptions, JobStatus
from app.fonts import MAX_UPLOAD_BYTES as MAX_FONT_BYTES
from app.logos import MAX_UPLOAD_BYTES, BadLogo
from app.looks import MAX_UPLOAD_BYTES as MAX_LOOK_BYTES
from app.media import BadMedia, MediaItem
from app.narration import DEFAULT_PAUSE_SECS, DEFAULT_SPEED
from app.planner import Box, CueKey, Picture, ShapeEvent, TextEvent, bounds_at, key_times, picture_at
from app.profile import ChannelProfile
from app.rendering import source_copies
from app.retimed import CopySize, Retime
from app.segment_time import SegmentTime
from app.styles import LINE_LIMITS, StyleOverrides
from app.templates import Anchor, AnchorOverride, LayerKind
from app.transcript import Language
from app.uploads import UPLOADS_DIR, BadUpload, NotEnoughSpace, stage

GLOSSARY = REPO_ROOT / "GLOSSARY.md"
# The most of the Transcript one call returns: lines within this many seconds, and this many lines.
TRANSCRIPT_PAGE_SECS = 600
TRANSCRIPT_PAGE_LINES = 400
# How long `wait_for_job` waits by default, and at most, before it returns the Job as it is.
WAIT_SECS = 120
WAIT_MAX_SECS = 600
# How long `get_media_words` waits by default for a video's Media Words, and how often it looks.
MEDIA_WORDS_WAIT_SECS = 120
MEDIA_WORDS_POLL_SECS = 0.25
# How often merge_candidate_items and remove_candidate_items make their change again when another
# edit saves first.
STALE_RETRIES = 5
# Who makes the edits the tools save (ADR 0003): the editors send their own.
EDIT_SOURCE = {"X-Edit-Source": "agent"}
# The API's routes of each kind of asset.
ASSET_ROUTES = {"logo": "logos", "media": "media", "font": "fonts", "look": "looks"}
# The lists of a Candidate's items, which edit_candidate replaces whole and merge_candidate_items
# and remove_candidate_items change item by item: each list's item, and the field that identifies
# one within its Candidate (or the fields: a Word Edit's or Cue Edit's time and its timeline, None
# for the Source's).
ITEMS: dict[str, tuple[type, str | tuple[str, ...]]] = {
    "text_layers": (TextLayer, "id"), "shapes": (Shape, "id"), "music": (MusicClip, "id"), "overlays": (Overlay, "id"),
    "segments": (Segment, "id"), "transitions": (Transition, "after"), "word_edits": (WordEdit, ("at", "media")),
    "layout_overrides": (LayoutOverride, "at"), "cue_edits": (CueEdit, ("at", "media")),
    "adjustment_layers": (AdjustmentLayer, "id"),
}



def _line_limits(name: str) -> str:
    """The editor's Phrase or Sentence (styles.py's LINE_LIMITS), as the instructions name it."""
    limits = LINE_LIMITS[name]
    lines, words = limits["max_lines"], limits["max_words"]
    return (
        f"{lines} line{'' if lines == 1 else 's'}, {limits['max_chars']} characters, "
        f"{'no word limit' if words is None else f'{words} words'}, {limits['max_secs']:g} s, {limits['pause_secs']:g} s pause"
    )


INSTRUCTIONS = f"""\
AI Clipper turns a long video (a podcast episode) into vertical short Clips. Words are those of
GLOSSARY.md (resource ai-clipper://glossary): a Job is one Source video; its Candidates are proposed
clips; a Clip is a rendered Candidate (an MP4 on this Mac).

Workflow:
1. create_job_from_url (YouTube) or create_job_from_file (a path on this Mac).
2. wait_for_job until review (downloading and transcribing take minutes: call it again while
   `reached` is false). A Job in error says why; retry_job resumes it.
3. get_job lists the Candidates, best first, with why they were picked. get_transcript reads the
   Source by time range; add_candidate makes a Candidate of any range.
4. edit_candidate selects Candidates and changes their range, hook text, Kicker, Layout, Style
   Preset, Style Overrides and the rest. dry_run=true shows the Preview Plan (captions, hook, Words)
   without saving.
5. render_clips renders the selected Candidates; wait_for_job until review again; list_clips gives
   each Clip's video_path and its caption files (srt_path, vtt_path). get_captions gives a
   Candidate's SRT or VTT without a render.

Times:
- A Candidate's start and end, Segments, the Transcript and Words are Source time: seconds into the
  Source video. A Word Edit's `at` is any time within its Word on that Word's timeline: Source time,
  or with `media` (a video's id) seconds into that video, of its Media Words (the editor uses the
  Word's middle; the dry run lists each Word's `at` and `media`). One with `media` applies in every
  Segment showing that time of the video; a Source Word Edit never touches a video's Words, nor the
  other way round.
- Text Layers, Shapes, Music Clips, Overlays, Adjustment Layers, hook_start and the Preview Plan's events are
  Timeline time: seconds into the Clip, from 0.

Edits:
- Candidates can be changed only while the Job is in review or rendering.
- In edit_candidate, a list and style_overrides replace the Candidate's whole list (the lists:
  {", ".join(ITEMS)}). To add or change some items and keep the others, use
  merge_candidate_items; to drop some, remove_candidate_items.
- The hook is a line or two of text; *word* sets a word in Emphasis. The Kicker is at most
  {KICKER_MAX_CHARS} characters, above the hook.
- Removing or trimming Segments, or changing start/end, leaves Text Layers, Shapes, Music Clips,
  Overlays and the hook where they are in Timeline time, over other words now. The owner's editors
  move them with the cut while their Magnetic timeline is on; move them yourself when they should
  follow.
- Music, Overlays and Segments of other videos name Media Library items: add_asset adds a song,
  video or image from a file on this Mac, list_assets lists them.
- A style's font (captions, hook, Watermark, Text Layer) names a Face by its id: list_assets
  kind "fonts" lists them, with their family, weight, italic and licence. add_asset kind "font"
  imports a TTF, OTF or TTC file from this Mac for every Job (a variable font as a Face per named
  instance), with a warning when its licence says it may not be embedded.
- An Overlay is placed by its transform. x, y: its centre in output pixels (clamped to 0..1080,
  0..1920; the picture may go past the frame's edges). scale: times its fitted size, the largest that fits the
  1080x1920 frame keeping its aspect (1 fits; a 16:9 picture at 0.5 is 540 px wide). stretch_x,
  stretch_y: times its fitted width and height on top of scale. rotation: degrees clockwise. flip_h,
  flip_v, opacity 0..1. Its crop: left, top, right, bottom, each the fraction 0..0.9 of its
  width or height cut off before it is fitted (a tenth is always kept). merge_candidate_items
  changes only the transform and crop fields given. The dry run lists each Overlay's drawn box once
  turned (bounds) and what its crop keeps, in its item's pixels.
  A video Overlay's `speed` and `pitch` are as a Segment's (below), but it keeps its start and
  secs: it shows secs * speed of its video from its offset, within the video; with `reverse`, that
  backwards, as a Segment's (below). An image has none. The dry run gives what of its video it shows
  (source_start, source_end). A Music Clip's speed, pitch and reverse are the same (secs * speed of
  its song from offset); the dry run's `sounds` give what it reads.
  An Overlay comes on and goes off as a Text Layer does: animation_in and animation_out (none, fade,
  pop, slide) over animation_ms (100..2000, 300 by default; each end at most half its secs). They
  move its picture only: a video's sound keeps its volume and Keyframes. The dry run lists them.
- A Music Clip without `media` plays the episode's sound, anywhere in the Clip: its offset is
  Source time, its read within the Source, and source_volume scales it (`sounds` lists it, source true).
- A Text Layer is placed by its transform as an Overlay is: x, y its centre (on the frame; the text
  may go past its edges), scale (times its size: 2 draws it twice as large, its lines as they
  are), rotation and opacity. Its look is its style, a Text Style: font (a font id), size (as the
  captions', in output pixels), colour, stroke_width (output pixels, 0 for none) and stroke_colour,
  shadow (colour, opacity, blur and distance in output pixels, angle in degrees clockwise from the
  right: 45 falls down and right; off at opacity 0 or with no distance nor blur; a blur alone is a
  halo), plate (what is behind its lines: shape "none", "block" behind them all or "strips" behind
  each, colour, opacity, radius, padding_x and padding_y in output pixels), line_height (baselines
  apart, in sizes), tracking (output pixels after each character but a line's last, may be
  negative) and align (center, left, right). Its text is never set smaller: its lines break at
  newlines and between words at its wrap_width (px, plate padding included; 0: the frame less 48 px
  either side), a word too long between letters, and its box is at least fixed_height px tall (0:
  its words'), the words centred down it. It is never stretched or flipped. merge_candidate_items
  changes only the style, shadow, plate and transform fields given. The dry run lists each Text
  Layer's wrapped lines, its box once scaled and turned (bounds) and its picture: the URL, on this
  app, of the PNG the Clip burns. Emoji in a Text Layer are drawn in colour (Noto Color Emoji),
  each 1 em wide; the hook, the Kicker, the Watermark and captions leave emoji out.
- A Shape is a figure, placed, timed, animated and keyed as a Text Layer (never stretched or
  flipped). Its style: kind (rectangle, ellipse, triangle point up, parallelogram leaning right,
  trapezoid narrower at the top, line, arrow with its head at the right), width and height (output
  px before scale), fill (null: an outline alone), stroke_colour (#000000 by default) and
  stroke_width (px, 0 for none; drawn inside width and height), radius (a rectangle's corners,
  0..0.5 of its shorter side: 0.5 a pill) and shadow (a Text Style's). A line or an arrow is all
  stroke: width is its length, stroke_width its thickness (an arrow's head 4 times as tall),
  stroke_colour its colour; height and fill are unused. merge_candidate_items switching a figure
  with no stroke to a line or an arrow gives it a stroke {SWITCHED_THICKNESS} px thick in its fill's colour,
  where the merge doesn't set them. Refused: nothing to draw (no fill and no stroke; a line or
  arrow with no stroke_width).
  Shapes are drawn over the captions and under the Text Layers (a plate behind a title).
  merge_candidate_items changes only the style, shadow and transform fields given. The dry run
  lists each Shape's box (bounds) and picture.
- A Text Preset is a named Text Style a new Text Layer copies, never linked to it: list_presets,
  save_preset and delete_preset with kind "text"; built-in ones can't change. One is used for new
  titles (save_preset's use_for_new_titles): a new Text Layer given without a style, or without some
  of its fields, takes that Preset's.
- A Template is a Candidate's layers (Text Layers, Shapes, Music Clips of Media Library items,
  Overlays and Adjustment Layers), its intro and outro (the media Segments before its first Segment
  of the episode and after its last, with the Transitions at their joins and their videos' Word
  Edits and Cue Edits) and its hook's place, saved for reuse: list_presets (with intro_secs and
  outro_secs), save_preset and delete_preset with kind "template". The Candidate's own Segments are
  its Main Slot, never saved: media Segments between them are left out, and a Candidate with no
  Segment of the episode can't be saved. save_preset's preset is {{name, job_id, candidate_id,
  anchors?}}; with preset_id it saves over that Template, keeping its id, or with {{name}} alone
  renames it. apply_template copies it onto Candidates, never linked: changing or deleting the
  Template later leaves them as they are. Applying it puts the intro before each Candidate's own
  Segments and the outro after them (the joins between its own Segments keep their Transitions),
  moves the Candidate's own layers and hook by as much as its Segments' start moved, and puts the
  hook at the Template's distance from that start. Each layer keeps its place by its Anchor: each of
  its edges keeps its distance (offset) from the Clip's start or end, or the Main Slot's
  (clip_start, main_start, main_end, clip_end), guessed from the nearest; one wholly on the intro or
  outro stays on it. An anchors entry {{kind (its list: text_layers...), id, anchor}} sets one:
  start (both edges from the start: a lower-third), end (both from the end: a call to action) or
  span (one from each, stretched with the Clip: a music bed). One past a shorter Clip's end is cut
  short or left out, and the result says so. What a Template puts on a Candidate is a Template item,
  its `template` the Template's id (get_candidate's template_items names it): applying a Template
  again, the same or another, replaces the Template items, even those changed by hand (the notices
  count them), and keeps the rest; template_id null ("No Template") takes them off. Removing one by
  hand (remove_candidate_items) is fine; only applying again brings it back.
- The caption and hook styles' shadow is a Text Style's; a Style Override of it sets the fields it
  names ({{"shadow": {{"blur": 8}}}}). The hook's box (block or strips) and the caption highlight box
  have padding_x and padding_y, the highlight box radius too, in output pixels at the style's size;
  null is the default.
- The captions are shown in Cues of up to the caption style's max_lines lines (1..3), each line of
  at most max_chars characters and max_words Words, its lines balanced; a Cue lasts at most max_secs
  and ends at a pause of pause_secs or a sentence's end. A Word Edit's break_before starts a line,
  and a Cue when the Cue has all its lines. The editor's Phrase is {_line_limits("phrase")};
  its Sentence {_line_limits("sentence")}.
- The dry run's `captions` are the Cues: start and end (Timeline time), `lines` as shown, `plain`
  (the Words as written, with the Word Edits), `key` (the {{at, media}} a Cue Edit of it names),
  `edited` when a Cue Edit applies, `joinable` (whether it fits merged into the Cue before),
  `needs_join` when merging it takes a `join` (below), `centre` and `size`.
- A Cue Edit (cue_edits) changes one Cue. It is keyed as a Word Edit: `at`, any time within the
  Cue's first Word on its timeline, with `media` for a video's (the Cue's `key`), and that Word then
  always starts a Cue. `shift` moves the Cue and its highlight; `start_delta` and `end_delta` move
  only its start or its end (negative: earlier). All are -10..10 seconds of that timeline, so a
  Segment at 2x halves them.
  The Cue is kept in its Segment, after the Cue before ends and before the Cue after starts, and
  0.2 s long at least. Its `x` and `y` (output pixels, as the caption style's custom position)
  centre that Cue alone, kept in the frame, and `scale` ({CUE_MIN_SCALE}..{CUE_MAX_SCALE}) times the
  caption style's size sizes it (a line too wide is still set smaller); null keeps the style's. The
  dry run gives each Cue's `centre` and `size`. One whose Word the Clip doesn't show does nothing and is kept: the dry run
  lists it under `unused_cue_edits`, and a Cue it applies to says `edited`.
  Instead, a Cue Edit with `join` (and no other field) keeps its Word in the Cue before, where only
  a pause, a sentence's end or max_secs would part them; the line limits still do. It keeps only
  its Word: the Words after it still break at max_secs from the Cue's first. To merge a Cue
  into the one before: remove its own Cue Edit and its first Word's break_before, and add a join
  when the dry run's Cue says `needs_join`; only a `joinable` Cue fits. To split a Cue, add a Cue
  Edit with no field at the Word that should start the new one.
  merge_candidate_items changes only the fields given; remove_candidate_items takes its `at`
  ({{at, media}} for a video's).
- A Segment of a video needs its framing: a transform and a crop as an Overlay's, and a background
  shown where it doesn't cover the frame ({{"kind": "blur"}}, itself blurred, or {{"kind": "colour",
  "colour": "#rrggbb"}}). Its scale 1 fits the frame; filling it takes a larger one (16:9: 3.16). A
  Segment of the episode has no framing.
- A Segment of a video with sound is captioned from its video's Media Words (the whole video
  transcribed once, in the video's own language if set, else the Job's), unless its `captions` (its
  Captions switch) is false: then it has no captions and its video isn't transcribed for it. null
  means on. A Segment of the episode has no `captions`. Media Words are transcribed when a
  Candidate showing the video is prepared or rendered, or by get_media_words, which queues them,
  waits and gives them. set_media_language sets a video's language (null: the Job's); Words in
  other languages are kept. The dry run gives each Segment's `words_status`: clip or transcript (the
  episode's), media (ready), pending (no Cues yet: get_captions is refused meanwhile), failed (with
  `words_error`; get_media_words retries), off (its Captions switch) or none (not queued, silent,
  reversed, a Freeze frame or captions off).
- A Segment plays its range at its `speed`, 0.0625..16 (1 by default; 2 is twice as fast): it
  lasts (end - start) / speed in the Clip, `start` and `end` staying Source time (a video's: seconds
  into it). Its sound keeps its pitch; with `pitch` true it rises and falls with the speed instead,
  as tape. One of the episode keeps its ends on Words, its captions retimed with its speech; Word
  Edits and Layout Overrides stay keyed by Source time. A video's lasts 0.1 s at least in the Clip,
  and the Clip the longest clip at most. A Speed change moves the Segments after it, not the
  layers: the dry run lists each Segment's span in the Clip (`segments`).
  A video's Keyframes stay in seconds from its start, so a Speed that leaves one past its new end is
  refused: send its keys too, each `at` times old / new speed to keep the motion on the same frames.
  With `reverse` true it plays its range backwards (then at its speed): its first frame in the Clip
  is the one at `end`. It plays from a reversed copy of its range, which the render makes if the
  owner's preview hasn't (the dry run's `copy`). One of the episode has no captions; its Scenes and
  Layout Overrides are the forward ones, mirrored.
- A Segment's sound (the episode's or a video's) fades in over `fade_in` seconds from its start and
  out over `fade_out` to its end, linearly, 0..10 each (0 by default), as a Music Clip's: together
  longer than the Segment, both shrink in proportion. They count from where it starts in the Clip,
  a Transition's overlap included, and multiply the crossfade. A Freeze frame has none. The dry run
  lists them under `segments`.
- `audio_effects` on a Segment (of the episode or a video), a Music Clip or a video Overlay is its
  sound's ordered stack of Audio Effects, each {{id, params, enabled}}: id from
  list_assets kind "audio_effects" (with each setting's range and default), params a setting's key to
  its value (one left out takes its default), enabled false to keep it in the stack unheard. Order is heard: they
  run in turn after the item's Speed and Reverse and before its volume, Keyframes, duck and fades
  (a Segment's under a Transition before the crossfade), and each is cut at the item's end (an
  echo's tail too; fade it out to soften that), so its length never changes. The Clip's final
  loudness still runs on the whole mix. An unknown id or setting or a value out of range is
  refused; a Freeze frame and an image Overlay have none. merge_candidate_items replaces an item's
  stack as a whole. The dry run lists each sound's enabled ones under `segments` and `sounds`.
  The group "Clean" holds the editor's three switches, ordinary entries otherwise: "denoise"
  (Reduce noise, strength) and "enhance-voice" (Enhance voice, amount), which the editor puts at
  the top of the stack, to clean before anything colours the sound; and "normalize" (Normalize
  loudness, target -30..-12 LUFS, -23 by default), which it puts at the bottom. Normalize measures
  the item's sound up to its place in the stack, then applies one steady gain to the target (none
  to a silent item) with its true peak held under -1.5 dBTP: it never pumps, and an entry after it
  changes the level again.
- A Segment's `grade` (of the episode or a video) colours its whole frame (panels, picture and
  Background), before the joins, so a Transition blends two graded pictures. Its `adjust` dials:
  temperature {TEMPERATURE_K[0]}..{TEMPERATURE_K[1]} K (6500 as shot; higher is warmer), tint (-100 green..100 magenta),
  saturation (-100 grey..100 twice as vivid), exposure {EXPOSURE_EV[0]}..{EXPOSURE_EV[1]} EV (stops of light), brightness,
  contrast, highlights and shadows (the upper and lower halves), whites and blacks (the two ends),
  each -100..100, fade 0..100 (blacks lifted into a matte), sharpen 0..100 and vignette 0..100
  (the corners darkened); all 0 but temperature by default (neutral). Its `look` (a Look's id from
  list_assets kind "looks", or null) styles the picture after the dials: each of the Look's dials
  moves the grade's by as much as it is from neutral, held in range; `intensity` 0..100 (100 by
  default) mixes the result over the grade without the Look. An unknown Look is refused. An Imported
  Look (category "Imported", has_table) is a .cube file's 3D table, drawn after the dials' colour
  and before sharpen and vignette: add_asset kind "look" imports one for every Job (each import a
  new Look), delete_asset removes one no Candidate's grade names.
  merge_candidate_items changes only the fields given. The dry run lists a Segment's grade by its
  dials that aren't neutral, and its look and intensity.
- The Candidate's own `grade` (the same dials, look and intensity) is laid over the whole Main Track, after the
  Segments' grades and the Transitions; never on the Overlays. merge_candidate_items' `grade`
  changes only the fields given; the dry run lists it at the top.
- Adjustment Layers (`adjustment_layers`, keyed by id) lay a `grade` (the same fields) over the
  Main Track and the Overlays from `start` for `secs` (Timeline time), never the Watermark,
  captions, Shapes, Text Layers or hook: mixed over the picture by `strength` 0..100 (100 by
  default) times a ramp up over `fade_in` and down over `fade_out` seconds (each at most half its
  secs). Overlapping ones apply in list order; one past the Clip's end is cut there. They don't
  follow cuts by themselves (as Text Layers). The dry run lists them (`adjustment_layers`).
- Layout manual frames the episode by hand with a framing, as a video Segment's: a Layout Override
  with "manual" needs its own framing, and the Candidate's layout "manual" needs `framing` (one for
  every Scene without an override); no other Layout has one. A Manual Scene stays still: no face
  tracking. The dry run lists each Scene's layout and the framing that draws its first frame: copy
  it to switch a Scene to Manual without a jump, and its picture's bounds, rotation and crop.
  merge_candidate_items changes only the fields given, of an override's framing or the Candidate's.
- An Overlay's radius rounds its corners, 0..0.5 of its drawn shorter side (0.5: a pill or circle).
  border (width 1..40, colour) and shadow (blur 0..100; x, y -100..100; colour; opacity) are in
  output pixels, or null for none; merge_candidate_items changes only the fields given. Its `grade`
  is a Segment's (above), on its picture alone: after it is scaled, before its corners, border,
  shadow and opacity, so those keep their colours. The dry run lists it likewise.
- An Overlay's `video_effects` is its picture's ordered stack of Video Effects, each
  {{id, params, enabled}}: id from list_assets kind "video_effects" (with each setting's range and
  default: e.g. "gaussian-blur", "motion-blur", "pixelate", "chromatic-aberration", "fisheye",
  "glow", "bloom-pulse", "posterize", "film-grain"), params a setting's key to its value (one left
  out takes its default), enabled false to keep it in the stack undrawn. They run in turn after its
  Grade and before its corners, border, rotation, shadow and opacity. A size (a setting in px) is
  output pixels at the picture's fitted size (scale 1): the render multiplies it by the larger of
  scale x stretch_x and scale x stretch_y, so a bigger picture gets a bigger blur. An effect appears
  once in a stack; an unknown id or setting, a value out of range or a second entry of an id is
  refused. merge_candidate_items replaces an Overlay's stack as a whole. The dry run lists each
  Overlay's enabled ones, their sizes as drawn (scaled). Film grain moves every frame and Bloom
  pulse breathes, both in seconds from the item's own start, so moving an item moves its pulse; an
  image Overlay with either is drawn as a moving picture. Keys ("chroma-key": color "#RRGGBB",
  default "#00B140" green, similarity, softness, spill; "luma-key": threshold, softness, invert 0/1
  to take out the light instead of the dark) are for Overlays only, refused on a Segment or an
  Adjustment Layer: the part they take out shows what is under the Overlay, through its corners,
  border, rotation, shadow and opacity. The key colour is matched after the Overlay's Grade.
- An Overlay's `blend` is its Blend Mode, how it is laid over what is under it: "normal" (the
  default: it covers it), "multiply" (darkens: white leaves it as it was, as a paper texture),
  "screen" (lightens: black leaves it as it was, as a light leak on black), "add", "lighten" or
  "darken". Its colour, after its corners, border, rotation, shadow and opacity, is mixed with what
  is under it by the mode and laid by its alpha, keyed or not. An unknown mode is refused. The dry
  run lists one that isn't normal.
- A Segment's `video_effects` (of the episode or a video, a Freeze frame too) is the same stack over
  its whole frame (panels, picture and Background): after its Grade and before the joins, so a
  Transition crossfades pictures that already carry them. Its frame is 1080x1920 at scale 1, so its
  sizes are as given. A lone Segment of the episode with a stack (even all off) stays a Segment.
  merge_candidate_items replaces its stack as a whole; the dry run lists its enabled ones under
  `segments`.
- An Adjustment Layer's `video_effects`: the same stack over what its Grade covers, after it, mixed
  by its strength and fades (its grade may be neutral); sizes as a Segment's. Merged and listed as
  a Segment's. A keyed Overlay shows the effects it would unkeyed at the same scale.
- Keyframes move an Overlay, a Text Layer, a Shape, a video Segment's framing or a Manual Layout Override's, over its length: its `keys` map a
  property (x, y, scale, rotation, opacity) to a list of {{at, value, ease}}. A Music Clip's, a video
  Overlay's and a Segment's `volume` (0..2) can be keyed too: the fades multiply it, and
  source_volume an episode Segment's. A Segment of the episode has no picture Keyframes; another
  Layout and the Candidate's own framing have none. `at` is seconds from the
  item's start (a Segment's: where it starts in the Clip, its `start`; a Manual
  override's: its Scene's start on the Source's timeline, so every Segment showing that Scene moves
  alike; the dry run lists those past the Scene's end as `ignored`), value in the field's own units (rotation -3600..3600, to
  turn several times). A keyed property's transform field is unused. The value holds before the
  first and after the last Keyframe; between two it moves by the later one's ease: linear (the
  default), ease_in, ease_out, ease_in_out, or a cubic-bezier [x1, y1, x2, y2] (x 0..1; y may
  overshoot). At most 100 per property, 1/30 s apart at least. merge_candidate_items replaces the
  lists of the properties given ([] clears one) and keeps the others. Moving an item moves its
  Keyframes; the server never re-times them (but an episode Segment's, kept on their moments as its
  ends snap to Words), and refuses a length or a Segment's range that would leave one past its item's
  end: send its keys too. The dry run lists them in Timeline time, with
  the picture's bounds at each (an Overlay's, a Text Layer's or Shape's box or a Scene's); a keyed
  volume's under `sounds`. A Text Layer's, a Shape's and an Overlay's animations (fade, pop, slide)
  play on top of its keyed values.
- `muted` true silences a Segment's, a Music Clip's or a video Overlay's sound in the preview and
  the render, keeping its volume, Keyframes and fades: false brings them back. The dry run marks
  Muted ones (`segments`, `sounds`).
- A Music Clip of a song or a video's sound with `duck` (dB, -30..-1; null: off) is turned down that
  far while speech is heard: the Words of the episode's Segments and Music Clips without media
  that aren't Muted, captions on or not. Down over 0.25 s before speech, through pauses under 0.8 s,
  up over 0.5 s after. One added without `duck` gets -12 (not a Detached one), so give null to keep
  it off; one without media has none. The dry run's `sounds` list every sound's span, fades, Muted, and
  a ducked one's `speech_spans` (the speech that reaches it) and `ducked` stretches.
- A Music Clip of a song or a video's sound with `speech` true (a voiceover or a voice memo; false
  by default) is speech over its whole span, pauses included, while it isn't Muted: the ducked
  sounds go down under it as under Words. It is never ducked, so it refuses a `duck`: give
  `duck` null with it on one that has one (one added with `speech` gets no -12). One without media
  refuses `speech` (its Words are its speech). The dry run marks it `speech` in `sounds`.
- A Narration is typed words read aloud by a Voice into a Media Library song: list_assets kind
  "voices" (with the Job's `language` for the engine it starts with, `default`) lists the ready
  engines and their Voices, generate_speech makes one and gives its id and duration, and a Music
  Clip of it with `speech` true (secs its duration) lays it, ducking the songs under it.
- Detach moves a Segment's sound onto a Music Clip of its own, to slide it apart from its picture (a
  J-cut or an L-cut). In one merge_candidate_items call, add a Music Clip with `detached_from` the
  Segment's id, its media (none for one of the episode), offset its `start`, its speed, pitch,
  reverse, volume, fades, volume keys (the same `at`) and audio_effects, start and secs where it plays in the Clip
  (the dry run's `segments`, a Transition's overlap included), and set the Segment's `muted`.
  Reattach: remove every Music Clip Detached from it, then clear its `muted`. A `detached_from` added
  or changed must name one of the Candidate's Segments; a saved one stays after its Segment is removed.
- A Transition joins a Segment (`after`, its id) to the next: the two overlap for its secs
  (0.1..3 s, 0.5 by default; half the shorter Segment at most), so the Clip is that much shorter.
  Its kind, by group: Basic (fade, fadeblack, fadewhite, fadegrays, dipcolour, dissolve,
  blurdissolve), Slide (slideleft, slideright, slideup, slidedown push both pictures along;
  coverleft, coverright, coverup, coverdown slide the next over a still one; whipleft, whipright
  push them smeared), Wipe (wipeleft, wiperight, wipeup, wipedown, radial: a clock wipe), Shape
  (circleopen, circleclose, circlecrop, rectcrop, vertopen, horzopen), Zoom (zoomin, squeezeh,
  squeezev, zoomblur, spin), Light (filmburn, lightleak),
  Glitch (glitch, rgbsplit, pixelize, hblur, distance, hlslice). Its knobs: `strength` (0..1; unset, the kind's own) is the heat of filmburn,
  the brightness of lightleak, the spread of rgbsplit, the blur of blurdissolve, whipleft and
  whipright, the zoom and blur of zoomblur, the turns of spin (half a turn to two) and the tearing
  of glitch. `colour` (#RRGGBB, black unset) is dipcolour's. A knob is kept on any kind, read only
  by those. Its sound, for every kind (a dip never drops the sound out on its own): linear (the default; the two sides crossfade in
  straight lines, dipping in the middle), equal_power (quarter sines, the level held through the
  middle) or cut (the first side's sound alone until the middle of the overlap, the second's after
  it). The dry run lists each (`transitions`) with the Segment it comes after, its kind, its span in
  the Clip, its sound and its knobs (null when unset).
- A Style Preset's join_transition (none, or a Transition without `after`; built-in ones have none)
  is copied onto every new join of its Candidates: when an edit changes the Segments without
  stating `transitions`, each pair of adjacent Segments that wasn't adjacent before and has no
  Transition gets it. A stated `transitions` list is taken as is, so state it to leave a new join a
  cut. Removing a Transition, or changing or switching the Preset, touches no join.
- A Freeze frame is a Segment with `hold` (seconds, 0.1 or more): it shows the frame at its `start`
  (in the episode or its video) for that long, silent while the Music Clips play on, its `end` equal
  to its `start`; no speed, pitch or reverse. One of the episode is framed by the Layout of the Scene
  holding its frame, as that Scene is at that moment, and has no captions nor Keyframes; one of a
  video by its framing, and may have picture Keyframes (a slow zoom into the still), not volume. To
  freeze a moment of a Segment: split it there into two Segments meeting at the moment, put a held
  Segment of that moment between them (their ends touching it stay at its frame, not snapped to
  Words), then move the Text Layers, Music Clips, Overlays and hook after the moment later by its
  hold. The dry run lists each Segment's span in the Clip under `segments`.
- The owner may have the Job open in the browser: its editors show these edits as they are saved.
  Each Candidate has a `revision`. Pass the one you read to edit_candidate: an edit made after
  someone else's is then refused with the Candidate as it is now; redo yours on top of it.
  merge_candidate_items and remove_candidate_items do this themselves. When the owner changes the
  same item at the same time, the owner's change wins.
- list_candidate_revisions shows a Candidate's last 50 saved states and who saved each;
  restore_candidate_revision brings one back (a mistake of yours, say) as a new revision.
"""

_JOB = TypeAdapter(Job)
_PICTURE = TypeAdapter(Picture)
_TEXT = TypeAdapter(TextEvent)
_SHAPE = TypeAdapter(ShapeEvent)
# httpx logs each request at INFO: here, every tool's call to the API.
logging.getLogger("httpx").setLevel(logging.WARNING)


def build_mcp(app: FastAPI) -> MCPServer:
    """The MCP server for `app`, whose services (app.state) its tools use."""
    mcp = MCPServer("AI Clipper", instructions=INSTRUCTIONS)

    def tool(*, read_only: bool = False, destructive: bool = False):
        # Unstructured: the result's JSON is sent once, as text, rather than twice. Each tool returns an
        # object, since a list would be sent as a block per item (and an empty one as nothing).
        return mcp.tool(
            structured_output=False,
            annotations=ToolAnnotations(readOnlyHint=read_only, destructiveHint=destructive),
        )

    async def api(
        method: str, path: str, *, json: Any = None, params: dict | None = None, files: dict | None = None, text: bool = False
    ) -> Any:
        """The API route's response (None for 204; with `text`, its body as text), or a ToolError with its message."""
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://ai-clipper") as client:
            response = await client.request(method, f"/api{path}", json=json, params=params, files=files, headers=EDIT_SOURCE)
        if response.is_success:
            return None if response.status_code == 204 else response.text if text else response.json()
        if (current := _stale_candidate(response)) is not None:
            raise StaleCandidate(_message(response), current)
        raise ToolError(_message(response))

    async def candidate(job_id: str, candidate_id: str) -> dict:
        job = await api("GET", f"/jobs/{job_id}")
        found = next((c for c in job["candidates"] or [] if c["id"] == candidate_id), None)
        if found is None:
            raise ToolError(f"Job {job_id} has no Candidate {candidate_id}")
        return found

    async def template_names() -> dict[str, str]:
        return {template["id"]: template["name"] for template in await api("GET", "/templates")}

    async def save_from_current(job_id: str, candidate_id: str, change: Callable[[dict], dict]) -> dict:
        """Save the body `change` makes of the Candidate as it is, from its Revision. When another
        edit saves first, `change` is made again of the Candidate as that left it."""
        current = await candidate(job_id, candidate_id)
        for _ in range(STALE_RETRIES):
            body = change(current)
            if not body:
                return current
            try:
                return await api("PATCH", f"/jobs/{job_id}/candidates/{candidate_id}", json=body | {"revision": current["revision"]})
            except StaleCandidate as stale:
                current = stale.candidate
        raise ToolError(f"Candidate {candidate_id} kept changing while this edit was saved: try again")

    def copied(job_id: str, segment: dict) -> bool:
        """Whether a reversed Segment's full-size Retimed copy, which its render reads, is made."""
        if segment["media"] is not None:
            retimed = app.state.media.retimed(segment["media"])
        else:
            job = app.state.store.get(job_id)
            retimed = source_copies(app.state.store.job_dir(job_id), job.source)
        return retimed.find(CopySize.FULL, Retime(segment["source_start"], segment["source_end"])) is not None

    def new_title(layer: Any) -> Any:
        """A new Text Layer, its style the fields it gives over the Text Preset used for new titles'."""
        if not isinstance(layer, dict):
            return layer
        style = _dump(TextStyle, app.state.text_presets.default().style)
        return layer | {"style": _merged_fields(style, layer["style"]) if isinstance(layer.get("style"), dict) else style}

    def new_titles(changes: Any) -> Any:
        """An edit_candidate's changes, each Text Layer's style laid over the one used for new titles (`new_title`)."""
        if isinstance(changes, dict) and isinstance(changes.get("text_layers"), list):
            return changes | {"text_layers": [new_title(layer) for layer in changes["text_layers"]]}
        return changes

    def clips(job_id: str, listed: list[dict]) -> list[dict]:
        job_dir = app.state.store.job_dir(job_id).resolve()
        return [_clip_view(job_dir, clip) for clip in listed]

    # Jobs

    @tool()
    async def create_job_from_url(url: str, options: JobOptions = JobOptions()) -> dict:
        """Start a Job from a video's URL (YouTube): it is downloaded, transcribed and analyzed into
        Candidates. `options.brief` steers which moments are picked; min_secs and max_secs bound a
        Candidate's length. Follow it with wait_for_job."""
        body = {"url": url, "options": _dump(JobOptions, options)}
        return _job_view(await api("POST", "/jobs", json=body))

    @tool()
    async def create_job_from_file(path: str, options: JobOptions = JobOptions()) -> dict:
        """Start a Job from a video file on this Mac, by its path. The file is left where it is (the
        Job keeps a clone or copy of it). Follow it with wait_for_job."""
        settings, store = app.state.settings, app.state.store
        file = Path(path).expanduser()
        try:
            staged = await to_thread.run_sync(stage, file, settings.data_dir / UPLOADS_DIR, settings.upload_reserve_bytes)
        except (BadUpload, NotEnoughSpace) as exc:
            raise ToolError(str(exc)) from None
        job = store.create("", options, app.state.profiles.load(), upload=(staged.path, staged.name))
        app.state.worker.submit(job.id)
        return _job_view(_JOB.dump_python(job, mode="json"))

    @tool(read_only=True)
    async def list_jobs(
        limit: int = Field(20, ge=1, le=100), before: AwareDatetime | None = None
    ) -> dict:
        """The Jobs, newest first. For the next page, pass the last one's created_at as `before`."""
        params: dict[str, Any] = {"limit": limit}
        if before is not None:
            params["before"] = before.isoformat()
        return {"jobs": [_job_view(job) for job in await api("GET", "/jobs", params=params)]}

    @tool(read_only=True)
    async def get_job(job_id: str) -> dict:
        """A Job, its Candidates (best first, summarized; get_candidate has one whole) and its Clips.
        The Transcript is read with get_transcript."""
        job = await api("GET", f"/jobs/{job_id}")
        view = _job_view(job)
        view["candidates"] = None if job["candidates"] is None else [_candidate_view(c) for c in job["candidates"]]
        view["clips"] = clips(job_id, job["clips"])
        return view

    @tool(read_only=True)
    async def wait_for_job(
        job_id: str,
        ctx: Context,
        until: list[JobStatus] | None = None,
        timeout_secs: int = Field(WAIT_SECS, ge=5, le=WAIT_MAX_SECS),
    ) -> dict:
        """Wait until the Job's status is one of `until` (review or error by default), reporting its
        progress meanwhile. Returns `reached` and the Job: on timeout, or when the Job settles in
        review or error without reaching `until`, `reached` is false; call it again to go on waiting."""
        wanted = set(until or SETTLED)
        reached = False
        try:
            async with asyncio.timeout(timeout_secs), aclosing(job_events(app.state.store, job_id)) as events:
                async for event in events:
                    if event.event == "end" and event.data == "deleted":
                        raise ToolError(f"No Job {job_id}")
                    if event.event != "job":
                        break
                    progress: JobProgress = event.data
                    if progress.status in wanted:
                        reached = True
                        break
                    note = " ".join(str(part) for part in (progress.status, progress.message) if part)
                    await ctx.report_progress(progress.progress or 0, 100, note)
        except TimeoutError:
            pass
        try:
            job = app.state.store.get(job_id)
        except JobNotFound:
            raise ToolError(f"No Job {job_id}") from None
        return {"reached": reached, "job": _job_view(_JOB.dump_python(job, mode="json"))}

    @tool()
    async def retry_job(job_id: str) -> dict:
        """Queue a Job in error again; it resumes from the stage it failed in."""
        return _job_view(await api("POST", f"/jobs/{job_id}/retry"))

    @tool(destructive=True)
    async def delete_job(job_id: str) -> dict:
        """Delete a Job and all its files, its Clips included. Refused while one of its stages runs."""
        await api("DELETE", f"/jobs/{job_id}")
        return {"deleted": job_id}

    # Review

    @tool(read_only=True)
    async def get_transcript(
        job_id: str,
        start: float = Field(0, ge=0),
        end: float | None = None,
        words: bool = False,
    ) -> dict:
        """The Transcript's lines from `start` to `end` (Source time, seconds), at most 10 minutes or
        400 lines a call; `next_start` is where the
        next page starts, None at the end. With `words`, each Word too, with its start and end."""
        job = await api("GET", f"/jobs/{job_id}")
        transcript = job["transcript"]
        if transcript is None:
            raise ToolError(f"Job {job_id} has no Transcript yet: it is {job['status']}")
        end = start + TRANSCRIPT_PAGE_SECS if end is None else min(end, start + TRANSCRIPT_PAGE_SECS)
        lines = [line for line in transcript["segments"] if line["end"] > start and line["start"] < end]
        full = len(lines) > TRANSCRIPT_PAGE_LINES
        lines = lines[:TRANSCRIPT_PAGE_LINES]
        resume = lines[-1]["end"] if full else max([end, *(line["end"] for line in lines[-1:])])
        page: dict[str, Any] = {
            "language": transcript["language"],
            "lines": [_times(line, "start", "end", "text") for line in lines],
            "next_start": resume if any(line["end"] > resume for line in transcript["segments"]) else None,
        }
        if words:
            page["words"] = [_times(word, "text", "start", "end") for word in transcript["words"] if start <= word["start"] < resume]
        return page

    @tool(read_only=True)
    async def get_candidate(job_id: str, candidate_id: str) -> dict:
        """A Candidate whole: its range, hook, titles and descriptions, and every edit made to it;
        `template_items` lists its Template items and the Template that put each there (its name, or
        "deleted")."""
        found = await candidate(job_id, candidate_id)
        marks = _template_items(found, await template_names())
        return found | ({"template_items": marks} if marks else {})

    @tool()
    async def edit_candidate(
        job_id: str, candidate_id: str, changes: Annotated[_CandidateChanges, BeforeValidator(new_titles)], dry_run: bool = False
    ) -> dict:
        """Change a Candidate and save it: only the fields given change. start and end (Source time)
        are snapped to Words. Lists and style_overrides replace the Candidate's whole list (see
        merge_candidate_items). With changes.revision (the `revision` you read), an edit made after
        someone else's is refused with the Candidate as it is now, instead of saved over it. With
        dry_run, nothing is saved: the Preview Plan of the changes comes back instead, its events in
        Timeline time, its Cues with the key a Cue Edit names, each Segment's words_status, and its
        Words with the `at` (and `media`) a Word Edit names."""
        body = changes.model_dump(mode="json", exclude_unset=True)
        # A Music Clip given without `duck` is sent without it, so that a new song's ducks by default.
        for clip in body.get("music") or []:
            if clip["id"] in changes._duck_unset:
                del clip["duck"]
        if dry_run:
            return _plan_view(
                await api("POST", f"/jobs/{job_id}/candidates/{candidate_id}/preview-plan", json=body),
                lambda segment: copied(job_id, segment),
                lambda name: f"/api/jobs/{job_id}/{PICTURES_ROUTE}/{name}",
            )
        return await api("PATCH", f"/jobs/{job_id}/candidates/{candidate_id}", json=body)

    @tool()
    async def add_candidate(job_id: str, start: float, end: float) -> dict:
        """Add a manual Candidate from `start` to `end` (Source time, snapped to Words), after the AI's."""
        return _candidate_view(await api("POST", f"/jobs/{job_id}/candidates", json={"start": start, "end": end}))

    # Advanced Edit

    @tool()
    async def merge_candidate_items(
        job_id: str,
        candidate_id: str,
        text_layers: Annotated[list[_PATCHES["text_layers"]], BeforeValidator(no_old_text_layers)] | None = None,  # type: ignore[valid-type]
        shapes: Annotated[list[_PATCHES["shapes"]], _SHAPES_SCHEMA] | None = None,  # type: ignore[valid-type]
        music: list[_PATCHES["music"]] | None = None,  # type: ignore[valid-type]
        overlays: Annotated[list[_PATCHES["overlays"]], BeforeValidator(no_old_overlays)] | None = None,  # type: ignore[valid-type]
        segments: Annotated[list[_PATCHES["segments"]], BeforeValidator(no_old_segments)] | None = None,  # type: ignore[valid-type]
        transitions: list[_PATCHES["transitions"]] | None = None,  # type: ignore[valid-type]
        word_edits: list[_PATCHES["word_edits"]] | None = None,  # type: ignore[valid-type]
        layout_overrides: list[_PATCHES["layout_overrides"]] | None = None,  # type: ignore[valid-type]
        cue_edits: list[_PATCHES["cue_edits"]] | None = None,  # type: ignore[valid-type]
        adjustment_layers: list[_PATCHES["adjustment_layers"]] | None = None,  # type: ignore[valid-type]
        style_overrides: StyleOverrides | None = None,
        framing: Annotated[_FRAMING_PATCH, BeforeValidator(no_framing_keys)] | None = None,  # type: ignore[valid-type]
        grade: _GRADE_PATCH | None = None,  # type: ignore[valid-type]
    ) -> dict:
        """Add or change some of a Candidate's items, keeping the others. An item with the key of
        one the Candidate has (id; a Transition's `after`; a Word Edit's or Cue Edit's `at` and
        `media`; a Layout Override's `at`)
        changes only the fields given; another is added (Segments at the end of the Main Track), and
        needs the fields its kind requires. style_overrides are merged per section (caption, hook,
        watermark) and a shadow by its fields, and framing (the Candidate's, for Layout manual)
        and grade (the Candidate's) field by field. The Candidate is saved once, through the same checks as edit_candidate."""
        # The patches of each list, by the parameter named for it.
        given = {kind: patches for kind, patches in locals().items() if kind in ITEMS}

        def merged(current: dict) -> dict:
            body: dict[str, Any] = {}
            for kind, patches in given.items():
                if patches is not None:
                    dumped = [patch.model_dump(mode="json", exclude_unset=True) for patch in patches]
                    if kind == "text_layers":
                        dumped = [patch if any(_same(item["id"], patch["id"]) for item in current[kind]) else new_title(patch) for patch in dumped]
                    if kind == "shapes":
                        dumped = [_switched_stroke(current[kind], patch) for patch in dumped]
                    body[kind] = _merge(current[kind], dumped, _KEYS[kind])
            if style_overrides is not None:
                new = _dump(StyleOverrides, style_overrides)
                body["style_overrides"] = {
                    section: _merged_fields(fields, new[section]) for section, fields in current["style_overrides"].items()
                }
            if framing is not None:
                patch = framing.model_dump(mode="json", exclude_unset=True)
                body["framing"] = _merged_fields(current["framing"], patch) if current["framing"] else patch
            if grade is not None:
                body["grade"] = _merged_fields(current["grade"], grade.model_dump(mode="json", exclude_unset=True))
            return body

        return await save_from_current(job_id, candidate_id, merged)

    @tool()
    async def remove_candidate_items(
        job_id: str,
        candidate_id: str,
        kind: Literal[*ITEMS, "style_overrides"],  # type: ignore[valid-type]
        keys: list[str | float | CueKey],
    ) -> dict:
        """Remove some of a Candidate's items of one kind, by key: ids; a Transition's `after`; a
        Word Edit's or Cue Edit's `at` ({at, media} for a video's) or a Layout Override's `at`; for
        style_overrides, "section.field" (such as "caption.size"), which then falls back to the Style
        Preset's."""

        def removed(current: dict) -> dict:
            if kind == "style_overrides":
                overrides = {section: dict(fields) for section, fields in current["style_overrides"].items()}
                for key in keys:
                    section, _, name = str(key).partition(".")
                    if overrides.get(section, {}).pop(name, None) is None:
                        raise ToolError(f"Candidate {candidate_id} has no style override {key}")
                return {"style_overrides": overrides}
            key = _KEYS[kind]
            items = current[kind]
            wanted_items = [_key_item(key, wanted) for wanted in keys]
            for wanted, given in zip(wanted_items, keys):
                if not any(_same_key(item, wanted, key) for item in items):
                    shown = _key_shown(given)
                    raise ToolError(f"Candidate {candidate_id} has no {kind} item with {_key_name(key)} {shown}")
            return {kind: [item for item in items if not any(_same_key(item, wanted, key) for wanted in wanted_items)]}

        return await save_from_current(job_id, candidate_id, removed)

    @tool(read_only=True)
    async def list_candidate_revisions(job_id: str, candidate_id: str) -> dict:
        """A Candidate's Revision History, newest first: its last 50 saved states, one per stretch of
        saves from one editor (source: advanced-edit, clip-editor, agent, restore, original, unknown),
        with when and the parts each changed. restore_candidate_revision brings one back."""
        return await api("GET", f"/jobs/{job_id}/candidates/{candidate_id}/revisions")

    @tool()
    async def restore_candidate_revision(job_id: str, candidate_id: str, restore: int, revision: int | None = None) -> dict:
        """Save the Candidate as it was at Revision `restore` (from list_candidate_revisions) as its
        next Revision, keeping whether it is selected; nothing is lost, the newer ones stay in the
        history. With `revision` (the one you read), refused if the Candidate changed since."""
        body = {} if revision is None else {"revision": revision}
        return await api("POST", f"/jobs/{job_id}/candidates/{candidate_id}/revisions/{restore}/restore", json=body)

    # Render

    @tool()
    async def render_clips(job_id: str, candidate_ids: list[str] | None = None, export_preset_id: str | None = None) -> dict:
        """Render Clips of the selected Candidates, or of `candidate_ids`, one at a time, replacing
        Clips rendered before, with an Export Preset (else the default; Export Settings never make a
        Clip stale). The Job is rendering until they are done: wait_for_job, then list_clips."""
        body = {"candidate_ids": candidate_ids, "export_preset_id": export_preset_id}
        return {"clips": clips(job_id, await api("POST", f"/jobs/{job_id}/render", json=body))}

    @tool(read_only=True)
    async def list_clips(job_id: str) -> dict:
        """The Job's Clips in their Candidates' order, each rendered one with its MP4 (video_path),
        poster and caption files (srt_path, vtt_path; none with captions off) on this Mac, and its
        Export Settings (these never make a Clip stale)."""
        return {"clips": clips(job_id, await api("GET", f"/jobs/{job_id}/clips"))}

    @tool()
    async def save_frame(job_id: str, candidate_id: str, at: float, export_preset_id: str | None = None) -> dict:
        """Save the Candidate's frame at `at` (Timeline seconds) as a PNG, as its render would draw it,
        at an Export Preset's size (else the default's), e.g. for a thumbnail. Quick, not queued."""
        body = {"at": at, "export_preset_id": export_preset_id}
        saved = await api("POST", f"/jobs/{job_id}/candidates/{candidate_id}/frame", json=body)
        return {"path": saved["path"]}

    @tool()
    async def export_audio(
        job_id: str, candidate_id: str, format: Literal["wav", "m4a"] = "wav", export_preset_id: str | None = None
    ) -> dict:
        """Save a Candidate's sound alone (its saved Revision's mix) at an Export Preset's loudness
        (else the default's). Not a Clip; not queued."""
        body = {"format": format, "export_preset_id": export_preset_id}
        saved = await api("POST", f"/jobs/{job_id}/candidates/{candidate_id}/audio", json=body)
        return {"path": saved["path"]}

    # Captions

    @tool()
    async def set_media_language(media_id: str, language: str | None) -> dict:
        """Set a video's language (ISO 639-1; null: each Job's), which its Media Words are heard in."""
        return await api("PATCH", f"/media/{media_id}", json={"language": language})

    @tool()
    async def get_media_words(
        media_id: str, job_id: str, again: bool = False, timeout_secs: int = Field(MEDIA_WORDS_WAIT_SECS, ge=5, le=WAIT_MAX_SECS)
    ) -> dict:
        """A video's Media Words for the Job (seconds into it), in its language. Queues them when
        none or failed (`again`: even when ready), waits up to timeout_secs, and returns their
        `status` (ready, pending: call again, failed with `error`, none) and `words` when ready."""
        path = f"/jobs/{job_id}/media/{media_id}/words"
        words = await api("GET", path)
        if again or words["status"] in ("none", "failed"):
            words = await api("POST", path, json={"again": again})
        try:
            async with asyncio.timeout(timeout_secs):
                while words["status"] == "pending":
                    await asyncio.sleep(MEDIA_WORDS_POLL_SECS)
                    words = await api("GET", path)
        except TimeoutError:
            pass
        if words["words"] is not None:
            words["words"] = [_times(word, "text", "start", "end") for word in words["words"]]
        return _compact(words)

    @tool(read_only=True)
    async def get_captions(job_id: str, candidate_id: str, format: Literal["srt", "vtt"]) -> dict:
        """The Candidate's captions as SRT or VTT `text`: its saved Cues, without a render. Refused
        while a Segment's Words are pending, and with captions off."""
        return {"format": format, "text": await api("GET", f"/jobs/{job_id}/candidates/{candidate_id}/captions/{format}", text=True)}

    # Styles, assets and the Channel Profile

    async def save_export_preset(given: BaseModel | None, preset_id: str | None, use_as_default: bool) -> dict:
        """An Export Preset made, or the owner's `preset_id` changed in the fields given; then made the
        default when asked."""
        saved = None
        if given is not None:
            body = _validated(NamedPresetGiven, given)
            if preset_id is None:
                saved = await api("POST", "/export-presets", json=_validated(ExportPresetBody, NamedPresetGiven(**body)))
            else:
                listed = (await api("GET", "/export-presets"))["presets"]
                current = next((preset for preset in listed if preset["id"] == preset_id), None)
                if current is None:
                    raise ToolError(f"No Export Preset {preset_id}")
                body = {"name": current["name"], **body, "settings": current["settings"] | body.get("settings", {})}
                saved = await api("PUT", f"/export-presets/{preset_id}", json=_validated(ExportPresetBody, NamedPresetGiven(**body)))
        elif not (preset_id and use_as_default):
            raise ToolError("Give the preset to save, or a preset_id with use_as_default")
        if use_as_default:
            return await api("PUT", "/export-presets/default", json={"preset_id": saved["id"] if saved else preset_id})
        return saved

    async def save_template(given: BaseModel | None, preset_id: str | None) -> dict:
        """A Template saved from a Candidate, or the Template `preset_id` saved over or renamed."""
        body = _validated(TemplateGiven, given)
        if preset_id is not None and body.keys() == {"name"}:
            return _template_view(await api("PATCH", f"/templates/{preset_id}", json=body))
        if preset_id is None:
            return _template_view(await api("POST", "/templates", json=body))
        return _template_view(await api("PUT", f"/templates/{preset_id}", json=body))

    @tool(read_only=True)
    async def list_presets(kind: Literal["style", "text", "export", "template"] = "style", include_styles: bool = False) -> dict:
        """The Style Presets, or the Text Presets (`default`: used for new titles): built-in ones,
        then the owner's. With include_styles, their styles (a Style Override replaces their fields).
        Export Presets: with their settings, the `default` and the codecs `available`. Templates:
        with their layers and Anchors."""
        if kind == "export":
            return await api("GET", "/export-presets")
        if kind == "template":
            return {"presets": [_template_view(template) for template in await api("GET", "/templates")]}
        if kind == "text":
            presets = await api("GET", "/text-presets")
            keys = ("id", "name", "category", "builtin", "default", *(("sample", "style") if include_styles else ()))
            return {"presets": [{key: preset[key] for key in keys} for preset in presets]}
        presets = await api("GET", "/presets")
        if not include_styles:
            presets = [{key: p[key] for key in ("id", "name", "builtin")} for p in presets]
        return {"presets": presets}

    @tool()
    async def save_preset(
        preset: PresetBody | NamedPresetGiven | TemplateGiven | None = None,
        preset_id: str | None = None,
        kind: Literal["style", "text", "export", "template"] = "style",
        use_for_new_titles: bool = False,
        use_as_default: bool = False,
    ) -> dict:
        """Save a new Preset, or replace the owner's Preset `preset_id` (built-in ones can't be). A
        Style Preset's join_transition goes on its Candidates' new joins (see the instructions). A
        Text Preset is {name, style}. use_for_new_titles: new Text Layers copy it (a built-in one's
        preset_id alone). An Export Preset is {name, settings}, never making a Clip stale; use_as_default: renders use it (likewise).
        A Template is {name, job_id, candidate_id, anchors?} (see the instructions)."""
        if kind == "template":
            return await save_template(preset, preset_id)
        if kind == "export":
            return await save_export_preset(preset, preset_id, use_as_default)
        if kind == "style":
            body = _validated(PresetBody, preset)
            if preset_id is None:
                return await api("POST", "/presets", json=body)
            return await api("PUT", f"/presets/{preset_id}", json=body)
        saved = None
        if preset is not None:
            if preset_id is None:
                saved = await api("POST", "/text-presets", json=_validated(TextPresetBody, preset))
            else:
                saved = await api("PATCH", f"/text-presets/{preset_id}", json=_validated(TextPresetChange, preset))
        elif not (preset_id and use_for_new_titles):
            raise ToolError("Give the preset to save, or a preset_id with use_for_new_titles")
        if use_for_new_titles:
            return await api("PUT", "/text-presets/default", json={"id": saved["id"] if saved else preset_id})
        return saved

    @tool(destructive=True)
    async def delete_preset(preset_id: str, kind: Literal["style", "text", "export", "template"] = "style") -> dict:
        """Delete one of the owner's Presets. Candidates using a Style Preset render in Default; Text
        Layers keep their look; Clips of an Export Preset render again with the default; Candidates
        keep a Template's items."""
        routes = {"text": "text-presets", "export": "export-presets", "template": "templates"}
        await api("DELETE", f"/{routes.get(kind, 'presets')}/{preset_id}")
        return {"deleted": preset_id}

    @tool()
    async def apply_template(job_id: str, candidate_ids: list[str], template_id: str | None, dry_run: bool = False) -> dict:
        """Apply a Template to Candidates of a Job, all of them or none, replacing their Template
        items; template_id null is "No Template", taking them off. Each changed one gets a new
        revision. Per Candidate: its `revision`, the `edits` made (lists replaced whole, as
        edit_candidate's), the `template_items` they leave (as get_candidate's) and `notices` (Template
        items replaced that were changed by hand or whose Template was deleted, layers cut short or
        left out). With dry_run, nothing is saved."""
        body = {"template_id": template_id, "candidate_ids": candidate_ids, "dry_run": dry_run}
        result = await api("POST", f"/jobs/{job_id}/templates/apply", json=body)
        names = await template_names()
        return {"candidates": [entry | {"template_items": _template_items(entry["edits"], names)} for entry in result["candidates"]]}

    @tool(read_only=True)
    async def list_assets(
        kind: Literal["fonts", "logos", "media", "looks", "audio_effects", "video_effects", "voices"] | None = None,
        language: Language | None = None,
    ) -> dict:
        """The fonts' Faces (a style's font is a Face's id), the Logos a Watermark can show, the
        Media Library (songs, videos and images for Music Clips, Overlays and Segments), the Looks
        a grade's `look` names (id, name, category, Adjust values; has_table for an Imported Look's
        .cube), the Audio Effects a sound's `audio_effects` name (id, name, group, settings with
        their ranges and defaults) and the Video Effects a picture's `video_effects` name (id, name,
        category, settings likewise), and the ready speech engines with their Voices and the
        `default` one for a Job in `language` (generate_speech): all, or one `kind`."""
        listed: dict[str, Any] = {}
        if kind in (None, "fonts"):
            listed["fonts"] = [_face(face) for face in await api("GET", "/fonts")]
        if kind in (None, "logos"):
            listed["logos"] = await api("GET", "/logos")
        if kind in (None, "media"):
            listed["media"] = await api("GET", "/media")
        if kind in (None, "looks"):
            listed["looks"] = [_look(look) for look in await api("GET", "/looks")]
        if kind in (None, "audio_effects"):
            listed["audio_effects"] = await api("GET", "/audio-effects")
        if kind in (None, "video_effects"):
            listed["video_effects"] = await api("GET", "/video-effects")
        if kind in (None, "voices"):
            voices = await api("GET", "/voices", params={"language": language} if language else None)
            engines = [_engine(engine) for engine in voices["engines"] if engine["ready"]]
            listed["voices"] = {"engines": engines, "default": voices["default"]}
        return listed

    @tool()
    async def add_asset(kind: Literal["logo", "media", "font", "look"], path: str) -> dict:
        """Add a file on this Mac, by its path, as a Logo (PNG, JPEG or WebP), to the Media Library (a
        video of 3 minutes at most, a song or an image), as a font (TTF, OTF or TTC), or as an
        Imported Look (a .cube 3D table, 2 to 65 a side). The file is left where it is. A font gives
        the Faces added, those already there (existing) and warnings."""
        file = Path(path).expanduser()
        if not file.is_file():
            raise ToolError(f"No file {file}")
        if kind == "look":
            with file.open("rb") as data:
                cube = data.read(MAX_LOOK_BYTES + 1)
            look = await api("POST", "/looks", files={"file": (file.name, cube)})
            return _look(look)
        if kind == "font":
            with file.open("rb") as data:
                font = data.read(MAX_FONT_BYTES + 1)
            imported = await api("POST", "/fonts", files={"file": (file.name, font)})
            return {key: [_face(face) for face in imported[key]] for key in ("faces", "existing")} | {"warnings": imported["warnings"]}

        def add() -> Any:
            with file.open("rb") as data:
                if kind == "logo":
                    return app.state.logos.add(data.read(MAX_UPLOAD_BYTES + 1), file.name)
                return app.state.media.add(data, file.name)

        try:
            item = await to_thread.run_sync(add)
        except (BadLogo, BadMedia) as exc:
            raise ToolError(str(exc)) from None
        return TypeAdapter(type(item)).dump_python(item, mode="json")

    @tool()
    async def generate_speech(
        text: str, engine: str, voice: str, speed: float = DEFAULT_SPEED, pauses: float = DEFAULT_PAUSE_SECS, style: str | None = None
    ) -> dict:
        """Make a Narration (`text` read by a Voice, list_assets kind "voices") at `speed` 0.5..2,
        `pauses` s 0..1.5 between sentences, a `style` if its engine takes_style. Waits for it; gives
        the Media Library item's id, name, duration. One at a time."""
        body = {"text": text, "engine": engine, "voice": voice, "speed": speed, "pauses": pauses, "style": style}
        started = await api("POST", "/narrations", json=body)
        async with aclosing(app.state.narrations.events(started["id"])) as events:
            async for event in events:
                if event.event == "done":
                    item = _dump(MediaItem, event.data)
                    return {key: item[key] for key in ("id", "name", "duration")}
                if event.event == "failed":
                    raise ToolError(event.data["message"])
                if event.event == "cancelled":
                    raise ToolError("The Narration was cancelled")
        raise ToolError("The Narration ended without an item")

    @tool(destructive=True)
    async def delete_asset(kind: Literal["logo", "media", "font", "look"], asset_id: str) -> dict:
        """Delete a Logo, or a Media Library item, an imported font's Face or an Imported Look that
        nothing uses."""
        await api("DELETE", f"/{ASSET_ROUTES[kind]}/{asset_id}")
        return {"deleted": asset_id}

    @tool(read_only=True)
    async def get_channel_profile() -> dict:
        """The Channel Profile: the niche, audience, clip style and what to avoid, which steer
        which moments new Jobs pick."""
        return await api("GET", "/profile")

    @tool()
    async def set_channel_profile(profile: ChannelProfile) -> dict:
        """Replace the Channel Profile. New Jobs steer by it; existing Jobs keep theirs."""
        return await api("PUT", "/profile", json=_dump(ChannelProfile, profile))

    @mcp.resource("ai-clipper://glossary", name="glossary", mime_type="text/markdown")
    def glossary() -> str:
        """AI Clipper's domain words: Job, Candidate, Clip, Segment, Timeline time and the rest."""
        return GLOSSARY.read_text()

    for registered in mcp._tool_manager.list_tools():
        registered.parameters = _untitled(registered.parameters)
    return mcp


def _untitled(schema: Any) -> Any:
    """A tool's JSON schema without pydantic's titles, which only repeat each field's name: they
    would take the tools past their budget. A property named title stays, and so do defaults."""
    if isinstance(schema, list):
        return [_untitled(value) for value in schema]
    if not isinstance(schema, dict):
        return schema
    return {
        key: value if key == "default" else _untitled(value)
        for key, value in schema.items()
        if not (key == "title" and isinstance(value, str))
    }


class NamedPresetGiven(BaseModel):
    """A Text Preset: a name and a Text Style, as a Text Layer's; or an Export Preset: a name and
    Export Settings."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    style: dict[str, Any] | None = None
    settings: dict[str, Any] | None = None


class TemplateGiven(BaseModel):
    """A Template: its name, the Candidate it is saved from, and the Anchors chosen for its layers."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    job_id: str | None = None
    candidate_id: str | None = None
    anchors: list[AnchorOverride] | None = None


class StaleCandidate(ToolError):
    """An edit made from a Revision the Candidate has moved past; `candidate` is it as it is now."""

    def __init__(self, message: str, candidate: dict):
        super().__init__(message)
        self.candidate = candidate


def _detail(response: httpx.Response) -> Any:
    """An API error's `detail`, or None when it has none."""
    try:
        return response.json()["detail"]
    except (ValueError, KeyError, TypeError):
        return None


def _stale_candidate(response: httpx.Response) -> dict | None:
    """The Candidate as it is now, when an edit was refused for being made from an older Revision."""
    detail = _detail(response)
    if response.status_code == 409 and isinstance(detail, dict):
        return detail.get("candidate")
    return None


def _message(response: httpx.Response) -> str:
    """An API error's `detail` as one line."""
    detail = _detail(response)
    if detail is None:
        return f"{response.status_code} {response.reason_phrase}: {response.text}"
    if isinstance(detail, list):  # validation errors
        return "; ".join(f"{'.'.join(str(part) for part in error['loc'][1:])}: {error['msg']}" for error in detail)
    if (current := _stale_candidate(response)) is not None:
        return f"{detail['message']}. The Candidate now: {json.dumps(current)}"
    if isinstance(detail, dict) and any("where" in use for use in detail.get("uses", [])):  # a Face in use
        return str(detail.get("message"))
    if isinstance(detail, dict):  # a Media Library item in use
        uses = ", ".join(f"{use['title']} (Job {use['job_id']}, Candidate {use['candidate_id']})" for use in detail.get("uses", []))
        return f"{detail.get('message')}: {uses}" if uses else str(detail.get("message"))
    return str(detail)


def _face(face: dict) -> dict:
    """A Face as the tools list it: without its measures and URL, and without licence fields its font leaves empty."""
    keys = ("id", "label", "typographic_family", "weight", "italic", "bundled", "restricted", "copyright", "licence", "licence_url")
    return {key: face[key] for key in keys if face[key] != ""}


def _engine(engine: dict) -> dict:
    """A ready speech engine as list_assets lists it: what /api/voices says but `ready`."""
    return {key: value for key, value in engine.items() if key != "ready"}


def _look(look: dict) -> dict:
    """An Imported Look as the tools list it: without the tables fitted for the preview."""
    return {key: value for key, value in look.items() if key != "fit"}


def _validated(kind: type[BaseModel], given: BaseModel | None) -> dict:
    """The fields given of a body, as `kind` takes them, or a ToolError saying what it refuses."""
    try:
        return kind.model_validate(given.model_dump(exclude_unset=True) if given else {}).model_dump(mode="json", exclude_unset=True)
    except ValidationError as exc:
        raise ToolError("; ".join(f"{'.'.join(map(str, error['loc']))}: {error['msg']}" for error in exc.errors())) from None


def _dump(kind: type, value: Any) -> Any:
    return TypeAdapter(kind).dump_python(value, mode="json")


def _times(item: dict, *keys: str) -> dict:
    return {key: round(item[key], 2) if isinstance(item[key], float) else item[key] for key in keys}


def _compact(view: dict) -> dict:
    return {key: value for key, value in view.items() if value is not None and value != []}


def _template_view(template: dict) -> dict:
    """A Template as the tools list it: each layer by its list, id, times as saved and Anchor, with
    the edges it is made of; a Text Layer's text too."""
    layers = [
        {
            "kind": kind, "id": layer["item"]["id"], **({"text": layer["item"]["text"]} if "text" in layer["item"] else {}),
            "start": layer["item"]["start"], "secs": layer["item"]["secs"],
            "anchor": _ANCHOR.validate_python(layer["anchor"]).kind.value, "edges": [layer["anchor"]["start"], layer["anchor"]["end"]],
        }
        for kind, listed in template["layers"].items()
        for layer in listed
    ]
    view = {key: template[key] for key in ("id", "name", "created_at", "updated_at")}
    view |= {"intro_secs": template["intro"]["secs"], "outro_secs": template["outro"]["secs"], "layers": layers}
    return view | ({"notices": template["notices"]} if template.get("notices") else {})


_ANCHOR = TypeAdapter(Anchor)


def _template_items(candidate: dict, names: dict[str, str]) -> list[dict]:
    """A Candidate's Template items (of its lists in `candidate`): each by its list and id (a
    Transition by the Segment it follows, a Word Edit or Cue Edit by its time and video), with the
    Template that put it there, by its id and name (`names`), or "deleted"."""
    lists = [*(kind.value for kind in LayerKind), "segments", "transitions", "word_edits", "cue_edits"]
    return [
        {"kind": kind, **_item_key(item), "template_id": item["template"], "template": names.get(item["template"], "deleted")}
        for kind in lists
        for item in candidate.get(kind) or []
        if item.get("template")
    ]


def _item_key(item: dict) -> dict:
    """What names an item of a Candidate's lists: its id, the Segment a Transition follows, or a Word
    Edit's or Cue Edit's time and video."""
    if "id" in item:
        return {"id": item["id"]}
    if "after" in item:
        return {"after": item["after"]}
    return {"at": item["at"], "media": item["media"]}


def _job_view(job: dict) -> dict:
    """A Job without its history and Channel Profile."""
    view = {key: job[key] for key in ("id", "status", "stage", "progress", "message", "error", "warnings")}
    view["source"] = job["url"] or (job["upload"] or {}).get("name")
    view["duration"] = job["source"] and job["source"]["metadata"]["duration"]
    view["retry_at"] = job["quota"] and job["quota"]["retry_at"]
    view |= {key: job[key] for key in ("options", "created_at", "updated_at")}
    return _compact(view)


def _candidate_view(candidate: dict) -> dict:
    """A Candidate without its descriptions and edits."""
    keys = (
        "id", "title", "origin", "start", "end", "predicted_score", "hook_strength", "emotion", "reason",
        "hook_text", "hook_kicker", "layout", "preset_id", "selected", "edited", "revision",
    )
    view = {key: candidate[key] for key in keys}
    view["segments"] = len(candidate["segments"]) or None
    return _compact(view)


def _clip_view(job_dir: Path, clip: dict) -> dict:
    # A queued Clip's Preset is the one asked for; a rendered one's what it was made with.
    view = {"candidate_id": clip["candidate_id"], "status": clip["status"], "error": clip.get("error"), "export_preset_id": clip.get("export_preset_id")}
    if output := clip.get("output"):
        view |= {
            "video_path": str(job_dir / output["video"]),
            "poster_path": str(job_dir / output["poster"]),
            "duration": output["duration"],
            "size_bytes": output["size_bytes"],
            "rendered_at": output["at"],
            "revision": output.get("revision"),
            **{f"{format}_path": str(job_dir / output[format]) for format in ("srt", "vtt") if output.get(format)},
            "export_preset_id": output.get("export_preset_id"),
            "export": output.get("export"),
        }
    return _compact(view)


def _picture_view(picture: dict) -> dict:
    """Where a picture is drawn: its box once turned, in output pixels, its rotation, what its crop
    keeps, in its item's pixels, and its opacity."""
    return {key: picture[key] for key in ("bounds", "rotation", "crop", "opacity")}


def _keys_view(keys: dict, start: float = 0.0) -> dict:
    """Keyframes moved `start` seconds later (into Timeline time), a preset Ease by its name."""
    return {
        prop: [
            {"at": round(start + key["at"], 3), "value": round(key["value"], 4), "ease": ease_name(Ease(*key["ease"])) or key["ease"]}
            for key in given
        ]
        for prop, given in keys.items()
    }


def _motion_view(picture: dict) -> dict:
    """A keyed picture's Keyframes in Timeline time (`_keys_view`), and its bounds at each time any
    property has one (`picture_at`); nothing for an unkeyed one."""
    if not picture["motion"]:
        return {}
    keys = _keys_view(picture["motion"])
    drawn = _PICTURE.validate_python(picture)
    bounds = [{"at": round(at, 3), "bounds": _dump(Box, picture_at(drawn, at).bounds)} for at in key_times(drawn)]
    return {"keys": keys, "bounds_at_keys": bounds}


def _layer_view(event: dict, kind: TypeAdapter, picture_url: Callable[[str], str], *shown: str) -> dict:
    """A picture layer as an agent reads it (`kind` reads its event): its item's id, its times and
    the fields `shown` of its kind, its area once turned and scaled (`bounds`), its picture's URL
    (`picture_url`, by its name), and a keyed one's Keyframes in Timeline time (`_keys_view`) with
    its area's bounds at each time any property has one (`bounds_at`)."""
    view = {"id": event["layer"]["id"], **_times(event, "start", "end", *shown), "bounds": event["bounds"], "picture": picture_url(event["image"])}
    if not event["picture"]["motion"]:
        return view
    drawn = kind.validate_python(event)
    bounds = [{"at": round(at, 3), "bounds": _dump(Box, bounds_at(drawn, at))} for at in key_times(drawn.picture)]
    return view | {"keys": _keys_view(event["picture"]["motion"]), "bounds_at_keys": bounds}


def _plan_view(
    preview: dict, copied: Callable[[dict], bool] = lambda segment: False, picture_url: Callable[[str], str] = lambda name: name
) -> dict:
    """A Preview Plan as an agent reads it: what shows when, in Timeline time (each Segment's span, and
    what of the Source or its video it plays, at what Speed, whether in Reverse and its copy made
    (`copied`), its fades, its Audio Effects (`_effects_view`), its Grade (`_grade_view`) and Video Effects), the Candidate's Grade, each Scene's Layout and the Framing
    that draws its first frame (a Manual Scene's own), where the picture of a Manual Scene, of a
    video's Scene and of each Overlay is drawn (`_picture_view`), an Overlay's Grade and Video
    Effects (`_effects_view`), each Adjustment
    Layer's span, strength, fades, Grade and Video Effects, what of its video an Overlay shows
    (`_video_read`), a keyed one's Keyframes and its bounds at each (`_motion_view`) and an
    animated one's animations (`_animation_view`), a Manual Scene's Keyframes past its end
    (`ignored`), each Transition's kind, span, sound, knobs (null when unset) and the Segment it
    comes `after`, every sound (a Segment's, a Music Clip's, an Overlay's) with its span, fades,
    volume Keyframes, whether it is Muted, a ducked one's depth and where it is turned down (the
    plan's `ducked`), the Segment a Detached one is from, its Audio Effects (`_effects_view`), what a sound at a Speed or in Reverse
    reads (`_video_read`), and whether it is the Source's (`source`, a Music Clip's), each Shape's
    and each Text Layer's (with its lines) box and picture's URL (`picture_url`, by its name) as a
    picture layer's (`_layer_view`), each Segment's Words status (and a failed one's error), the
    Cues (`_cue_view`), the unused Cue Edits and the Words."""
    plan = preview["plan"]
    hook = plan["hook"]
    return {
        "duration": round(plan["segments"][-1]["end"] if plan["segments"] else SegmentTime(plan["start"], plan["end"]).length, 2),
        "words_source": preview["words_source"],
        # The Candidate's Grade, over the whole Main Track; left out when neutral.
        **_compact({"grade": _grade_view(plan["grade"])}),
        "scenes": [
            {
                **_times(scene, "start", "end", "layout", "framing"),
                **(_picture_view(scene["picture"]) | _motion_view(scene["picture"]) if scene["picture"] else {}),
                **({"ignored": _keys_view(scene["ignored"])} if scene["ignored"] else {}),
            }
            for scene in plan["scenes"]
        ],
        "segments": [
            _compact({
                **_times(segment, "id", "start", "end", "source_start", "source_end"), "media": segment["media"], "hold": segment.get("hold"),
                "speed": segment["speed"] if segment["speed"] != 1 else None, "pitch": segment["pitch"] or None,
                "reverse": segment["reverse"] or None, "muted": segment["muted"] or None,
                "fade_in": segment["fade_in"] or None, "fade_out": segment["fade_out"] or None,
                "audio_effects": _effects_view(segment.get("audio_effects", [])),
                "copy": ("ready" if copied(segment) else "made by the render") if segment["reverse"] else None,
                "grade": _grade_view(segment["grade"]), "video_effects": _effects_view(segment.get("video_effects", [])),
                "words_status": preview["words_status"].get(segment["id"]), "words_error": preview["words_errors"].get(segment["id"]),
            })
            for segment in plan["segments"]
        ],
        "transitions": [
            {"after": _ended(plan["segments"], event)["id"], **_times(event, "kind", "start", "end", "sound", "strength", "colour")}
            for event in plan["transitions"]
        ],
        "captions": [_cue_view(cue) for cue in plan["captions"]],
        **_compact({"unused_cue_edits": [_cue_edit_view(edit) for edit in plan["unused_cue_edits"]]}),
        "hook": hook and {
            **_times(hook, "start", "end", "lines"),
            "kicker": hook["kicker"] and hook["kicker"]["text"],
        },
        "shapes": [_layer_view(shape, _SHAPE, picture_url) for shape in plan["shapes"]],
        "text_layers": [_layer_view(text, _TEXT, picture_url, "lines") for text in plan["texts"]],
        "overlays": [
            {
                "id": event["id"], "media": event["media"], **_times(event, "start", "end"), **_picture_view(event["picture"]),
                **_compact({key: event["picture"][key] or None for key in ("radius", "border", "shadow")}),
                **_compact({
                    "grade": _grade_view(event["grade"]), "video_effects": _effects_view(event.get("video_effects", [])),
                    "blend": None if event.get("blend", "normal") == "normal" else event["blend"],
                }),
                **({} if event["image"] else _video_read(event, copied)),
                **_motion_view(event["picture"]),
                **_animation_view(event),
            }
            for event in plan["overlays"]
        ],
        # Over the Main Track and the Overlays, in the order applied; a field at its default left out.
        "adjustment_layers": [
            {
                **_times(event, "id", "start", "end"),
                **_compact({
                    "strength": event["strength"] if event["strength"] != 100 else None,
                    "fade_in": event["fade_in"] or None, "fade_out": event["fade_out"] or None,
                    "grade": _grade_view(event["grade"]), "video_effects": _effects_view(event.get("video_effects", [])),
                }),
            }
            for event in plan["adjustment_layers"]
        ],
        **_compact({"sounds": [
            {
                "id": event["id"], "media": event["media"], **({"source": True} if event.get("source") else {}),
                **_times(event, "start", "end"),
                **({"keys": _keys_view({"volume": event["gain"]}, event["start"])} if event["gain"] else {}),
                **_compact({"fade_in": event["fade_in"] or None, "fade_out": event["fade_out"] or None, "muted": event["muted"] or None}),
                **({"speech": True} if event.get("speech") else {}),
                **({
                    "duck": event["duck"],
                    "speech_spans": [[round(time, 2) for time in span] for span in event["speech_spans"]],
                    "ducked": [[round(time, 2) for time in stretch] for stretch in event["ducked"]],
                } if event.get("duck") is not None else {}),
                **({"detached_from": event["detached_from"]} if event.get("detached_from") else {}),
                **_compact({"audio_effects": _effects_view(event.get("audio_effects", []))}),
                **(_video_read(event, copied) if _retimed(event) else {}),
            }
            # A silent video's Segment and a Freeze frame have no sound.
            for event in plan["segments"] + plan["audio"]
            if not event.get("silent") and event.get("hold") is None
        ]}),
        "words": [_compact({**_times(word, "text", "start", "end", "at"), "media": word["media"], "edit": word["edit"]}) for word in preview["words"]],
    }


def _effects_view(stack: list[dict]) -> list[dict] | None:
    """An item's planned Audio or Video Effects as an agent reads them, in order, each its id and
    settings (the plan's are the enabled ones, a Video Effect's sizes as drawn); None for none."""
    return [{"id": applied["id"], "params": applied["params"]} for applied in stack] or None


def _grade_view(grade: dict) -> dict | None:
    """A Grade as an agent reads it: the dials of its Adjust that aren't neutral, and its Look with its
    intensity when it has one; None for a neutral one."""
    neutral = dataclasses.asdict(Adjust())
    adjust = {dial: value for dial, value in grade["adjust"].items() if value != neutral[dial]}
    looked = {"look": grade["look"], "intensity": grade["intensity"]} if grade["look"] is not None else {}
    return _compact({"adjust": adjust or None, **looked}) or None


def _cue_view(cue: dict) -> dict:
    """A Cue as an agent reads it: when it shows, its lines as shown, its lines as written (`plain`:
    the Words' own case and punctuation, with the Word Edits), its key (the middle of its first
    Word on its timeline, which a Cue Edit names), whether a Cue Edit applies (`edited`, only
    when one does), whether it could be merged into the Cue before (`joinable`) and whether that
    would take a `join` Cue Edit (`needs_join`, only when it would), and where its lines are centred
    (output pixels) at what font size."""
    area = cue["area"]
    return {
        **_times(cue, "start", "end"),
        "lines": [" ".join(word["text"] for word in line) for line in cue["lines"]],
        "plain": cue["plain"],
        "centre": [round(area["x"] + area["width"] / 2), round(area["y"] + area["height"] / 2)],
        "size": cue["size"],
        "key": _compact({"at": round(cue["key"]["at"], 3), "media": cue["key"]["media"]}),
        **({"edited": True} if cue["edited"] else {}),
        "joinable": cue["joinable"],
        **({"needs_join": True} if cue["needs_join"] else {}),
    }


def _cue_edit_view(edit: dict) -> dict:
    """A Cue Edit with only the fields it sets."""
    return {name: value for name, value in edit.items() if name == "at" or value not in (None, 0, 0.0)}


def _ended(segments: list[dict], transition: dict) -> dict:
    """The Segment a Transition takes away: the one it ends, which started before it."""
    return next(s for s in segments if s["start"] < transition["start"] and abs(s["end"] - transition["end"]) < _SAME_SECS)


def _animation_view(event: dict) -> dict:
    """How an Overlay comes on and goes off: each end's animation but none, and their length when it
    has one; nothing unanimated."""
    animated = _compact({key: event[key] if event[key] != "none" else None for key in ("animation_in", "animation_out")})
    return animated | {"animation_ms": event["animation_ms"]} if animated else {}


def _retimed(event: dict) -> bool:
    """Whether a plan's sound event (a Music Clip's or an Overlay's) plays at a Speed or in Reverse."""
    return "offset" in event and (event["speed"] != 1 or event["reverse"])


def _video_read(event: dict, copied: Callable[[dict], bool]) -> dict:
    """What of its video an Overlay shows, or of its song a sound plays: seconds into it, its Speed
    and pitch when not the default, and in Reverse whether its copy is made (`copied`)."""
    read = {"media": event["media"], "source_start": event["offset"], "source_end": event["offset"] + (event["end"] - event["start"]) * event["speed"]}
    return _compact({
        "source_start": round(read["source_start"], 2), "source_end": round(read["source_end"], 2),
        "speed": event["speed"] if event["speed"] != 1 else None, "pitch": event["pitch"] or None, "reverse": event["reverse"] or None,
        "copy": ("ready" if copied(read) else "made by the render") if event["reverse"] else None,
    })


# What identifies an item of each kind within its Candidate.
_KEYS = {kind: key for kind, (_, key) in ITEMS.items()}
# Two times closer than this are the same `at`.
_SAME_SECS = 0.01


def _same(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return a is b
    if isinstance(a, int | float) and isinstance(b, int | float):
        return abs(a - b) < _SAME_SECS
    return str(a) == str(b)


def _same_key(item: dict, other: dict, key: str | tuple[str, ...]) -> bool:
    """Whether `item` and `other` (an item or a patch, a field it lacks being None) have one key."""
    return all(_same(item.get(name), other.get(name)) for name in ((key,) if isinstance(key, str) else key))


def _key_item(key: str | tuple[str, ...], wanted: str | float | CueKey) -> dict:
    """A key `remove_candidate_items` is given (a Word Edit's or Cue Edit's {at, media} is a CueKey),
    as the fields of the item it names."""
    if isinstance(wanted, CueKey):
        return dataclasses.asdict(wanted)
    return {key if isinstance(key, str) else key[0]: wanted}


def _key_shown(wanted: str | float | CueKey) -> object:
    """A key `remove_candidate_items` is given, as a refusal names it."""
    if isinstance(wanted, CueKey):
        return {name: value for name, value in dataclasses.asdict(wanted).items() if value is not None}
    return wanted


def _key_name(key: str | tuple[str, ...]) -> str:
    return key if isinstance(key, str) else "/".join(key)


def _merge(items: list[dict], patches: list[dict], key: str | tuple[str, ...]) -> list[dict]:
    """`items` with each patch merged into the item with its key, or added after them."""
    merged = list(items)
    for patch in patches:
        at = next((i for i, item in enumerate(merged) if _same_key(item, patch, key)), None)
        if at is None:
            merged.append(patch)
        else:
            merged[at] = _merged_fields(merged[at], patch)
    if "at" in ((key,) if isinstance(key, str) else key):
        # In the order the backend saves them (review.py's _timeline_key).
        merged.sort(key=lambda item: (item.get("media") or "", item["at"]))
    return merged


def _merged_fields(item: dict, patch: dict) -> dict:
    """`item` with the fields of `patch`, a field that is an object (a Transform) merged field by field."""
    return item | {
        name: _merged_fields(item[name], value) if isinstance(value, dict) and isinstance(item.get(name), dict) else value
        for name, value in patch.items()
    }


def _patch_model(kind: type, key: str | tuple[str, ...] | None = None) -> type[BaseModel]:
    """A model of `kind` whose fields are all optional but its key (the first of its key's fields):
    the fields of an item to change.
    A field that is itself a dataclass, or one or None (an Overlay's `transform`, or its `border`, a
    Segment's `framing`), is such a patch too, merged into the item's value field by field
    (`_merge`); null turns one that may be None off."""
    hints = get_type_hints(kind, include_extras=True)
    fields: dict[str, Any] = {}
    for field in dataclasses.fields(kind):
        hint = hints[field.name]
        if get_origin(hint) in (Union, types.UnionType):
            hint = next((arg for arg in get_args(hint) if dataclasses.is_dataclass(arg)), hint)
        if dataclasses.is_dataclass(hint):
            hint = _patch_model(hint)
        required = key if isinstance(key, str | None) else key[0]
        fields[field.name] = (hint, ...) if field.name == required else (hint | None, None)
    return create_model(f"{kind.__name__}Patch", __config__=ConfigDict(extra="forbid"), **fields)


def _switched_stroke(shapes: list[dict], patch: dict) -> dict:
    """A Shape's `patch`, which switches one of `shapes` with no stroke to a line or an arrow, with
    the stroke it then needs where the patch doesn't give it, as the editor switches a kind:
    SWITCHED_THICKNESS thick, in its fill's colour (the colour it showed). Any other patch as it is."""
    style = patch.get("style") or {}
    shape = next((shape for shape in shapes if _same(shape["id"], patch["id"])), None)
    if shape is None or style.get("kind") is None or not ShapeKind(style["kind"]).all_stroke or shape["style"]["stroke_width"]:
        return patch
    stroke = {"stroke_width": SWITCHED_THICKNESS, "stroke_colour": shape["style"]["fill"] or shape["style"]["stroke_colour"]}
    return patch | {"style": stroke | style}


_FRAMING_PATCH = _patch_model(Framing)
_GRADE_PATCH = _patch_model(Grade)
_PATCHES = {kind: _patch_model(item, key) for kind, (item, key) in ITEMS.items()}
# The JSON schema of a list of Shapes, where the tools take one: a line, which keeps the agent's
# tools within their budget. The server's instructions say the rest.
_SHAPES_SCHEMA = WithJsonSchema({
    "type": "array",
    "description": f"As Text Layers but style: kind ({','.join(ShapeKind)}),"
    + ",".join(field.name for field in dataclasses.fields(ShapeStyle) if field.name != "kind"),
})
# A CandidateUpdate as edit_candidate takes it, its Shapes in the line above: the same body.
_CandidateChanges = create_model(
    "CandidateUpdate",
    __base__=CandidateUpdate,
    __doc__=CandidateUpdate.__doc__,
    shapes=(Annotated[list[Shape], Field(max_length=SHAPES_MAX), _SHAPES_SCHEMA] | None, None),
)
