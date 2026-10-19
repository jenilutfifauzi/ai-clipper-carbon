"""The MCP server: AI Clipper's workflow as tools for an agent such as Claude Code, served at /mcp by
the app itself (streamable HTTP), in the same process as the API and its Worker.

A tool calls the API's route in this process, so the API's rules and messages are the tools': a
failed call is a tool error carrying the API's `detail`. Three tools call services directly, where no
route fits: `wait_for_job` follows the Job's changes as its events route does, `create_job_from_file`
stages a file on this Mac as an upload, and `add_asset` gives one to the Logo or Media store (a font
it posts to the fonts route).
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
    PresetBody,
    TextPresetBody,
    TextPresetChange,
    no_framing_keys,
    no_old_overlays,
    no_old_segments,
    no_old_text_layers,
)
from app.candidates import (
    KICKER_MAX_CHARS,
    SWITCHED_THICKNESS,
    Ease,
    Framing,
    LayoutOverride,
    MusicClip,
    Overlay,
    Segment,
    Shape,
    ShapeKind,
    ShapeStyle,
    TextLayer,
    TextStyle,
    Transition,
    WordEdit,
    ease_name,
)
from app.config import REPO_ROOT
from app.events import SETTLED, JobProgress, job_events
from app.jobs import Job, JobNotFound, JobOptions, JobStatus
from app.fonts import MAX_UPLOAD_BYTES as MAX_FONT_BYTES
from app.logos import MAX_UPLOAD_BYTES, BadLogo
from app.media import BadMedia
from app.planner import Box, Picture, ShapeEvent, TextEvent, bounds_at, key_times, picture_at
from app.profile import ChannelProfile
from app.rendering import source_copies
from app.retimed import CopySize, Retime
from app.segment_time import SegmentTime
from app.styles import StyleOverrides
from app.uploads import UPLOADS_DIR, BadUpload, NotEnoughSpace, stage

GLOSSARY = REPO_ROOT / "GLOSSARY.md"
# The most of the Transcript one call returns: lines within this many seconds, and this many lines.
TRANSCRIPT_PAGE_SECS = 600
TRANSCRIPT_PAGE_LINES = 400
# How long `wait_for_job` waits by default, and at most, before it returns the Job as it is.
WAIT_SECS = 120
WAIT_MAX_SECS = 600
# How often merge_candidate_items and remove_candidate_items make their change again when another
# edit saves first.
STALE_RETRIES = 5
# Who makes the edits the tools save (ADR 0003): the editors send their own.
EDIT_SOURCE = {"X-Edit-Source": "agent"}
# The API's routes of each kind of asset.
ASSET_ROUTES = {"logo": "logos", "media": "media", "font": "fonts"}
# The lists of a Candidate's items, which edit_candidate replaces whole and merge_candidate_items
# and remove_candidate_items change item by item: each list's item, and the field that identifies
# one within its Candidate.
ITEMS: dict[str, tuple[type, str]] = {
    "text_layers": (TextLayer, "id"), "shapes": (Shape, "id"), "music": (MusicClip, "id"), "overlays": (Overlay, "id"),
    "segments": (Segment, "id"), "transitions": (Transition, "after"), "word_edits": (WordEdit, "at"),
    "layout_overrides": (LayoutOverride, "at"),
}

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
   each Clip's video_path.

Times:
- A Candidate's start and end, Segments, the Transcript and Words are Source time: seconds into the
  Source video. A Word Edit's `at` is a Word's start in Source time (dry run lists them).
- Text Layers, Shapes, Music Clips, Overlays, hook_start and the Preview Plan's events are
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
  (source_start, source_end).
  An Overlay comes on and goes off as a Text Layer does: animation_in and animation_out (none, fade,
  pop, slide) over animation_ms (100..2000, 300 by default; each end at most half its secs). They
  move its picture only: a video's sound keeps its volume and Keyframes. The dry run lists them.
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
- The caption and hook styles' shadow is a Text Style's; a Style Override of it sets the fields it
  names ({{"shadow": {{"blur": 8}}}}). The hook's box (block or strips) and the caption highlight box
  have padding_x and padding_y, the highlight box radius too, in output pixels at the style's size;
  null is the default.
- A Segment of a video needs its framing: a transform and a crop as an Overlay's, and a background
  shown where it doesn't cover the frame ({{"kind": "blur"}}, itself blurred, or {{"kind": "colour",
  "colour": "#rrggbb"}}). Its scale 1 fits the frame; filling it takes a larger one (16:9: 3.16). A
  Segment of the episode has no framing.
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
- Layout manual frames the episode by hand with a framing, as a video Segment's: a Layout Override
  with "manual" needs its own framing, and the Candidate's layout "manual" needs `framing` (one for
  every Scene without an override); no other Layout has one. A Manual Scene stays still: no face
  tracking. The dry run lists each Scene's layout and the framing that draws its first frame: copy
  it to switch a Scene to Manual without a jump, and its picture's bounds, rotation and crop.
  merge_candidate_items changes only the fields given, of an override's framing or the Candidate's.
- An Overlay's radius rounds its corners, 0..0.5 of its drawn shorter side (0.5: a pill or circle).
  border (width 1..40, colour) and shadow (blur 0..100; x, y -100..100; colour; opacity) are in
  output pixels, or null for none; merge_candidate_items changes only the fields given.
- Keyframes move an Overlay, a Text Layer, a Shape, a video Segment's framing or a Manual Layout Override's, over its length: its `keys` map a
  property (x, y, scale, rotation, opacity) to a list of {{at, value, ease}}. A Music Clip's, a video
  Overlay's and a video Segment's `volume` (0..2) can be keyed too: the fades multiply it. A Segment
  of the episode, another Layout and the Candidate's own framing have none. `at` is seconds from the
  item's start (a Segment's: where it starts in the Clip, its `start` in the video; a Manual
  override's: its Scene's start on the Source's timeline, so every Segment showing that Scene moves
  alike; the dry run lists those past the Scene's end as `ignored`), value in the field's own units (rotation -3600..3600, to
  turn several times). A keyed property's transform field is unused. The value holds before the
  first and after the last Keyframe; between two it moves by the later one's ease: linear (the
  default), ease_in, ease_out, ease_in_out, or a cubic-bezier [x1, y1, x2, y2] (x 0..1; y may
  overshoot). At most 100 per property, 1/30 s apart at least. merge_candidate_items replaces the
  lists of the properties given ([] clears one) and keeps the others. Moving an item moves its
  Keyframes; the server never re-times them, and refuses a length or a Segment's range that would
  leave one past its item's end: send its keys too. The dry run lists them in Timeline time, with
  the picture's bounds at each (an Overlay's, a Text Layer's or Shape's box or a Scene's); a keyed
  volume's under `sounds`. A Text Layer's, a Shape's and an Overlay's animations (fade, pop, slide)
  play on top of its keyed values.
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
  the Clip, its sound and the knobs set.
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

    async def api(method: str, path: str, *, json: Any = None, params: dict | None = None, files: dict | None = None) -> Any:
        """The API route's response (None for 204), or a ToolError with its message."""
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://ai-clipper") as client:
            response = await client.request(method, f"/api{path}", json=json, params=params, files=files, headers=EDIT_SOURCE)
        if response.is_success:
            return None if response.status_code == 204 else response.json()
        if (current := _stale_candidate(response)) is not None:
            raise StaleCandidate(_message(response), current)
        raise ToolError(_message(response))

    async def candidate(job_id: str, candidate_id: str) -> dict:
        job = await api("GET", f"/jobs/{job_id}")
        found = next((c for c in job["candidates"] or [] if c["id"] == candidate_id), None)
        if found is None:
            raise ToolError(f"Job {job_id} has no Candidate {candidate_id}")
        return found

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
        """A Candidate whole: its range, hook, titles and descriptions, and every edit made to it."""
        return await candidate(job_id, candidate_id)

    @tool()
    async def edit_candidate(
        job_id: str, candidate_id: str, changes: Annotated[_CandidateChanges, BeforeValidator(new_titles)], dry_run: bool = False
    ) -> dict:
        """Change a Candidate and save it: only the fields given change. start and end (Source time)
        are snapped to Words. Lists and style_overrides replace the Candidate's whole list (see
        merge_candidate_items). With changes.revision (the `revision` you read), an edit made after
        someone else's is refused with the Candidate as it is now, instead of saved over it. With
        dry_run, nothing is saved: the Preview Plan of the changes comes back instead, its events in
        Timeline time, and its Words with the `at` a Word Edit names."""
        body = changes.model_dump(mode="json", exclude_unset=True)
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
        style_overrides: StyleOverrides | None = None,
        framing: Annotated[_FRAMING_PATCH, BeforeValidator(no_framing_keys)] | None = None,  # type: ignore[valid-type]
    ) -> dict:
        """Add or change some of a Candidate's items, keeping the others. An item with the key of
        one the Candidate has (id; a Transition's `after`; a Word Edit's or Layout Override's `at`)
        changes only the fields given; another is added (Segments at the end of the Main Track), and
        needs the fields its kind requires. style_overrides are merged per section (caption, hook,
        watermark) and a shadow by its fields, and framing (the Candidate's, for Layout manual)
        field by field. The Candidate is saved once, through the same checks as edit_candidate."""
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
            return body

        return await save_from_current(job_id, candidate_id, merged)

    @tool()
    async def remove_candidate_items(
        job_id: str,
        candidate_id: str,
        kind: Literal[*ITEMS, "style_overrides"],  # type: ignore[valid-type]
        keys: list[str | float],
    ) -> dict:
        """Remove some of a Candidate's items of one kind, by key: ids; a Transition's `after`; a
        Word Edit's or Layout Override's `at`; for style_overrides, "section.field" (such as
        "caption.size"), which then falls back to the Style Preset's."""

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
            for wanted in keys:
                if not any(_same(item[key], wanted) for item in items):
                    raise ToolError(f"Candidate {candidate_id} has no {kind} item with {key} {wanted}")
            return {kind: [item for item in items if not any(_same(item[key], wanted) for wanted in keys)]}

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
    async def render_clips(job_id: str, candidate_ids: list[str] | None = None) -> dict:
        """Render Clips of the selected Candidates, or of `candidate_ids`, one at a time, replacing
        Clips rendered before. The Job is rendering until they are done: wait_for_job, then list_clips."""
        body = None if candidate_ids is None else {"candidate_ids": candidate_ids}
        return {"clips": clips(job_id, await api("POST", f"/jobs/{job_id}/render", json=body))}

    @tool(read_only=True)
    async def list_clips(job_id: str) -> dict:
        """The Job's Clips in their Candidates' order, each rendered one with its MP4 (video_path) and
        poster on this Mac."""
        return {"clips": clips(job_id, await api("GET", f"/jobs/{job_id}/clips"))}

    # Styles, assets and the Channel Profile

    @tool(read_only=True)
    async def list_presets(kind: Literal["style", "text"] = "style", include_styles: bool = False) -> dict:
        """The Style Presets, or the Text Presets (`default`: used for new titles): built-in ones,
        then the owner's. With include_styles, their styles (a Style Override replaces their fields)."""
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
        preset: PresetBody | TextPresetGiven | None = None,
        preset_id: str | None = None,
        kind: Literal["style", "text"] = "style",
        use_for_new_titles: bool = False,
    ) -> dict:
        """Save a new Preset, or replace the owner's Preset `preset_id` (built-in ones can't be). A
        Text Preset is {name, style}. use_for_new_titles: new Text Layers copy it (a built-in one's
        preset_id alone)."""
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
    async def delete_preset(preset_id: str, kind: Literal["style", "text"] = "style") -> dict:
        """Delete one of the owner's Presets. Candidates using a Style Preset render in Default; Text
        Layers keep their look."""
        await api("DELETE", f"/{'text-presets' if kind == 'text' else 'presets'}/{preset_id}")
        return {"deleted": preset_id}

    @tool(read_only=True)
    async def list_assets(kind: Literal["fonts", "logos", "media"] | None = None) -> dict:
        """The fonts' Faces (a style's font is a Face's id), the Logos a Watermark can show, and the
        Media Library (songs, videos and images for Music Clips, Overlays and Segments): all, or one
        `kind`."""
        listed: dict[str, Any] = {}
        if kind in (None, "fonts"):
            listed["fonts"] = [_face(face) for face in await api("GET", "/fonts")]
        if kind in (None, "logos"):
            listed["logos"] = await api("GET", "/logos")
        if kind in (None, "media"):
            listed["media"] = await api("GET", "/media")
        return listed

    @tool()
    async def add_asset(kind: Literal["logo", "media", "font"], path: str) -> dict:
        """Add a file on this Mac, by its path, as a Logo (PNG, JPEG or WebP), to the Media Library (a
        video of 3 minutes at most, a song or an image), or as a font (TTF, OTF or TTC). The file is
        left where it is. A font gives the Faces added, those already there (existing) and warnings."""
        file = Path(path).expanduser()
        if not file.is_file():
            raise ToolError(f"No file {file}")
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

    @tool(destructive=True)
    async def delete_asset(kind: Literal["logo", "media", "font"], asset_id: str) -> dict:
        """Delete a Logo, or a Media Library item or an imported font's Face that nothing uses."""
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

    return mcp


