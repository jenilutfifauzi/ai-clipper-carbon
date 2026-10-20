# 01: Speech on Music Clips

**Parent spec:** `spec.md` in this feature folder (Solution "Speech"; Implementation Decisions "Model", "Planner", "MCP", "Inspector"); ADR 0018, amending ADR 0016.

**What to build:** a Music Clip can be marked Speech. The owner uploads a voice memo, lays it as a Music Clip and switches Speech on in its inspector. A song with a duck then turns down under the memo's whole span in the preview and in the render, as it does under the Source's Words. The agent can do the same through MCP. No recording yet: this is the half of the Voiceover that works without a microphone.

- **The field.** `speech` is a bool on a Music Clip, false by default, and stored Music Clips read as false. It is merged as one field of the Music Clip (ADR 0003).
- **What the edit API refuses.** `speech` on a Music Clip of the Source's sound, and `duck` on a Music Clip with `speech`, are refused with the same kind of error as a duck on the Source's sound.
- **No default duck for Speech.** The −12 dB default of ADR 0016 for a new song isn't given to a Music Clip with `speech`.
- **The planner.** Each Music Clip with `speech` that isn't Muted is one span of speech, from its start to its end on the Timeline, cut to the Clip's length. These spans are joined and reach the ducked sounds through the same functions as the Words. A Speech Music Clip is never ducked. The render and the preview read the spans from the plan as today, so neither of them changes.
- **The inspector.** A Music Clip of a media item shows a Speech switch. While it is on, the duck control is hidden, and switching it on clears `duck` in the same edit. A Music Clip of the Source shows no switch.
- **MCP.** `speech` is described in the schemas of `edit_candidate`, `merge_candidate_items` and `dry_run`, next to `duck` and `muted`.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Seam B: a Speech Music Clip's whole span is speech, and a ducked song under it carries the span and its ducked stretch.
- [x] Seam B: a Muted Speech Music Clip makes no speech; spans from a Speech Music Clip and from Source Words join across a short gap; a span past the Clip's end is cut to it.
- [x] Seam B: a Speech Music Clip carries no speech spans of its own, and two overlapping Speech Music Clips don't duck each other.
- [x] Seam B: a stored Candidate without `speech` plans exactly as before.
- [x] Seam A: an edit adding a Music Clip with `speech: true` and no `duck` stores no duck.
- [x] Seam A: `duck` on a Speech Music Clip is refused, and so is `speech` on a Music Clip of the Source.
- [x] Seam A: the agent sets `speech` through `edit_candidate` and `merge_candidate_items`, and the `dry_run` lists the song's speech spans from it.
- [x] Seam A (real ffmpeg): with a tone as the song and a tone as the Speech Music Clip, the song is 12 dB quieter in the middle of the Speech span and back to full after the release.
- [x] The inspector's Speech switch hides the duck control and clears `duck` (vitest).
- [x] Only the new backend test file and the touched ones are run, not the whole suite.
