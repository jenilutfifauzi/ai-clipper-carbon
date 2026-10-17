# 06: Retimed copies, and a reversed media Segment

**Parent spec:** `spec.md` in this feature folder (user stories 17, 19, 22–23; Solution "Reverse"; Implementation Decisions "Retimed copies", "The renderer", "The preview"); ADR 0009, ADR 0005.

**What to build:** the agent can reverse a media Segment. Its range is reversed once into a Retimed copy, the preview plays that copy, and the render reads it, at the Segment's Speed. Through MCP; the Reverse switch comes in 08.

- **Retimed copies.**
  - A file of a range of a Source or media item, reversed, picture and sound, in two sizes: from the proxy (preview) and from the full video (render).
  - Made with ffmpeg in short pieces, each reversed, joined last to first, written under a temporary name and renamed when complete, so memory stays bounded at any length.
  - Kept beside the Job or the media item, named by kind, size and range in ms. Removed with their Job or item.
  - Lookup: any reversed copy of the same item and size whose range covers the one wanted, read from `b − d` for `c..d` of a copy of `a..b`.
  - Made off the Worker behind its own lock at low priority, latest request first, as Source chunks are (ADR 0005). Progress reported to the editor.
- **Model.** `reverse` on the Segment (false by default). Through the mapping, its left edge on the Timeline is the end of its range.
- **Renderer.** A reversed media Segment reads its full-size copy (making it inside the render if missing), then Speed and pitch as in 02.
- **Preview.** Switching Reverse on asks for the preview copy. The Segment plays the copy on its own video at its Speed. While the copy is being made it shows the first frame it will show, held, with "Reversing… n%", and the Timeline time runs on.
- **MCP.** `reverse` through the edit tools; the instructions' Reverse paragraph; the dry run says whether the copy is ready.

**Blocked by:** 02.

**Status:** done

- [x] A reversed media Segment of the test video renders with its frame counter counting down and its tone sweep running backwards.
- [x] At 2× and reversed, it lasts half its range and counts down by two.
- [x] A copy of `a..b` serves a Segment of `c..d` inside it without making another; a range reaching outside makes a new one.
- [x] Reversing a 3-minute range of a 1080p video keeps the process's memory under a set bound.
- [x] A render with no copy makes the full-size one and succeeds; an interrupted copy leaves no file under the final name.
- [x] The preview shows the held first frame with progress until the copy is ready, then plays it backwards at its Speed.

## Comments

**2026-10-17: done.**

**The Retimed copies module, `backend/app/retimed.py`, for 07, 08 and 09 to reuse:**
- `CopySize` (`preview`, `full`). `Retime(start, end, reverse=True, speed=1, pitch=False)`: what a copy plays. `.name(size)` gives `reversed-full-1500-4250.mp4` (start floored, end ceiled to ms) or, at a Speed, `retimed-preview-0-3000-x8[-pitch][-reversed].mp4`; `Retime.named(name)` reads one back (None for any other file, so it also guards the file route); `.covers(other)`: retimed alike, over a range holding `other`'s.
- `Copy(path, size, retime)`: `.at(start, end)` is seconds into the copy where it shows `start..end` of its item (`b − end` reversed, `start − a` forwards, divided by its Speed); `.read(time: SegmentTime)` is how a 1× copy plays a Segment's (or Scene's) range: forwards from `at`, at `time`'s Speed.
- `Copies(folder, videos: {CopySize: Path}, frame=(width, height, fps))` for one item: `.find(size, retime)` (the smallest complete covering copy), `.make(ffmpeg, size, retime, progress, threads)` (now, in this thread: the render's, in the Worker, not niced, no lock), `.ask(ffmpeg, size, retime, threads)` (the editor's: a thread waits for the module's own `_LatestFirst` lock `_retiming`, latest ask first, ffmpeg under `nice`; returns `Making(progress, copy, error)`; an ask for a range inside one being made returns that one's progress; a failure is told once, then the next ask tries again).
- Made in pieces of `piece_secs(w, h, fps)`: as many frames as `PIECE_BYTES` (128 MiB of yuv420p) holds, within 0.5–10 s (1080p30: 1.4 s; a 640×360 media item: 10 s). Each piece: accurate seek, `reverse`/`areverse` (then `setpts`+`speed_filters` at a Speed), H.264 + PCM in a `.mov`; joined last to first by the concat demuxer with a `duration` per piece (without it the pieces' frame-rounded lengths drift, 1.4 s over 3 minutes at 10 fps), picture copied, sound to AAC, `+faststart`. Written as `.<name>.<uuid>.part.mp4` beside `.<name>.<uuid>.pieces/`, both removed in `finally`. A preview copy is shrunk to 1280 px at most and has a keyframe each second.
- `read_from_copies(plan, files, copy_of)`: the Render Plan as the renderer reads it. A reversed media Segment's `SegmentPlan` gets `media = str(copy path)`, `source_start/end` = `copy.read(time)`, `reverse=False`, and the copy goes into `files` under that key. The renderer and `frames.VideoDecode` are unchanged: they read a forward range of a "video" at the Segment's Speed. `rendering._render` calls it after writing the plan file (which keeps the real plan), making missing full-size copies as a render step.
- `MediaStore.retimed(media_id)` → `Copies(media/<id>.retimed, {preview: proxy, full: file}, (w, h, 30))`; removed with the item by the existing `<id>.*` cleanup. A Job's copies go in `jobs/<id>/retimed/` (`RETIMED_DIR`), removed with the Job directory.

**API:** `POST /api/media/{id}/retimed` with `{start, end, reverse=true, speed=1, pitch=false}` → `RetimedCopy {progress, url, at, error}`; the editor polls it (every 0.5 s) until `url`. 404 for an item that isn't a video, 422 for a range outside it or a forward 1× one. `GET /api/media/{id}/retimed/{name}` serves a copy (immutable cache headers). `_retimed_copy(making, retime, url_of_name)` in `api.py` builds the answer: 07 can add `POST /api/jobs/{id}/retimed` with `Copies(job_dir / RETIMED_DIR, {preview: job_dir / (source.preview or source.video), full: job_dir / source.video}, (w, h, fps))` and URLs `/media/{job_id}/retimed/{name}` (the existing Job file route already serves `.mp4`s in the Job's directory).