class TextPresetGiven(BaseModel):
    """A Text Preset: a name and a Text Style, as a Text Layer's."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    style: dict[str, Any] | None = None


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
    view = {"candidate_id": clip["candidate_id"], "status": clip["status"], "error": clip.get("error")}
    if output := clip.get("output"):
        view |= {
            "video_path": str(job_dir / output["video"]),
            "poster_path": str(job_dir / output["poster"]),
            "duration": output["duration"],
            "size_bytes": output["size_bytes"],
            "rendered_at": output["at"],
            "revision": output.get("revision"),
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
    (`copied`)), each Scene's Layout and the Framing
    that draws its first frame (a Manual Scene's own), where the picture of a Manual Scene, of a
    video's Scene and of each Overlay is drawn (`_picture_view`), what of its video an Overlay shows
    (`_video_read`), a keyed one's Keyframes and its bounds at each (`_motion_view`) and an
    animated one's animations (`_animation_view`), a Manual Scene's Keyframes past its end
    (`ignored`), each Transition's kind, span, sound, knobs set and the Segment it comes `after`, the keyed
    sounds' volume Keyframes (a video Segment's, a Music Clip's, an Overlay's), each Shape's and
    each Text Layer's (with its lines) box and picture's URL (`picture_url`, by its name) as a
    picture layer's (`_layer_view`), and the Words."""
    plan = preview["plan"]
    hook = plan["hook"]
    return {
        "duration": round(plan["segments"][-1]["end"] if plan["segments"] else SegmentTime(plan["start"], plan["end"]).length, 2),
        "words_source": preview["words_source"],
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
                "reverse": segment["reverse"] or None,
                "copy": ("ready" if copied(segment) else "made by the render") if segment["reverse"] else None,
            })
            for segment in plan["segments"]
        ],
        "transitions": [
            {"after": _ended(plan["segments"], event)["id"], **_times(event, "kind", "start", "end", "sound"), **_compact(_times(event, "strength", "colour"))}
            for event in plan["transitions"]
        ],
        "captions": [_times(caption, "start", "end", "text") for caption in plan["captions"]],
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
                **({} if event["image"] else _video_read(event, copied)),
                **_motion_view(event["picture"]),
                **_animation_view(event),
            }
            for event in plan["overlays"]
        ],
        **_compact({"sounds": [
            {"id": event["id"], "media": event["media"], **_times(event, "start", "end"), "keys": _keys_view({"volume": event["gain"]}, event["start"])}
            for event in plan["segments"] + plan["audio"]
            if event["gain"]
        ]}),
        "words": [_compact({**_times(word, "text", "start", "end", "at"), "edit": word["edit"]}) for word in preview["words"]],
    }


