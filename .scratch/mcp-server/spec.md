# MCP server: drive AI Clipper from Claude Code

Status: in progress
Created: 2026-10-15

## Problem Statement

Everything in AI Clipper is done by hand in the browser: pasting a URL, waiting for the Job, reading the Candidates, editing the hook, the Kicker and the Advanced Edit, rendering, finding the MP4. An agent such as Claude Code can't do any of it, so I can't say "make three clips from this episode about money, with a Title on each" and come back to the files. MCP was left out of v1 (`docs/PLAN.md`, `.scratch/ai-clipper-v1/spec.md` Out of Scope); this spec lifts that.

## Solution

An MCP server inside the app, at `http://127.0.0.1:8000/mcp` (streamable HTTP, stateless), in the same process as the REST API and its Worker. `.mcp.json` registers it for Claude Code in this repo; elsewhere it is `claude mcp add --transport http ai-clipper http://127.0.0.1:8000/mcp`.

Its tools cover the whole workflow: Jobs (from a URL or a file on this Mac), waiting with progress, the Transcript by time range, Candidates and every edit the clip editor and the Advanced Edit make, rendering and the Clips' local paths, Style Presets, Logos, the Media Library and the Channel Profile. Its instructions explain the workflow and Timeline time; the Glossary is a resource.

## User Stories

1. As a clipper using Claude Code, I want to start a Job from a YouTube URL, so that the agent can clip an episode for me.
2. As a clipper, I want to start a Job from a file on this Mac by its path, so that a master file isn't uploaded through the browser.
3. As a clipper, I want the agent to list, inspect, retry and delete Jobs.
4. As a clipper, I want the agent to wait for a Job and see its progress, so that it knows when the Candidates are ready or the Clips are rendered.
5. As a clipper, I want the agent to read the Transcript by time range, so that it finds moments without reading a whole episode at once.
6. As a clipper, I want the agent to see the Candidates and why they were picked.
7. As a clipper, I want the agent to select Candidates and change their range, hook text, Kicker, Layout and Style Preset.
8. As a clipper, I want the agent to add a manual Candidate from a Transcript range.
9. As a clipper, I want the agent to try an edit before saving it, so that it sees the captions, hook and Words the Preview Plan gives.
10. As a clipper, I want the agent to add, change and remove Text Layers, Music Clips, Overlays, Segments and Transitions.
11. As a clipper, I want the agent to correct Words (Word Edits) and fix the Layout at a time (Layout Overrides).
12. As a clipper, I want the agent to change a Candidate's Style Overrides and manage Style Presets.
13. As a clipper, I want the agent to add songs, videos and images to the Media Library, and Logos, from files on this Mac.
14. As a clipper, I want the agent to render Clips and give me their local file paths.
15. As a clipper, I want the agent to read and set the Channel Profile.
16. As a clipper, I want the open browser to show the agent's edits as they happen.

## Implementation Decisions

- **SDK:** the official `mcp` Python SDK, v2 (`MCPServer`). `httpx` moves from the dev dependencies to the app's.
- **Mounting:** `MCPServer.streamable_http_app(streamable_http_path="/mcp", stateless_http=True)` builds the route, and that route is added to the FastAPI app ahead of the frontend's catch-all. Not `app.mount("/mcp")`: a mount only matches `/mcp/…`, so `POST /mcp` would fall to the catch-all (405). The catch-all also leaves `mcp` alone, as it does `api` and `media`.
- **Lifespan:** `create_app`'s lifespan runs the MCP session manager around the Worker. A mounted app's own lifespan never runs.
- **Security:** the SDK's default for 127.0.0.1: DNS-rebinding protection, with localhost Hosts and Origins only. No auth, like the REST API.
- **One place for the rules:** a tool calls the REST route in the same process (`httpx.ASGITransport`), so `EDITABLE`, the Media and Logo checks, `CandidateUpdate`'s limits and the error messages are the API's. A failed call is a tool error carrying the API's `detail` (422 errors as `field: message`). Three tools call services directly, because no route fits:
  - `wait_for_job` follows `events.job_events` (an SSE route can't be read through ASGITransport, which buffers);
  - `create_job_from_file` stages a copy of the file in the uploads folder (an APFS clone when it can, after a free-space check otherwise), since `JobStore.create` moves the upload it is given, then creates and submits the Job as `upload_job` does;
  - `add_asset` gives a local file to `LogoStore.add` or `MediaStore.add`, which hold the rules.
- **Typed inputs:** tools take the API's models (`JobOptions`, `CandidateUpdate`, `ManualCandidate`, `PresetBody`, `TextLayer`, `Segment`, `MusicClip`, `Overlay`, `Transition`, `WordEdit`, `LayoutOverride`, `StyleOverrides`, `ChannelProfile`), so the schema the agent sees is the API's.
- **Compact output:** a Job without its Transcript or history; Candidates as a summary until one is asked for whole; Clips with their absolute `video_path` and `poster_path`. The Transcript is read by time range, at most 10 minutes or 400 lines a call, with a `next_start`.
- **Edits:** `edit_candidate` takes a `CandidateUpdate` (its lists replace the whole list, as in the API); with `dry_run` it returns a summary of the Preview Plan instead of saving, including each Word's `at` for Word Edits. `merge_candidate_items` and `remove_candidate_items` change items without restating the rest: they read the Candidate, merge by `id` (Transitions by `after`, Word Edits and Layout Overrides by `at`; Style Overrides per section), field by field (each kind's schema has every field optional but its key), and send one PATCH. `remove_candidate_items` also removes style overrides, by `section.field`.
- **Tools (23):**

  | Group | Tools |
  |---|---|
  | Jobs | `create_job_from_url`, `create_job_from_file`, `list_jobs`, `get_job`, `wait_for_job`, `retry_job`, `delete_job` |
  | Review | `get_transcript`, `get_candidate`, `edit_candidate`, `add_candidate` |
  | Advanced Edit | `merge_candidate_items`, `remove_candidate_items` |
  | Render | `render_clips`, `list_clips` |
  | Styles and assets | `list_presets`, `save_preset`, `delete_preset`, `list_assets`, `add_asset`, `delete_asset`, `get_channel_profile`, `set_channel_profile` |

- **Agent guidance:** the server's instructions give the workflow (create, wait, read, edit, render, wait, list Clips), Source time against Timeline time, which lists replace, when edits are allowed, and the hook's and Kicker's limits and Emphasis. `ai-clipper://glossary` serves `GLOSSARY.md`.
- **Glossary:** a Job is made from a URL, an upload or a file on this Mac. No new terms.
- **ADR-0001 holds:** the agent sends edits; the backend plans.

## Testing Decisions

- Seam A, through MCP: `mcp.Client` connected in-process to `app.state.mcp`, on the app the tests already build with fake ports (the Worker running). The tools then go through the real routes.
- One HTTP smoke test: `initialize` posted to `/mcp` with the built frontend present; a foreign Host is refused.
- A walkthrough in real Claude Code against a real episode.

## Out of Scope

- Auth, or reaching the server from another machine.
- The stdio transport; prompts; sampling.
- Posting Clips anywhere.
- Undoing the agent's edits (the Advanced Edit's undo is the browser's).
- Stills and thumbnails as image content.
- Preparing a Candidate for the editor (`/prepare`): the planner prepares what it needs when it renders.
- Sending a file's bytes through MCP: files are named by their local path.

## Further Notes

- The browser's editor and the agent can save over each other (the editor's draft against `merge_candidate_items`' read-merge-write). One person runs the app, so the instructions say so rather than the API taking versions.
