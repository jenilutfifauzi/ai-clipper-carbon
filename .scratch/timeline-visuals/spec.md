# Filmstrips, Waveforms, Volume Lines and Fade Ramps on the Advanced Edit's Timeline

Status: ready-for-agent
Created: 2026-10-15

## Problem Statement

The Advanced Edit's Timeline shows where things are, but not what they look or sound like.

- **The video is blind.** Source Segments show only the Scenes row's Layout labels. A media Segment shows its first frame, tiled along it. To find the moment where the speaker turns, the owner has to scrub the player.
- **The sound is invisible.** A Music Clip is a coloured bar with its name and a volume %. The owner can't see where a song's beat drops, or where the speech is loud or quiet.
- **Volume and fades live only in the inspector.** The owner sets a number and then listens. Nothing on the Timeline shows how loud an item is, or how a song fades in.
- **Getting back to the whole Clip, or onto one item, takes several zoom steps.**
- **Concat has all of this:** filmstrips on video clips, waveforms from precomputed peaks, a draggable volume line, fade ramps and zoom to fit.

## Solution

The Timeline draws **Filmstrips** and **Waveforms**. Picked items get a **Volume Line** and **Fade Ramps** to drag, and the Timeline's bar gets a **Zoom to fit** button. See GLOSSARY.md and ADR 0005 (Filmstrips and Peaks are files derived per 30-second chunk).

**Filmstrip**
- **Source Segments** fill the Video row with frames of the Source as it is, one for each whole second. The Scenes' Layout labels, once drawn on a layer under the Segments that the frames would hide, sit over the frames as small dark chips, along the whole Video row.
- **Media Segments of a video** do the same with the media item's frames. An image Segment keeps its tiled picture.
- **Each tile** is as wide as a frame at the row's height. It shows the frame under the middle of its visible part. When zoomed in far, neighbouring tiles show the same frame.

**Waveform**
- **Music Clips** show their song's Waveform across their height.
- **Media Segments with sound, and Source Segments,** show a thin Waveform along the bottom of the Video row, over the Filmstrip.
- **The Waveform is drawn as it will be heard:** scaled by the item's volume and its fades. On Source Segments it uses the Clip's own sound's volume.

