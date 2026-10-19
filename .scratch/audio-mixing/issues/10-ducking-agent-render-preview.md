# 10: Ducking, for the agent, the render and the preview

**Parent spec:** `spec.md` in this feature folder (user stories 38, 41–47, 49, 60, 62–63; Solution "Ducking"; Implementation Decisions "Model", "API rules", "Speech and Ducking", "Renderer", "Preview", "MCP"); ADR 0016; GLOSSARY "Ducking".

**What to build:** a Music Clip of a song or of a video's sound turns itself down by its depth while speech is heard. The preview hears exactly the duck the render does. New song clips duck at −12 dB by default; stored ones don't. The agent can set, change and switch off the duck, and sees the ducked spans in the dry run. The editor UI comes in 11.

- **Model.** `duck` on Music Clip: a depth from −30 to −1 dB, or null; default null. A Music Clip of the Source refuses it.
- **API rule.** When an edit adds a Music Clip of a Media Library item whose id isn't in the current Revision, and the request didn't set `duck`, the server sets −12. An explicit null keeps it off.
- **Speech spans (new pure planner module):**
  - From each Source Segment that isn't Muted: its Words placed as the captions' are (Speed, Transition cuts; none reversed or held).
  - From each Music Clip of the Source that isn't Muted: the Words of its read range through its offset and Speed (none reversed).
  - The Words are the Clip's own, or the Transcript's. They are gathered even when captions are off.
  - Spans less than 0.8 s apart are joined.
- **Ramp constants** (0.25 s lead, 0.8 s bridge, 0.5 s release) live in the config and are carried by the plan.
- **Plan.** A ducked `AudioEvent` carries its depth and the joined spans that touch it.
- **Gain function.** It gains the duck, linear ramps between 1 and the depth's gain: volume or Keyframes × fades × duck, in Python and TypeScript. The shared fixture (01) gains duck cases.
- **Renderer.** A ducked event's volume is a `volume=…:eval=frame` expression, even for a constant volume. The loudness passes run after it.
- **Preview.** A ducked sound follows its gain curve. Track mute doesn't change the duck.
- **MCP.**
  - The instructions explain the duck, its default, and that speech comes from Words.
  - The dry run lists every sound (not only keyed ones) with its span, Muted, fades and ducked spans.
  - The tool descriptions stay within the budget.

**Blocked by:** 01, 02, 08.

**Status:** done

- [x] A song with `duck` −12 under a Source Segment with Words renders about 12 dB quieter mid-sentence and back to full 0.5 s after the last Word (tone measured against an unducked render).
- [x] Words of a Muted Segment don't duck; Words of a Music Clip of the Source moved 1 s later duck 1 s later.
- [x] A pause of 0.5 s stays ducked; a pause of 2 s comes back up.
- [x] With captions off, the Transcript's Words duck the song.
- [x] A new song clip added through `merge_candidate_items` without `duck` gets −12; a stored Candidate's Music Clips don't duck and render the same command as before.
- [x] The API and MCP refuse `duck` on a Music Clip of the Source and outside −30..−1.
- [x] The shared gain vectors' duck cases pass in pytest and vitest; the preview's gain matches the plan's.

## Comments

**2026-10-18: done.**

