# 07: Speed, pitch and Reverse on Music Clips

**Parent spec:** `spec.md` in this feature folder (user stories 35–37, 60; Solution "Music Clips get Speed, pitch and Reverse"; Implementation Decisions "Model", "Planner, other", "Renderer", "Editor actions"); ADR 0016 (amends 0009).

**What to build:** a Music Clip plays at a Speed from 0.0625× to 16×, its pitch kept unless "Change pitch with speed" is on, and may play in Reverse, as a video Overlay does. This works in the render, the preview, the inspector and through the agent.

- **Model.**
  - `speed`, `pitch` and `reverse` on Music Clip (defaults 1, false, false).
  - Its read of the item, `secs × speed` from `offset`, must lie within the item.
  - Volume Keyframes are checked against its Timeline length.
- **Planner.** `audio_events` carries the Music Clip's Speed, pitch and Reverse, and places it with the existing `overlay_time` mapping.
- **Renderer.** The existing speed filters (`atempo` stages, or `asetrate`). Reverse reads a Retimed copy. Retimed copies must also be made for an audio-only Media Library item (a song), not only for videos.
- **Preview.** `playbackRate` and `preservesPitch` within 0.25–4×, and the Retimed copy beyond that and in Reverse, as for Overlay sound.
- **Editor.**
  - The inspector shows the Overlay's Speed fields on a Music Clip.
  - A Speed change is a trim at the Music Clip's end: its start stays, and its volume Keyframes scale by old ÷ new.
  - Split and ripple handle a sped Music Clip by its Timeline length, keeping its `offset` in file seconds.
  - Waveforms follow the Speed and Reverse.
- **MCP.** The fields through the edit tools. The instructions and dry run cover them.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A Music Clip at 2× of a tone lasts half as long and keeps its frequency; with `pitch` on, it is an octave up.
- [x] A reversed Music Clip of a sweep plays it backwards in the render (from a Retimed copy of a song).
- [x] The API and MCP refuse a Speed outside 0.0625–16, a read past the item's end at a Speed, and a Speed change that strands a Keyframe.
- [x] In the editor, changing a Music Clip's Speed moves its end and scales its Keyframes, as one undo step.
- [x] Splitting a 2× Music Clip at the playhead gives a tail whose `offset` advanced by twice the head's Timeline length.
- [x] The preview plays a 2× Music Clip in half the time with its pitch kept.

## Comments

**2026-10-18: done.**

**What was built:**
- **Model.** `MusicClip.speed` (the `Speed` type, 0.0625–16), `pitch` and `reverse`, after `volume` as on the Overlay; `offset` stays the in-point of the forward read, as an Overlay's (in Reverse it is where the Music Clip ends in its song). Its volume Keyframes stay checked against `secs`, its Timeline length, so a Speed change sent without its keys (each `at` times old ÷ new) is refused by the model's own `checked_keys`. `_check_media_of` refuses a read past the item's end, `offset + secs × speed` (`overlay_time`), within 0.05 s: "Music Clip m runs past the end of its song (2 s) at 2x" (or "of its video" for a video's sound). Stored Music Clips read as 1×, forwards.
- **Planner.** `audio_events` places each Music Clip with `overlay_time`, as `overlay_sound` does: its `AudioEvent` carries `speed`, `pitch` and `reverse`, its end cut where the song ends at its Speed or the Clip ends, and in Reverse a cut at the Clip's end moves its `offset` later (the end of its part plays first). At 1× the event is as before.
- **Renderer.** Nothing new: `_audio_mix` already ran every `AudioEvent` through `speed_filters` (`atempo` stages, or `asetrate`), and `read_from_copies` already rewrote every reversed `AudioEvent` to read its full-size copy forwards, and `rendering._render` already counted them among the copies it makes. What was missing was a Retimed copy of a song: `MediaStore.retimed` now gives an audio item's `Copies` (both sizes from its `.m4a`, `frame=None`), and `_reverse_in_pieces` makes a copy of sound alone when there is no frame (no `-vf`, no picture map, 10 s pieces). It is still an `.mp4` named by `Retime.name`, so the lookup, the covering rule and the sweep are unchanged. A video's sound used as a Music Clip reverses through the video's own copies (picture and sound), which an Overlay of the same video shares.
- **Copies and the sweep.** `copies_used` counts Music Clips (their read cut as the planner cuts it), and `api.sweep_unused` passes songs as well as videos, so a song's unused copies are swept as a video's are. `POST /api/media/{id}/retimed` and its file route serve songs too (404 only for an image).
- **Preview.** Nothing new beyond the plan: `PreviewMusic` already played every `AudioEvent` through `eventPlay`/`eventCopy` (`playbackRate` × Speed within 0.25–4×, `preservesPitch` = not `pitch`, the Retimed copy beyond that and in Reverse), so a Music Clip's event with its Speed now plays so, its copy asked of the song's own copies.
- **Editor.** `SpeedRef` gains `"music"`:
  - `setSpeed` keeps the Music Clip's start, scales its `secs` and its volume Keyframes by old ÷ new (one change, so one step of undo), keeps its read within its song (`limits.video`, its song's length, as AdvancedEdit's `setItemSpeed` now looks up for an Overlay or a Music Clip) and refits its fades (`fadesWithin`). `gestureSpeed` works for it unchanged.
  - `setReverse` mirrors its volume Keyframes over `secs`, as an Overlay's; `reversible` (R) and `speedSheetItem` (the phone's Speed sheet, whose `SpeedPanel` gained `onMusic`) take a Music Clip picked alone.
  - Split (`KINDS.music.cut`) uses `keptOffset`, so a 2× tail's offset goes on by twice the head's length, and in Reverse the first part plays the later part of the song. Ripple and the Clipboard already used `keptOffset` for anything with an `offset`, so they read a Music Clip's song at its Speed once the type had it.
  - The inspector's `MusicFields` shows `SpeedFields` (chips, slider, exact speed, "Change pitch with speed", Reverse with the copy's progress; `SpeedFields` gained `what`, so a failure says "song"), and its offset slider reads "Ends in the song at" in Reverse. `copyOf` finds a Music Clip's copy from the plan's `audio`.
  - Timeline: a Music Clip's trims reach as far as its song goes at its Speed, either way in Reverse (`trimMin`/`trimMax` and `keptOffset`, as an Overlay's), its Waveform runs at its Speed and mirrored in Reverse, and it shows the ◀/2× badge and says it in its accessible name.