**Frontend:** `pages/job/editor/retimedCopy.ts`: `useRetimedCopy(media, start, end)` (asks, polls, keeps made copies in a module map so a Segment shown again plays at once; null media → null) and `mediaPlay(segment, end, copy)` → `{src, span}` for `follow`: forwards as before; reversed, the copy from `at` at the Segment's Speed, or until it is made the proxy held (a `hold` span) at `source_end − 1/30`. `MediaSegment` uses them and shows "Reversing… n%" (or "Couldn't reverse this video") inside its box. `ClipSegment.reverse` in `api.ts`.

**MCP:** `reverse` flows through `CandidateUpdate`/`_PATCHES` from the model. Instructions: three lines after the video Speed paragraph. Dry run: a reversed Segment's entry has `reverse: true` and `copy: "ready" | "made by the render"` (its full-size copy). The tool list is 60 691 bytes, within 61 000 (03 and 04 add fields too: after merging, check it).

**Decided differently, or for later tickets:**
- **A reversed Source Segment is refused** in the model ("only a video's Segment can"), until 07 lifts it. `read_from_copies` only rewrites media Segments; for 07 a Source copy as a "media" input would lose the Clip's `source_volume` and the plain-concat path (`segment.media is None` checks in `_source_inputs`), so 07 should rewrite with care (or teach the renderer a per-Segment read).
- **Frames:** a reversed copy's frames keep the forward times of their piece, so the copy shows the frame one frame earlier than the exact mirror (at copy time 0, the frame just before `b`). The preview's held frame is chosen to match (`source_end − 1/30`).
- **For 09:** a copy at a Speed is made (`setpts=PTS/speed` and the render's `speed_filters`) and tested only for its length; its picture isn't brought to a frame rate (its last frame keeps its 1× length, a frame or two long). The `.part`/`.pieces` leftovers of a process killed mid-copy are hidden files in the copies' folder: the sweep should remove those not being written (`_asked` lists the ones in progress).
- **The memory test** reverses 3 minutes of a 1080p video at 5 fps (to keep it to ~40 s) and measures the largest child's peak RSS: about 580 MB (most of it the decoder's and x264's; the frames in `reverse` are at most 128 MiB), bound 768 MB; the whole range at once would be 2.8 GB.
- Tests: `backend/tests/test_retimed_copies.py` (names and lookup, real copies backwards in picture and sound, covering, interrupted, background ask and failure, memory, API, model/MCP refusals and dry run, a real render at 1× and 2× reversed that makes one full copy serving both); `test_freeze_frame.py`'s Reverse case runs; `frontend/src/pages/job/editor/retimedCopy.test.ts` (plays its copy at its Speed; the held frame while it is made, the Timeline time running on).
