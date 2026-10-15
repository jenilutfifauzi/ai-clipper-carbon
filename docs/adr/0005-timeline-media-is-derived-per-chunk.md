# 0005: Filmstrips and Peaks are files derived per 30-second chunk, keyed by their parameters

Status: accepted
Date: 2026-10-15

## Context

The Advanced Edit's Timeline is getting Filmstrips and Waveforms (`timeline-visuals`). Both need data made from the media with ffmpeg: frames for the Filmstrip and Peaks for the Waveform.

- **Sources are long.** An episode runs for hours, but a Candidate shows a minute or so of it.
- **Media items are short and normalized on upload.** That upload is synchronous, one ffmpeg pass that writes the main copy, the proxy and the thumbnail.
- **The Worker runs one heavy tool at a time.** It is built for an 8 GB Mac, and a transcription can hold it for minutes.
- **Nothing keys files by content today.** Media items are uuids and Jobs have ids. Range caches like `words/<startms>-<endms>.json` are named by time.

Concat makes one 24-frame strip for each whole file, finer strips per short cut, and Peaks at 1000 buckets per second, keyed by a hash of the path.

## Decision

- **One time grid for both kinds of media.** A Filmstrip has one frame for each whole second, 112px tall, as a JPEG at quality 75. Peaks are the min and max of each millisecond, mono, as int8.
- **Both are stored in chunks of 30 seconds.** A chunk starts at a multiple of 30 seconds of the Source or the media item. Candidates, trims and pastes of one Job share the same chunks.
- **Keys are paths named by the parameters and a format version. There is no content hash.**
  - For a Source: `jobs/<id>/strips/v1-1fps-h112/<startS>.jpg` and `jobs/<id>/peaks/v1-b1000/<startS>.peaks`.
  - For a media item: `media/<id>.strips/v1-1fps-h112/<startS>.jpg` and `media/<id>.peaks/v1-b1000/<startS>.peaks`.
  - A Source or a media item never changes under its id, so a chunk is never stale. The URLs carry the version and are served as immutable.
  - Changing the format means a new version, so new paths. Old files go when their Job or media item is deleted.
- **When they are made:**
  - **Media items:** in the same ffmpeg pass on upload. Items uploaded before this are filled in on their first request.
  - **Sources:** on demand, one chunk per request, when the Timeline asks for it.
- **The on-demand work runs outside the Worker.** It has its own lock, one ffmpeg at a time, at low priority (`nice`) and with `-threads 1`. It reads `preview.mp4` when the Job has one.

## Considered options

- **Make them while preparing the Candidate, in the Worker.**
  - Filmstrips would wait behind transcription.
  - A Segment trimmed or pasted outside the prepared range would have none.
- **Make them for the whole Source on download.** Minutes of CPU per episode, against transcription, mostly for stretches no Candidate shows.
- **A finer level for deep zoom (4 fps), or Concat's whole-file strips.** That is two kinds of cache or two code paths. Segment ends snap to Words, so frame accuracy on the Timeline is rarely needed.
- **Key by content hash.** It would protect against a file changing under its id, which never happens here. It would also cost a hash of an hour-long file.
- **Frames framed by the Layout.** The tiles would look like the Clip, but every Layout Override would make the cache stale, and they would need face data.

## Consequences

- **The first look at a stretch of a Source waits for its chunk** (one ffmpeg seek and decode of 30 seconds). Later looks are instant, and are cached by the browser too.
- **Uploading a media item takes a little longer.**
- **A transcription and a Filmstrip can run at the same time.** The lock and the low priority keep that to one extra ffmpeg.
- **The Timeline's deepest zoom shows repeated frames.** The 1 fps grid is the only grid.