**What was built:**
- **Model.** `MusicClip.duck` (`Duck`, −30..−1 dB, or None; default None), after `muted`. A Music Clip without `media` refuses it in `__post_init__` ("Music Clip s plays the episode's sound, which is never ducked: it has no duck"). `DEFAULT_DUCK = −12` in `candidates.py`.
- **API rule.** `CandidateUpdate` records, from what was sent, the Music Clips without a `duck` key (a wrap `model_validator` into a private `_duck_unset`); `CandidateUpdate.change` builds the `CandidateChange` with `duck_unset`, and `review.update` (`_ducked_by_default`) gives −12 to those that are a song's or a video's sound and whose id isn't in the current Revision. An explicit null keeps it off; a Restore (built from objects, not JSON) never defaults. The preview-plan draft gets the same rule. MCP: `merge_candidate_items` sends a new patch without `duck` as is; `edit_candidate` deletes `duck` from the dumped body for the clips that didn't set it (pydantic dataclasses dump every field).
- **Pure module `app/ducking.py`:** `heard_words` (Words of a read placed at a start and Speed, kept by their middle), `speech_spans` (joined when less than the bridge apart, or when their ramps would meet), `touching`, `duck_at`, `duck_steps` (points for the renderer). `DuckTuning` (lead 0.25, release 0.5, bridge 0.8) is in `config.py`; `RenderPlan.ducking` carries it.
- **Planner.** `AudioEvent` gains `duck` and `speech` (the joined spans, Clip seconds, whose ramps reach it; unclipped). `plan_render` takes `captioned` (Words heard but not captioned), `music_words` (by Music Clip id, seconds from its offset) and `ducking`. Speech is `_segment_words` over the Source Segments that aren't Muted (a video's Segment never), or the one-range Clip's Words within it, plus each forward, unmuted Music Clip of the Source's Words where it plays (`_ducked`). `gain_at(event, time, ducking)` multiplies the duck.
- **Words gathered with captions off.** `rendering.words_at_hand` (saved Clip Words, else the Transcript's) and `music_words` (a Music Clip of the Source's read). The render with captions off now plans with the Words at hand (no transcription), `captioned=False`; the preview passes its Words always, with `captioned=job.options.captions`.
- **Renderer.** A ducked event's volume is one `volume='(K)*(D)':eval=frame` expression (K: Keyframes' linear steps or the constant volume; D: `duck_steps` as clipped ramps), even unkeyed. `_ramps` writes `t+0.15` for a lead before the sound's start. Unducked commands are unchanged (both command fixtures pass).
- **Preview.** `loudness.ts`: `duckAt`; `Heard.ducking`; `eventSound(event, sourceVolume, ducking)` attaches the plan's ramps to a ducked event; `changing` is true for a ducked one with speech. `PreviewMusic` passes `plan.ducking` and follows a curve whenever the sound `changing` (so faded unkeyed Music Clips follow one too). Track mute is untouched (the heard draft mutes by volume).
- **MCP.** One instructions bullet on `duck`, its default, null and speech from Words. The dry run's `sounds` list every sound (Segments but silent videos and Freeze frames, Music Clips, Overlays) with span, fades, keys, Muted, and for a ducked one `duck` and `ducked` (the stretches where it is turned down, ramps included, within it). Tool list ~61.5 KB, within 69 000.
- **Shared fixture.** `gain_vectors.json` gains `ducking` and five duck cases (constant, keyed and faded, overlapping spans, spans at the edges, a span longer than the sound); `test_gain.py` checks `ducking` equals the config's.

**Tests:** `backend/tests/test_ducking.py` (11): Seam B (Transition cut and Speed, Muted/reversed/held/video, 0.5 s vs 2 s pause, captions off, a Music Clip of the Source moved and at 2×, touching spans, unducked and refused); API (−12, null, −6, stored resent, draft, refusals), captions off through the preview plan; MCP (merge and edit_candidate defaults, refusals, dry run); a real render: −12 dB mid-sentence, halfway up the release, full 0.6 s after (against an unducked render, the Source's tone as measure). `loudness.test.ts` (+2 and the fixture). Existing tests that add a song through the API and measure it now send `"duck": null` (test_keyed_volume, test_keyed_source_segments), and the dry-run tests expect every sound (test_muted, test_keyed_segments, test_keyed_source_segments, test_keyed_volume).

**Decided differently / left for later:**
- **Spans are carried unclipped** (those whose ramps reach the event), so that the gain stays exact at its edges; the dry run shows them clipped to the sound as `ducked` stretches.
- **The render test reads the speech from the plan** after the first render: the fake transcriber's Words differ from the json3 Transcript's.
- **Editor (11).** The editor's new Music Clips carry no `duck` yet, so the server ducks them at −12 on their first save; until 11 adopts `duck`, a later save of the same clip from a draft that lacks the key would send it without `duck` and clear it. 11 should set `duck` explicitly on new clips.
- Ticket 09's `detached_from` on `AudioEvent` will sit beside `duck`/`speech`.
- **Merged with feat/audio-mixing (12, Save sound as WAV).** `item_sound._from_start` clears `duck` and `speech` on the kept event, since a WAV leaves Ducking out; `test_item_sound.py` shows a song ducked at −20 dB under the Words saves as loud as with `duck` off. `api.py` keeps both sides' imports.
