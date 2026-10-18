# 08: Music Clips of the Source's sound

**Parent spec:** `spec.md` in this feature folder (user stories 33–34, 59, 60; Implementation Decisions "Model", "API rules", "Planner, other", "Renderer", "Preview"); ADR 0016; GLOSSARY "Music Clip".

**What to build:** a Music Clip may be of the Source's sound instead of a Media Library item. It plays a range of the episode's sound anywhere on the Timeline, at its volume, fades, Keyframes and Speed, scaled by the Clip's own sound slider. Detach (09) will create these; this ticket makes them work for the agent, in the render, in the preview and on the Timeline.

- **Model.**
  - A Music Clip's `media` may be absent, meaning the Source's sound.
  - Its `offset` is then a time on the Source's timeline, and its read must lie within the Source.
  - It refuses `duck` once that field exists (10).
- **Planner.** `AudioEvent` carries `source`.
- **Renderer.**
  - The Source file (or, in Reverse, the Source's Retimed copy) is an input for such events.
  - Their volume is multiplied by `source_volume`.
  - Muted and fades apply as for any Music Clip.
- **Preview.** It plays from the Source's proxy (or Retimed copy) in a hidden element, as Overlay sounds do, at `source_volume` × its gain.
- **Timeline and inspector.**
  - Drawn on the Music Track with the Source's Peaks as its Waveform.
  - Labelled as the episode's sound.
  - "Starts in the song at" reads as a time in the episode.
- **Clipboard.** It pastes only into a Candidate of the same Job, as Segments of the Source do.
- **MCP.** The instructions explain a Music Clip without `media`. The dry run names it as the Source's.

**Blocked by:** 07.

**Status:** done

- [x] A Music Clip of the Source's range under a media Segment renders that stretch of the episode's tone at its Timeline place, scaled by `source_volume`.
- [x] At 2× and in Reverse it plays as a song's Music Clip does.
- [x] The API and MCP refuse a read past the Source's end.
- [x] The preview plays it in time with the playhead; its Waveform is the Source's.
- [x] Pasting it into a Candidate of another Job is refused with a notice; into the same Job it pastes.
- [x] A Candidate with only song Music Clips renders the same command as before.

## Comments

**2026-10-18: done.**

**What was built:**
- **Model.** `MusicClip.media` is `MediaId | None`, default None (the Source's sound). It is a keyword-only field (`field(kw_only=True)`) so that it can be left out while `start` and `secs` stay required; JSON and the schema are unchanged otherwise (the field just isn't required). `Candidate.media_ids` leaves the Source out. The four tests that built a `MusicClip` positionally now pass `media=` by name.
- **API.** `review.update` refuses a Music Clip of the Source whose read (`overlay_time`: `offset + secs × speed`) runs past the Source's end, within 0.05 s, through the new `Episode.check_music`: "Music Clip s runs past the end of the episode (6 s) at 2x". The same goes for the draft of `/preview-plan`. `_check_media_of` skips such a clip. `duck` isn't there yet (10).
- **Planner.** `AudioEvent.media` is `str | None`, and the event has `source` (true for the Source's sound, still true once `read_from_copies` points `media` at the Retimed copy). `audio_events` takes the Source's length (`source`, which `plan_render` passes as `source.duration`) and cuts a Music Clip of the Source where the episode ends, as a song's at its end.
- **Renderer.** `_music_inputs` now gives where each sound of the plan's audio is read (its input and where its part starts in it). A song is still one whole input, read with `atrim` from its offset. A Music Clip of the Source reads the Source as an input of its own with `-ss offset -t span`, as a Segment does, so that a long episode isn't decoded from its start. In Reverse, `read_from_copies` already swapped in the Source's full-size Retimed copy, which `rendering._render` makes. `_audio_mix` multiplies the Source's sound by `source_volume`; a keyed one gets it after its Keyframes' `volume` expression, as a keyed Source Segment does. Fades come from the existing chain. A Candidate with only songs renders the same command (`unkeyed_command.json`, `segmented_command.json`).
- **Copies.** `copies_used` counts a Music Clip of the Source under None (the Source), so its copies aren't swept.
- **MCP.** One instructions paragraph covers a Music Clip without `media`. The dry run's `sounds` list every Music Clip of the Source, keyed or not, with `media: null` and `source: true`, plus what it reads at a Speed or in Reverse (its `copy` looked up among the Source's copies).
- **Preview.**
  - `PreviewMusic` takes the Source's `src` and `jobId` from `ClipPreview`. A Music Clip of the Source plays the decks' proxy in a hidden `<audio>`, or its Retimed copy, which the new `soundAsk` (`retimedCopy.ts`) asks of the Job's Source.
  - Its loudness is `eventSound` (`loudness.ts`): its volume and Keyframes times `source_volume`.
  - `AdvancedEdit.copyOf` uses `soundAsk` as well, so the inspector shows the copy's progress.
- **Timeline.**
  - The Music Track draws it with the Source's Peaks (`jobPeaksUrl`).
  - The Waveform is scaled by `source_volume` (`underSourceVolume` in `timelineView.ts`), and the Volume Line shows its own volume, as for a Source Segment.
  - It is labelled "The episode's sound" (`musicName` in `Music.tsx`) with a microphone icon.
  - Its trims reach as far as the episode goes.
- **Inspector.**
  - `MusicFields` takes `sourceLength` and titles the clip "The episode's sound".
  - Its offset slider reads "Starts (Ends) in the episode at" as a time (`formatPrecise`, through `TimingFields`' new `offsetFormat`).
  - A Speed change keeps the read within the Source (`setItemSpeed` passes the Source's length).
- **Clipboard.** `paste` into another Job leaves Music Clips of the Source out, with "1 Music Clip of this episode's sound left out: another Job's clips can't play it." Into the same Job (any Candidate), they paste.

**Tests:**
- `backend/tests/test_source_music.py` (6):
  - the planner: the place and the read, a cut at the Source's end, 2× and Reverse;
  - `copies_used` and `media_ids`;
  - the API: saved, the plan's event, refusals, the draft refused too;
  - MCP: merge, refusal, and the dry run naming it, keyed or not;
  - one real render over a sweeping Source tone. Under a media Segment of a steady 3 kHz tone, three Music Clips of the episode's 1–2 s play (as filmed and keyed down to a half, at 2×, and in Reverse) at `source_volume` 0.5. The test hears each at the right moment of the sweep, at half the steady tone (× its Keyframe), within 1.5 dB, and the reversed one not mirrored. It fails at 0 dB when the `source_volume` factor is left out.
- `sourceMusic.test.ts` (4): paste into the same Job and the same Candidate, another Job refused with the notice, a split, and a Speed within the episode.
- `loudness.test.ts` (+2), `playback.test.ts` (+1: plays the Source's proxy in time, and `soundAsk` asks the Job's Source in Reverse), `timelineView.test.ts` (+1).

**Decided differently / left for later:**
- **Muted** applies once 02 lands. Nothing here filters Music Clips by `muted`, so 02's rule for Music Clips covers these too.
- **`duck` is not refused yet:** the field doesn't exist until 10. Ticket 10 must refuse it on a Music Clip without `media`.
- **No browser walkthrough.** Nothing in the editor creates a Music Clip of the Source until Detach (09). Its drawing, inspector and preview wiring are covered by typecheck, build and the pure tests above; ticket 15's walkthrough covers the rest.
- **The Clipboard keeps `detached_from` untouched** because that field arrives with 09. Ticket 09 drops it on a paste into another Candidate.
