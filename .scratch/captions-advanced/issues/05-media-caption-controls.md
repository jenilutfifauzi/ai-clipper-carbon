# 05: Media caption controls: the Captions switch, the item's language, failures

**Parent spec:** `../spec.md` (Domain and model: `MediaItem.language`, `Segment.captions`; Media Words: renders wait; Advanced Edit: media Segment inspector, Main Track, Media Library item menu); user stories 6, 8, 9, 45.

**What to build:** the owner controls which media Segments are captioned and in what language, and recovers from a failed transcription.

**The Captions switch:**
- `Segment.captions` (media Segments only; empty means on) is a switch in the media Segment's inspector.
- Off, the Segment has no Cues, its status is `off`, and nothing is queued for it.
- It is refused on a Source Segment.

**The item's language:**
- `MediaItem.language` (the Job language's pattern; empty means the Job's) is set through the Media Library API.
- It is edited from the media Segment's inspector (a select whose first entry is "Job's language (xx)", noting it applies to the item in every Job) and from the Media Library's item menu for videos.
- Changing it queues a transcription in the new language and keeps the old file.

**Failures:**
- A failed transcription is remembered. The status is `failed` with its error, the Main Track badge turns red, and the inspector offers Retry.
- When ready, "Transcribe again" re-runs it.
- A render with a failed or failing transcription fails that Clip with a message naming the item.

**Captions off:** a Job with captions off queues no Media Words, the status is `none`, and the Captions Track says captions are off for this Job.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] HTTP: a media Segment with `captions: false` has no Cues and causes no transcription. `captions` on a Source Segment is refused.
- [ ] HTTP: setting an item's language to `en` transcribes it in `en` for every Job that shows it. Clearing it goes back to each Job's language, reusing the earlier file.
- [ ] HTTP: a transcription that raises makes the status `failed` with the error. Retry clears it and runs again. "Transcribe again" replaces a ready file.
- [ ] Render: a failed transcription fails that Clip's render with the item's name. Turning the switch off lets it render.
- [ ] A Job with captions off queues nothing for its media Segments.
- [ ] The MCP accepts `segments[].captions` in `edit_candidate` and `merge_candidate_items`.
- [ ] Browser walkthrough: the switch, the language select (inspector and Media Library), the red badge and Retry.
