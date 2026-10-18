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

**Status:** ready-for-agent

- [ ] A song with `duck` −12 under a Source Segment with Words renders about 12 dB quieter mid-sentence and back to full 0.5 s after the last Word (tone measured against an unducked render).
- [ ] Words of a Muted Segment don't duck; Words of a Music Clip of the Source moved 1 s later duck 1 s later.
- [ ] A pause of 0.5 s stays ducked; a pause of 2 s comes back up.
- [ ] With captions off, the Transcript's Words duck the song.
- [ ] A new song clip added through `merge_candidate_items` without `duck` gets −12; a stored Candidate's Music Clips don't duck and render the same command as before.
- [ ] The API and MCP refuse `duck` on a Music Clip of the Source and outside −30..−1.
- [ ] The shared gain vectors' duck cases pass in pytest and vitest; the preview's gain matches the plan's.
