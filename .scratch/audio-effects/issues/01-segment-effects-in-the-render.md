# 01: Audio Effects on Segments in the render

**Parent spec:** `../spec.md` ("Model", "Catalogue module", "Planner", "Renderer", "API and MCP"); ADR 0017.

**What to build:** an agent (or the API) gives a Segment, of the Source or a media item, a stack of Audio Effects. The rendered Clip then sounds that way, in the stack's order:
- after the Segment's Speed and Reverse;
- before its volume, Keyframes and fades;
- before the join or Transition with the next Segment.

The effects catalogue starts here as a Python registry. Each entry has an id, a name, a group, an order, its settings (key, label, min, max, default, step, unit, one marked as the intensity) and a pure chain builder.

The first three entries make the slice audible and testable:
- **Telephone** (Tone): a band-pass voice;
- **Echo** (Space): with its delay and decay;
- **Pitch** (Voice): ±12 semitones, at the same length.

The rest come in 05 and 06.

**The model:** Segments gain `audio_effects`, an ordered list of `{id, params, enabled}`. It is empty by default, and an absent list reads as empty.

**Validation, on every save path:**
- An unknown id, an unknown setting key or a value out of range is refused, naming the item, the index and the reason.
- A setting left out takes the catalogue default.
- A stack on a Freeze frame is refused.

**The render:**
- A Segment with a non-empty, enabled stack is not "plain". Both the concat fast path and the collapse of a single plain Segment back into a range must count it.
- Each chain ends trimmed to the Segment's length, so an Echo tail is cut at its end.
- The final two-pass loudness on the mix is unchanged.

**What the agent sees:**
- `GET` the audio effects catalogue.
- MCP `list_assets(kind="audio_effects")`.
- `edit_candidate` and `merge_candidate_items` take the field.
- `dry_run` shows each Segment's stack.
- The server instructions describe the stack and its place in the chain.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Segments accept `audio_effects`. Stored Candidates plan and render exactly as before (the existing command fixture is unchanged).
- [ ] The catalogue registry holds Telephone, Echo and Pitch. It validates and fills defaults, and a disabled entry adds nothing.
- [ ] Seam A: Telephone on a Source Segment removes most of a tone's energy under 300 Hz.
- [ ] Seam A: Pitch +12 moves 440 Hz to about 880 Hz at the same length.
- [ ] Seam A: Echo is heard after the tone stops within the Segment, but not past the Segment's end.
- [ ] Seam A: a media Segment with effects works, and so does a Segment with effects between plain ones, keeping its timing at a join and under a Transition.
- [ ] Refusals cover an unknown id, an unknown key, an out-of-range value and a stack on a Freeze frame, through the API and through MCP.
- [ ] `list_assets(kind="audio_effects")`, `dry_run` stacks and the instructions text are in place.
- [ ] Each catalogue entry runs at its default, minimum and maximum over a 1 s tone and keeps the input's length.