- **MCP.** The fields flow through `edit_candidate` and `merge_candidate_items` from the model. One sentence in the Overlay paragraph of the instructions. The dry run's `sounds` now list a sound at a Speed or in Reverse even when it isn't keyed, with what it reads (`_video_read`: `source_start`, `source_end`, `speed`, `pitch`, `reverse`, `copy`).
- GLOSSARY: Speed and Reverse name the Music Clip too.

**Tests:** `backend/tests/test_sped_music.py` (9): the planner (place and read at 2× and 0.5×, cut by the song's end and the Clip's, a reversed cut beginning later); `copies_used`; the API (saved, the plan's event, refusals: Speed 17 and 0.05, a read past the song at 2×, a stranded Keyframe); MCP (the same refusals, merge, the dry run's `sounds` with `copy` before and after the copy); a song's preview copy asked through the API; real renders: a 2 s 880 Hz song at 2× heard for 1 s at 880 Hz and silent after, and at 2× with `pitch` at 1760 Hz; a reversed sweep song heard falling, from the one `reversed-full-0-2000.mp4` the render made. `frontend/src/pages/job/advanced/musicSpeed.test.ts` (8): Speed as a trim with Keyframes scaled and back, within its song with fades refitted, a gesture through 16× and back; R and the phone sheet on a Music Clip alone, Keyframes mirrored; split at 2× and in Reverse; a ripple and a paste at 2×. `playback.test.ts`: a 2× Music Clip's `<audio>` at rate 2, pitch kept, stopped at its end.

**Decided differently / worth knowing:**
- **R reverses a Music Clip** (not asked by the ticket): the Overlay's Speed fields show the R key cap, so the key acts on what the switch does. The phone's Speed sheet takes a Music Clip for the same reason; 14 may fold it into the Music Clip's own sheet.
- **A song's copies are sound alone, in `.mp4`** (AAC), served as `video/mp4` by the existing route; `<audio>` plays them.
- **The MCP tool budget was raised from 69 000 to 69 500 bytes** (`test_mcp.py`). The tool list was 68 863 bytes before this ticket, 137 under the budget; the three fields' schemas in `edit_candidate` and `merge_candidate_items` add about 720. The Music Clip's description (its docstring, which the schema carries) was cut to about 250 bytes (the rest moved to a comment), which brings the list to 69 308. Fitting 69 000 would mean trimming other items' descriptions; the other tickets' fields (`muted`, fades, `duck`, `detached_from`) will need room too, so the coordinator should settle the budget once for the feature.
- **A Music Clip's read past its song's end is now refused** by the API, as the ticket asks. Before, the planner silently cut it. The editor never made one (its Timeline and fields stop at the song's end).