**Volume Line**
- **Every Music Clip and media Segment with sound** shows a thin line at its volume (a silent video or an image has none, as in the inspector). 100% sits at two thirds of the height and 200% at the top, on a curve that gives the quiet range room.
- **On a picked item,** the line can be dragged up and down. A label shows the %, and the Waveform reshapes live. Releasing the drag ends one step of undo. In a lane shorter than 120 px (a phone's Music lane is 35 px), a drag goes as if over 120 px, so that a small move is a small change (added after the walkthrough).
- **Source Segments have no Volume Line.** The Clip's own sound keeps its one volume, in the inspector.

**Fade Ramp**
- **Every Music Clip** draws its fade in and fade out as slopes at its ends.
- **On a picked Music Clip,** each slope has a handle at its top that drags the fade's length. A label shows the seconds. One drag is one step of undo.

**Zoom to fit.** A Fit button beside the zoom buttons, on the desktop and on the phone.
- **With a Pick,** it zooms so that what is picked fills the Timeline, and scrolls to it.
- **With nothing picked,** it goes back to 1× (the whole Clip) at the start.
- **Zoom stops at 40×.** A Pick too short to fill the Timeline is centred at 40×.

**While frames or Peaks are being made,** the item shows its plain lane colour. They fade in when they arrive. A media item uploaded before this feature shows its old single thumbnail until then.

## User Stories

**Filmstrip**
1. As an owner, I want Source Segments to show the Source's frames along them, so that I can find a moment on the Timeline without scrubbing the player.
2. As an owner, I want media Segments of a video to show their own frames rather than one frame tiled, so that I can tell two pieces of the same video apart.
3. As an owner, I want each tile to show the frame under its middle at every zoom, so that the strip always matches the time under it.
4. As an owner, I want the Filmstrip of a Segment that starts mid-tile to stay aligned with time while I scroll, so that frames don't jump about.
5. As an owner, I want a trimmed Segment's Filmstrip to follow its new range live while I drag its edge, so that I see the frame I am cutting at.
6. As an owner, I want a Segment I drag to a new place to carry its frames with it, so that the strip always belongs to its Segment.
7. As an owner, I want each Scene's Layout label shown over the frames, so that I still see how each Scene is framed.
8. As an owner, I want the Filmstrip to show the video as it is, not cropped by the Layout, so that it looks the same however I change the framing.
9. As an owner, I want an image Segment to keep showing its picture, so that it is recognisable.
10. As an owner, I want frames to appear soon after I open a Candidate or scroll to a new stretch, without blocking the Timeline, so that I can keep editing while they load.
11. As an owner, I want a stretch I have seen before to show at once, even after a reload, so that going back and forth is smooth.
12. As an owner, I want Candidates of the same Job to reuse the frames already made, so that opening a second Candidate is quick.
13. As an owner, I want the frames of a video I upload to be ready when the upload finishes, so that its Segments never look empty.
14. As an owner, I want videos I uploaded before this feature to get frames the first time they are shown, so that I don't need to upload them again.
15. As an owner, I want loading frames to appear quietly (a plain lane, then a short fade-in), so that the Timeline doesn't flicker or pulse.

**Waveform**
16. As an owner, I want Music Clips to show their song's Waveform, so that I can place a cut on the beat.
17. As an owner, I want a Music Clip that starts partway into its song to show the Waveform of the part that plays, so that the shape matches what I hear.
18. As an owner, I want media Segments with sound to show their Waveform, so that I can see where their sound is.
19. As an owner, I want Source Segments to show the speech's Waveform under the frames, so that I can see pauses and loud moments.
20. As an owner, I want silent videos to show no Waveform, so that an empty shape doesn't suggest sound.
21. As an owner, I want the Waveform drawn louder or quieter as I change the volume (on the Timeline or in the inspector), so that I see what I will hear.
22. As an owner, I want the Waveform sloped where a Music Clip fades, so that the fade is visible in the sound too.
23. As an owner, I want the Waveform sharp at every zoom, from the whole Clip to 40×, so that it is useful for both overview and detail.

**Volume Line**
24. As an owner, I want a line on every Music Clip and media Segment at its volume, so that I can compare levels at a glance.
25. As an owner, I want to drag the line of a picked item to set its volume, so that I can mix on the Timeline.
26. As an owner, I want the range around 100% to move finely and 0% to be reachable at the bottom, so that small changes are easy and silence is possible.
27. As an owner, I want a % label while dragging, so that I know the exact level.
28. As an owner, I want dragging one item's line to change only that item, even when several are picked, so that I can mix them one by one.
29. As an owner, I want one drag to undo as one step, even if I pause while holding, so that one Cmd+Z takes back one gesture.
30. As an owner, I want the inspector's volume to follow the line while I drag, so that both show the same value.
31. As an owner on a phone, I want the line draggable only once the item is picked, so that moving a clip doesn't change its volume by accident.
32. As an owner on a phone, I want the line's touch area large enough for a finger, so that I can grab it on the first try.
33. As an owner, I want Source Segments to have no line, so that I don't think I am setting one Segment's volume when the Clip's sound has one volume.
34. As an owner, I want a locked Track's lines shown but not draggable, so that the lock guards volumes too.

**Fade Ramp**
35. As an owner, I want each Music Clip's fades drawn as slopes at its ends, so that I see how it comes in and goes out.
36. As an owner, I want to drag a fade's handle on a picked Music Clip to set its length, so that I don't need the inspector.
37. As an owner, I want a seconds label while dragging a fade, so that I know its length.
38. As an owner, I want a fade never longer than 10 seconds, and the two fades never crossing, so that a drag can't make an impossible fade.
39. As an owner, I want trimming a Music Clip shorter than its fades to shorten them, so that it stays valid.
40. As an owner, I want one fade drag to be one step of undo.
41. As an owner, I want a locked Music Track's fade handles not to drag, so that the lock is consistent.

**Zoom to fit**
42. As an owner, I want a Fit button that zooms to what I picked, so that I can work on one item in detail in one tap.
43. As an owner, I want Fit on several picked items to show all of them, so that I can see a group together.
44. As an owner, I want Fit with nothing picked to show the whole Clip from its start, so that I can get my bearings.
45. As an owner, I want a Pick too short to fill the Timeline centred at the deepest zoom, so that Fit always shows it.
46. As an owner, I want Fit on a picked join to centre the join without changing the zoom, so that I can look at it at once.
47. As an owner on a desktop, I want a shortcut for Fit, so that I don't reach for the mouse.

**Performance**
48. As an owner on a phone, I want scrolling and pinching the Timeline to stay smooth with frames and Waveforms on, so that the new pictures don't make editing worse.
49. As an owner on a phone, I want the Timeline not to use so much memory that the browser reloads the page, so that I don't lose my place.
50. As an owner, I want frames being made for a Source not to slow a transcription much, so that the Mac stays usable while both run.
51. As an owner, I want scrolling past stretches quickly not to queue work for frames I've already left, so that the stretch I stop at loads first.

## Implementation Decisions

**No model change.** `MusicClip.volume` (0–2), `fade_in` and `fade_out` (0–10 s) and `Segment.volume` already exist. The Render Plan, the renderer, the Revision merge and the MCP server are unchanged. The planner changes in one place, agreed with the owner after review: a Music Clip's fades, when together longer than what is heard of it, are both shortened by the same share (before, each was cut to half of it). So a 7 s fade in on a 10 s Music Clip, already saved, now renders 7 s long, as the Timeline draws it. The Timeline draws the fades by a copy of that rule, tested on the planner's worked examples. ADR 0001 holds: the backend plans, and the frontend draws. Filmstrips and Peaks are drawing data, not the plan.

**Derived media, as in ADR 0005.** One time grid for Sources and media items: chunks of 30 seconds, each starting at a multiple of 30 seconds of the Source or the item.
- **A Filmstrip chunk** is one JPEG at quality 75, frames laid out left to right.
  - It holds the frames at `start + i` seconds, for `i` from 0 to n − 1, where n = min(30, ceil(duration − start)).
  - Each frame is scaled to 112px tall, its width set by the video's aspect and rounded to even.
- **A Peaks chunk** is the audio mixed to mono and resampled to 48 kHz, then folded into 1000 buckets per second, following Concat's `peaks.rs`.
  - Each bucket holds a min in [−1, 0] and a max in [0, 1], quantized to int8.
  - Layout, little-endian: `[buckets_per_second u16][count u32][min i8 × count][max i8 × count]`.
- **The cache key** is the media's identity (Job id or media item id), a format version, the parameters and the chunk's start. There is no content hash. The ADR gives the layout under the data directory.
  - Writes go to a temporary file that is then renamed, so a half-written chunk is never served.
  - Deleting a media item deletes its chunks. Deleting a Job already deletes its folder.

**API contract.**
- **The endpoints:**
  - `GET /api/jobs/{id}/filmstrip/v1/{start}.jpg` and `GET /api/jobs/{id}/peaks/v1/{start}.peaks` for the Source;
  - `GET /api/media/{id}/filmstrip/v1/{start}.jpg` and `GET /api/media/{id}/peaks/v1/{start}.peaks` for media items.
- **`start`** is whole seconds, a multiple of 30, inside the duration.
- **A Filmstrip answer** carries its frame count in an `X-Frames` header.
- **Answers are cached by the browser as immutable,** like the media files today. A new format means a new version in the path.
- **404:** a `start` that is off the grid or past the end; an image item (no Filmstrip, no Peaks); an item without sound (no Peaks); an unknown Job or item.

**When chunks are made.**
- **Media items: on upload.** The upload's single normalize pass also writes every chunk's Filmstrip and Peaks, so the upload answers with them ready. An item without them (uploaded before this feature) has them made on its first request.
- **Sources: on demand.** A request for a missing chunk makes it and then answers.
  - Chunks are made under one lock of their own, outside the Worker: one ffmpeg at a time, at low CPU priority, on one thread while the Worker runs a Job and on every core while it is idle. Transcription and analysis keep the Worker. Requests waiting for the lock are served latest first (amended after the walkthrough, ADR 0005).
  - The Job's browser-playable proxy is read when it has one. Otherwise the Source is read, seeking to the chunk's start.
  - A request that waited on the lock checks the cache again before making anything, so two requests for one chunk run ffmpeg once.

**A new pure module for the Timeline's view (Seam E).** It has no React and no canvas: plain functions of numbers and edits.
- **The chunks an item needs** for its visible range. A Source Segment needs them by its range of the Source, a media Segment by its range of the item, and a Music Clip by its song's offset.
- **The frame each tile shows:** the Source or media time under the middle of the tile's visible part, rounded to the nearest whole second.
- **The Peaks level for a zoom.** Following Concat's pyramid, levels are built by halving until 64 buckets or fewer. The chosen level is the coarsest that still has at least one bucket per device-pixel column.
- **The gain at a time:** volume × the fade-in ramp × the fade-out ramp (linear). A Source Segment uses the Clip's own sound's volume and no fades.
- **The Volume Line's curve** between a position `p` in [0, 1] (bottom to top) and a gain:

  ```
  gain = 2 · p^k,  k = ln(1/2) / ln(2/3) ≈ 1.71   // gain 1 (100%) at p = 2/3
  p    = (gain / 2)^(1/k)
  ```

  Gains are rounded to 0.01.
- **Fit:**
  - **The span to fit:**
    - with a Pick, the hull of what is picked, in Timeline time;
    - the hook: its span;
    - the captions: the whole Clip;
    - a join is a point: the view is centred on it at the current zoom.
  - **The zoom** is the span with a 5% margin on each side, clamped to 1×…40×. The scroll centres the span.
  - **With nothing picked,** the zoom is 1× and the scroll 0.

**Seam D (the actions module) gains three edits,** each one change of the edits:
- **Set an item's volume:** a Music Clip or a media Segment. It is rounded and clamped to 0–2.
- **Set a Music Clip's fade in or fade out.** Each fade is clamped to 0–10 s, and the two fades together never exceed the Clip's length.
- **Trimming a Music Clip** clamps its fades by the same rule.

**Drawing.**
- **One canvas per Segment or Music Clip, windowed.**
  - It covers the item's visible part plus half a viewport on each side, at most 4096 device pixels wide, scaled by the device pixel ratio.
  - It is redrawn in an animation frame when the scroll, the zoom, the edits or an arriving chunk change. Items wholly outside the margin draw nothing.
  - DOM items and Ruler ticks stay as they are.
- **The Video row's layout:**
  - the Filmstrip fills the row (56px);
  - the Waveform takes the bottom 14px, semi-transparent;
  - the Volume Line is drawn over both on media Segments.
- **Music Clips:**
  - the Waveform fills the body;
  - the Fade Ramps shade their ends;
  - the Volume Line and its label sit over them;
  - the existing name and volume % stay.
- **A media cache held by the Advanced Edit,** for the session:
  - at most two chunk requests at a time; queued requests that leave the margin before they start are dropped, and fetches under way that no canvas wants any more are cancelled;
  - Filmstrips decoded as bitmaps resized to the row's height × the device pixel ratio;
  - decoded bitmaps kept in an LRU of 12 chunks, released when evicted;
  - Peaks kept as they are (small), with their pyramids built once.
- **Arrival:** a chunk fades in over 150 ms by opacity. Nothing animates while waiting. A media item without chunks yet shows its single thumbnail, as today.

**Gestures.**
- **On a picked Music Clip or media Segment,** the Volume Line has a hit area at least 24px tall. Dragging it sets that item's volume only, through Seam D, as one gesture group of the Timeline's drags.
- **On a picked Music Clip,** each Fade Ramp has a handle at its top with a hit area of at least 24×24px. Dragging it sets that fade, through Seam D, as one gesture group.
- **Everywhere else on an item, a drag moves or trims it as today.** On an unpicked item there is no line or handle to grab: a tap picks it.
- **Locked Tracks** show their lines and ramps, but they don't drag.
- **Fit** is the Fit button and the Shift+Z shortcut.

**Undo: one gesture is one step.**
- The rule for whether a change merges into the last step of the edit history becomes a pure function: the last group and time, plus the new group and time, give merge or new step. The history uses it.
- A group that names one gesture (the Timeline's drags, unique per gesture) merges for as long as it keeps coming, with no time limit. Other groups, such as the inspector's sliders per item and field, keep the 1500 ms window.
- This also stops a slow move or trim drag from splitting into two steps.

## Testing Decisions

A good test checks behaviour at a public boundary: what goes in and what comes back. It survives a refactor of the internals. Its expected values come from worked examples, not from recomputing them the way the code does. Canvas output is not unit-tested.

**Three seams, agreed with the owner.**

**Seam A: the app over HTTP, with the real ffmpeg (existing).**
- Prior art: the Media Library's tests, which build tiny videos, tones and images with ffmpeg's `lavfi`, upload them through the API and check what is served.
- Uploading a video answers with its chunks ready. A 2-second video has one Filmstrip chunk with `X-Frames: 2`, 112px tall, and a Peaks chunk whose count is 2000.
- A 65-second Source gives three chunks of 30, 30 and 5 frames. `start = 15`, `start = 90` and a negative start give 404.
- Peaks: the layout holds, every min ≤ 0 ≤ every max, and a tone's peaks are near its amplitude. A silent video and an image give 404.
- An item whose chunks were removed (as if uploaded before this feature) gets them on its first request.
- A Source chunk requested twice is made once (its file is unchanged by the second request). Two concurrent requests for the same chunk both succeed and leave one file.
- Deleting a media item removes its chunks.
- Answers carry immutable cache headers.

**Seam D: the pure actions module (existing, extended).**
- Prior art: the existing tests of the actions module, which build small edits from helpers and assert whole outcomes.
- **Setting volume:** on a Music Clip and on a media Segment, rounded and clamped. Not offered for a Source Segment.
- **Setting fades:** above 10 s clamps to 10, and a fade in that would cross the fade out is cut to the remaining length.
- **Trimming a Music Clip** below the sum of its fades shortens them.

**Seam E: the pure Timeline-view module (new).**
- **Chunks for a range:**
  - a Source Segment from 28 to 95 needs chunks 0, 30, 60 and 90;
  - a media Segment needs them by its own range;
  - a Music Clip with an offset needs them by its song's range.
- **Frame for a tile:**
  - worked examples at 1× and 40×;
  - a tile half off-screen uses its visible middle.
- **Peaks level:** at 1× on a phone width it is coarse, at 40× on a desktop width it is the finest, and never below one bucket per column.
- **Gain:** at the middle of a fade in, at both ends, and with fades meeting.
- **Volume curve:** gain 0, 1 and 2 at p = 0, ⅔ and 1, and the inverse round-trips.
- **Fit:**
  - one picked item;
  - several picked items;
  - nothing picked (1×, scroll 0);
  - a Pick too short (40×, centred);
  - a join (current zoom, centred).
- **The undo merge rule:**
  - a gesture group merges across a 2-second pause;
  - a slider group splits after 1500 ms;
  - different groups never merge;
  - no group never merges.

**Not automated: a browser walkthrough** at the end, on a desktop and on a phone (the repo has no React component tests).
- A 90-second Candidate of an hour-long Source: frames and Waveforms appear while a transcription runs, and scrolling and pinching stay smooth.
- Scroll the whole Clip at 40× on Safari iOS. Memory stays steady and the page doesn't reload.
- Drag a Volume Line and a fade, pausing while holding, then undo each with one Cmd+Z.
- Tap an unpicked Music Clip and drag it: it moves, and its volume is unchanged.
- Fit with a Pick, with none, and on a short item.
- A media item uploaded before the feature fills in its frames.

**The checks to run:** the frontend's typecheck, tests and build, and the backend's tests.

## Out of Scope

- **Keyframe diamonds.** There are no keyframes yet. The item canvas is a layer that a `keyframes` feature can draw on.
- **Fades on Segments, and a volume for each Source Segment.** These come with `audio-mixing`, which reuses the Volume Line and the Fade Ramp.
- **Frames framed by the Layout, and any frame grid finer than 1 fps.**
- **Virtualizing the Timeline's DOM items and Ruler ticks.** If the phone walkthrough shows lag, it gets its own issue.
- **Raising the 40× zoom limit.**
- **Showing Filmstrips or Waveforms in the clip editor's Timeline,** or Filmstrips on the Overlay Track.
- **Changing the Volume Line from the keyboard.** The inspector's volume field covers it.

## Further Notes

- **Choices made by default, not grilled.** Revisit them in review if they feel wrong:
  - a Volume Line drag changes only its own item;
  - lines and ramps are drawn on unpicked items too, just not draggable;
  - Fit's shortcut is Shift+Z;
  - Fit leaves a 5% margin on each side.
- **The Volume Line's curve is perceptual, not a strict dB scale.** It puts 100% at two thirds of the height, as agreed, and keeps 0% reachable.
- **Amends no ADR.** ADR 0005 records the derived-media decision. The fade rule copied to the frontend is in the spirit of ADR 0001's warning about two copies of a rule: the planner's is the rule, and both are tested on the same worked examples.
- **Changed after review (2026-10-15, agreed with the owner):** the planner's fade rule (see Model); the Layout labels moved over the frames; no Volume Line on a silent media Segment. Also beyond the tickets, kept: the preview's stage and Overlay drags are one undo step per gesture too; the phone's Timeline bar scrolls sideways; a split Music Clip's parts keep fades that fit them.
- **Roadmap:** item 3, `timeline-visuals`, in the Advanced Edit v2 roadmap. `audio-mixing` (item 14) builds on the Volume Line and Fade Ramp.