def _ended(segments: list[dict], transition: dict) -> dict:
    """The Segment a Transition takes away: the one it ends, which started before it."""
    return next(s for s in segments if s["start"] < transition["start"] and abs(s["end"] - transition["end"]) < _SAME_SECS)


def _animation_view(event: dict) -> dict:
    """How an Overlay comes on and goes off: each end's animation but none, and their length when it
    has one; nothing unanimated."""
    animated = _compact({key: event[key] if event[key] != "none" else None for key in ("animation_in", "animation_out")})
    return animated | {"animation_ms": event["animation_ms"]} if animated else {}


def _video_read(event: dict, copied: Callable[[dict], bool]) -> dict:
    """What of its video an Overlay shows: seconds into it, its Speed and pitch when not the default,
    and in Reverse whether its copy is made (`copied`)."""
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
    if isinstance(a, int | float) and isinstance(b, int | float):
        return abs(a - b) < _SAME_SECS
    return str(a) == str(b)


def _merge(items: list[dict], patches: list[dict], key: str) -> list[dict]:
    """`items` with each patch merged into the item with its key, or added after them."""
    merged = list(items)
    for patch in patches:
        at = next((i for i, item in enumerate(merged) if _same(item[key], patch[key])), None)
        if at is None:
            merged.append(patch)
        else:
            merged[at] = _merged_fields(merged[at], patch)
    if key == "at":
        merged.sort(key=lambda item: item["at"])
    return merged


def _merged_fields(item: dict, patch: dict) -> dict:
    """`item` with the fields of `patch`, a field that is an object (a Transform) merged field by field."""
    return item | {
        name: _merged_fields(item[name], value) if isinstance(value, dict) and isinstance(item.get(name), dict) else value
        for name, value in patch.items()
    }


def _patch_model(kind: type, key: str | None = None) -> type[BaseModel]:
    """A model of `kind` whose fields are all optional but its key: the fields of an item to change.
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
        fields[field.name] = (hint, ...) if field.name == key else (hint | None, None)
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
