"""The MCP server: AI Clipper's workflow as tools for an agent such as Claude Code, served at /mcp by
the app itself (streamable HTTP), in the same process as the API and its Worker.

A tool calls the API's route in this process, so the API's rules and messages are the tools': a
failed call is a tool error carrying the API's `detail`. Three tools call services directly, where no
route fits: `wait_for_job` follows the Job's changes as its events route does, `create_job_from_file`
stages a file on this Mac as an upload, and `add_asset` gives one to the Logo or Media store.
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
from pydantic import AwareDatetime, BaseModel, BeforeValidator, ConfigDict, Field, TypeAdapter, create_model

from app.api import CandidateUpdate, PresetBody, no_old_overlays, no_old_segments
from app.candidates import (
    KICKER_MAX_CHARS,
    Ease,
    Framing,
    LayoutOverride,
    MusicClip,
    Overlay,
    Segment,
    TextLayer,
    Transition,
    WordEdit,
    ease_name,
)
from app.config import REPO_ROOT
from app.events import SETTLED, JobProgress, job_events
from app.jobs import Job, JobNotFound, JobOptions, JobStatus
from app.logos import MAX_UPLOAD_BYTES, BadLogo
from app.media import BadMedia
from app.planner import Box, Picture, key_times, picture_at
from app.profile import ChannelProfile
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
- Text Layers, Music Clips, Overlays, hook_start and the Preview Plan's events are Timeline time:
  seconds into the Clip, from 0.

Edits:
- Candidates can be changed only while the Job is in review or rendering.
- In edit_candidate, a list (text_layers, music, overlays, segments, transitions, word_edits,
  layout_overrides) and style_overrides replace the Candidate's whole list. To add or change some
  items and keep the others, use merge_candidate_items; to drop some, remove_candidate_items.
- The hook is a line or two of text; *word* sets a word in Emphasis. The Kicker is at most
  {KICKER_MAX_CHARS} characters, above the hook.
- Removing or trimming Segments, or changing start/end, leaves Text Layers, Music Clips, Overlays
  and the hook where they are in Timeline time, over other words now. The owner's editors move them
  with the cut while their Magnetic timeline is on; move them yourself when they should follow.
- Music, Overlays and Segments of other videos name Media Library items: add_asset adds a song,
  video or image from a file on this Mac, list_assets lists them.
- An Overlay is placed by its transform. x, y: its centre in output pixels (clamped to 0..1080,
  0..1920; the picture may go past the frame's edges). scale: times its fitted size, the largest that fits the
  1080x1920 frame keeping its aspect (1 fits; a 16:9 picture at 0.5 is 540 px wide). stretch_x,
  stretch_y: times its fitted width and height on top of scale. rotation: degrees clockwise. flip_h,
  flip_v, opacity 0..1. Its crop: left, top, right, bottom, each the fraction 0..0.9 of its
  width or height cut off before it is fitted (a tenth is always kept). merge_candidate_items
  changes only the transform and crop fields given. The dry run lists each Overlay's drawn box once
  turned (bounds) and what its crop keeps, in its item's pixels.
- A Segment of a video needs its framing: a transform and a crop as an Overlay's, and a background
  shown where it doesn't cover the frame ({{"kind": "blur"}}, itself blurred, or {{"kind": "colour",
  "colour": "#rrggbb"}}). Its scale 1 fits the frame; filling it takes a larger one (16:9: 3.16). A
  Segment of the episode has no framing.
- Layout manual frames the episode by hand with a framing, as a video Segment's: a Layout Override
  with "manual" needs its own framing, and the Candidate's layout "manual" needs `framing` (one for
  every Scene without an override); no other Layout has one. A Manual Scene stays still: no face
  tracking. The dry run lists each Scene's layout and the framing that draws its first frame: copy
  it to switch a Scene to Manual without a jump, and its picture's bounds, rotation and crop.
  merge_candidate_items changes only the fields given, of an override's framing or the Candidate's.
- An Overlay's radius rounds its corners, 0..0.5 of its drawn shorter side (0.5: a pill or circle).
  border (width 1..40, colour) and shadow (blur 0..100; x, y -100..100; colour; opacity) are in
  output pixels, or null for none; merge_candidate_items changes only the fields given.
- Keyframes move an Overlay over its length: its `keys` map a property (x, y, scale,
  rotation, opacity) to a list of {{at, value, ease}}. `at` is seconds from the Overlay's start, value
  in the field's own units (rotation -3600..3600, to turn several times). A keyed property's
  transform field is unused. The value holds before the first and after the last Keyframe; between
  two it moves by the later one's ease: linear (the default), ease_in, ease_out, ease_in_out, or a
  cubic-bezier [x1, y1, x2, y2] (x 0..1; y may overshoot). At most 100 per property, 1/30 s apart at
  least. merge_candidate_items replaces the lists of the properties given ([] clears one) and keeps
  the others. Moving an item moves its Keyframes; the server never re-times them, and refuses a
  length that would leave one past its item's end: send its keys too. The dry run lists them in
  Timeline time, with the Overlay's bounds at each.
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

    async def api(method: str, path: str, *, json: Any = None, params: dict | None = None) -> Any:
        """The API route's response (None for 204), or a ToolError with its message."""
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://ai-clipper") as client:
            response = await client.request(method, f"/api{path}", json=json, params=params, headers=EDIT_SOURCE)
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
    async def edit_candidate(job_id: str, candidate_id: str, changes: CandidateUpdate, dry_run: bool = False) -> dict:
        """Change a Candidate and save it: only the fields given change. start and end (Source time)
        are snapped to Words. Lists and style_overrides replace the Candidate's whole list (see
        merge_candidate_items). With changes.revision (the `revision` you read), an edit made after
        someone else's is refused with the Candidate as it is now, instead of saved over it. With
        dry_run, nothing is saved: the Preview Plan of the changes comes back instead, its events in
        Timeline time, and its Words with the `at` a Word Edit names."""
        body = changes.model_dump(mode="json", exclude_unset=True)
        if dry_run:
            return _plan_view(await api("POST", f"/jobs/{job_id}/candidates/{candidate_id}/preview-plan", json=body))
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
        text_layers: list[_PATCHES["text_layers"]] | None = None,  # type: ignore[valid-type]
        music: list[_PATCHES["music"]] | None = None,  # type: ignore[valid-type]
        overlays: Annotated[list[_PATCHES["overlays"]], BeforeValidator(no_old_overlays)] | None = None,  # type: ignore[valid-type]
        segments: Annotated[list[_PATCHES["segments"]], BeforeValidator(no_old_segments)] | None = None,  # type: ignore[valid-type]
        transitions: list[_PATCHES["transitions"]] | None = None,  # type: ignore[valid-type]
        word_edits: list[_PATCHES["word_edits"]] | None = None,  # type: ignore[valid-type]
        layout_overrides: list[_PATCHES["layout_overrides"]] | None = None,  # type: ignore[valid-type]
        style_overrides: StyleOverrides | None = None,
        framing: _FRAMING_PATCH | None = None,  # type: ignore[valid-type]
    ) -> dict:
        """Add or change some of a Candidate's items, keeping the others. An item with the key of
        one the Candidate has (id; a Transition's `after`; a Word Edit's or Layout Override's `at`)
        changes only the fields given; another is added (Segments at the end of the Main Track), and
        needs the fields its kind requires. style_overrides are merged per section (caption, hook,
        watermark), and framing (the Candidate's, for Layout manual) field by field. The Candidate is
        saved once, through the same checks as edit_candidate."""
        given = {
            "text_layers": text_layers, "music": music, "overlays": overlays, "segments": segments,
            "transitions": transitions, "word_edits": word_edits, "layout_overrides": layout_overrides,
        }

        def merged(current: dict) -> dict:
            body: dict[str, Any] = {}
            for kind, patches in given.items():
                if patches is not None:
                    body[kind] = _merge(current[kind], [p.model_dump(mode="json", exclude_unset=True) for p in patches], _KEYS[kind])
            if style_overrides is not None:
                new = _dump(StyleOverrides, style_overrides)
                body["style_overrides"] = {section: {**fields, **new[section]} for section, fields in current["style_overrides"].items()}
            if framing is not None:
                patch = framing.model_dump(mode="json", exclude_unset=True)
                body["framing"] = _merged_fields(current["framing"], patch) if current["framing"] else patch
            return body

        return await save_from_current(job_id, candidate_id, merged)

    @tool()
    async def remove_candidate_items(
        job_id: str,
        candidate_id: str,
        kind: Literal[
            "text_layers", "music", "overlays", "segments", "transitions", "word_edits", "layout_overrides", "style_overrides"
        ],
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
    async def list_presets(include_styles: bool = False) -> dict:
        """The Style Presets: the built-in ones, then the owner's. With include_styles, their
        Caption, Hook and Watermark Styles (the fields a Style Override can replace)."""
        presets = await api("GET", "/presets")
        if not include_styles:
            presets = [{key: p[key] for key in ("id", "name", "builtin")} for p in presets]
        return {"presets": presets}

    @tool()
    async def save_preset(preset: PresetBody, preset_id: str | None = None) -> dict:
        """Save a new Style Preset, or replace the owner's Preset `preset_id` (built-in ones can't be)."""
        body = preset.model_dump(mode="json")
        if preset_id is None:
            return await api("POST", "/presets", json=body)
        return await api("PUT", f"/presets/{preset_id}", json=body)

    @tool(destructive=True)
    async def delete_preset(preset_id: str) -> dict:
        """Delete one of the owner's Style Presets; Candidates using it render in Default."""
        await api("DELETE", f"/presets/{preset_id}")
        return {"deleted": preset_id}

    @tool(read_only=True)
    async def list_assets(kind: Literal["fonts", "logos", "media"] | None = None) -> dict:
        """The fonts text can be set in, the Logos a Watermark can show, and the Media Library (songs,
        videos and images for Music Clips, Overlays and Segments): all, or one `kind`."""
        listed: dict[str, Any] = {}
        if kind in (None, "fonts"):
            listed["fonts"] = [{key: f[key] for key in ("id", "label", "family")} for f in await api("GET", "/fonts")]
        if kind in (None, "logos"):
            listed["logos"] = await api("GET", "/logos")
        if kind in (None, "media"):
            listed["media"] = await api("GET", "/media")
        return listed

    @tool()
    async def add_asset(kind: Literal["logo", "media"], path: str) -> dict:
        """Add a file on this Mac as a Logo (PNG, JPEG or WebP) or to the Media Library (a video of 3
        minutes at most, a song or an image), by its path. The file is left where it is."""
        file = Path(path).expanduser()
        if not file.is_file():
            raise ToolError(f"No file {file}")

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
    async def delete_asset(kind: Literal["logo", "media"], asset_id: str) -> dict:
        """Delete a Logo, or a Media Library item that no Candidate uses."""
        await api("DELETE", f"/{'logos' if kind == 'logo' else 'media'}/{asset_id}")
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
    if isinstance(detail, dict):  # a Media Library item in use
        uses = ", ".join(f"{use['title']} (Job {use['job_id']}, Candidate {use['candidate_id']})" for use in detail.get("uses", []))
        return f"{detail.get('message')}: {uses}" if uses else str(detail.get("message"))
    return str(detail)


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


def _motion_view(picture: dict) -> dict:
    """A keyed picture's Keyframes in Timeline time, a preset Ease by its name, and its bounds at each
    time any property has one (`picture_at`); nothing for an unkeyed one."""
    if not picture["motion"]:
        return {}
    keys = {
        prop: [{"at": round(key["at"], 3), "value": round(key["value"], 4), "ease": ease_name(Ease(*key["ease"])) or key["ease"]} for key in given]
        for prop, given in picture["motion"].items()
    }
    drawn = _PICTURE.validate_python(picture)
    bounds = [{"at": round(at, 3), "bounds": _dump(Box, picture_at(drawn, at).bounds)} for at in key_times(drawn)]
    return {"keys": keys, "bounds_at_keys": bounds}


def _plan_view(preview: dict) -> dict:
    """A Preview Plan as an agent reads it: what shows when, in Timeline time, each Scene's Layout and
    the Framing that draws its first frame (a Manual Scene's own), where the picture of a Manual
    Scene, of a video's Scene and of each Overlay is drawn (`_picture_view`), a keyed one's
    Keyframes and its bounds at each (`_motion_view`), and the Words."""
    plan = preview["plan"]
    hook = plan["hook"]
    return {
        "duration": round(plan["segments"][-1]["end"] if plan["segments"] else plan["end"] - plan["start"], 2),
        "words_source": preview["words_source"],
        "scenes": [
            {**_times(scene, "start", "end", "layout", "framing"), **(_picture_view(scene["picture"]) if scene["picture"] else {})}
            for scene in plan["scenes"]
        ],
        "captions": [_times(caption, "start", "end", "text") for caption in plan["captions"]],
        "hook": hook and {
            **_times(hook, "start", "end", "lines"),
            "kicker": hook["kicker"] and hook["kicker"]["text"],
        },
        "text_layers": [{"id": text["layer"]["id"], **_times(text, "start", "end", "lines")} for text in plan["texts"]],
        "overlays": [
            {
                "id": event["id"], "media": event["media"], **_times(event, "start", "end"), **_picture_view(event["picture"]),
                **_compact({key: event["picture"][key] or None for key in ("radius", "border", "shadow")}),
                **_motion_view(event["picture"]),
            }
            for event in plan["overlays"]
        ],
        "words": [_compact({**_times(word, "text", "start", "end", "at"), "edit": word["edit"]}) for word in preview["words"]],
    }


# What identifies an item of each kind within its Candidate.
_KEYS = {
    "text_layers": "id", "music": "id", "overlays": "id", "segments": "id",
    "transitions": "after", "word_edits": "at", "layout_overrides": "at",
}
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


_FRAMING_PATCH = _patch_model(Framing)
_PATCHES = {
    kind: _patch_model(item, _KEYS[kind])
    for kind, item in {
        "text_layers": TextLayer, "music": MusicClip, "overlays": Overlay, "segments": Segment,
        "transitions": Transition, "word_edits": WordEdit, "layout_overrides": LayoutOverride,
    }.items()
}
