# 03: Cues of up to three lines; Phrase and Sentence

**Parent spec:** `../spec.md` (Domain and model: `max_lines`, Phrase and Sentence, `break_before`; Planning Cues: breaking, balanced lines; Rendering); user stories 19–22, 36, 47.

**What to build:** the owner can show a sentence in two lines.

**Caption Style gains `max_lines`** (1–3, default 1):
- `max_chars` and `max_words` count per line;
- `max_secs` and `pause_secs` apply per Cue.

**Breaking into lines:**
- The planner splits a Cue's Words into balanced lines: of the splits that fit, the one with the shortest longest line wins.
- A Word Edit's `break_before` starts a new line, and a new Cue when the Cue already has all its lines.
- With `max_lines` 1 every stored Candidate and Preset plans as before.

**Drawing:**
- The renderer joins a Cue's lines in one event, highlighting the active Word across them.
- The box highlight is placed from each line's own metrics.
- The preview draws the same lines.
- Shrink-to-fit applies to the widest line.

**The shared Caption Style panel** (clip editor and Advanced Edit) gets:
- a Lines field;
- Phrase (1 line, 16 characters, no word limit, 1.4 s, 0.5 s pause) and Sentence (2 lines, 24 characters, no word limit, 5 s, 0.7 s pause) buttons that fill the line limits;
- a mark on the one the current values match.

No mode is stored. The clip editor's "New line here" is relabelled if needed to say it starts a line.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Planner: with `max_lines` 1 the Cues equal today's on the existing caption fixtures.
- [ ] Planner: Sentence limits give two balanced lines within 24 characters each, ending Cues at a sentence's end or a pause.
- [ ] Planner: `break_before` starts a line inside a two-line Cue, and a Cue when the Cue is full.
- [ ] Render (real ffmpeg): a two-line Cue shows ink on two text rows. With box highlight, the box sits behind the active Word on the second line.
- [ ] Preview: two-line Cues match the render's placement, line height and timing.
- [ ] Phrase and Sentence fill the fields in both editors, and the mark follows hand edits. A Preset saved with `max_lines` 2 keeps it.
- [ ] The MCP accepts `max_lines` in `style_overrides.caption` and in `save_preset`.
