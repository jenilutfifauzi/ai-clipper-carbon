# 01: Prefactor: the captions become Cues in the Render Plan

**Parent spec:** `../spec.md` (Implementation Decisions "Planning Cues", "Rendering"); docs/adr/0020-media-words-and-cue-edits.md.

**What to build:** a prefactor that changes no pixel and no caption time.

Today the plan's captions are one-line events: a text, times, the Words, an area and a size. The renderer, the preview in both editors and the agent's dry run all read that shape.

Give each caption the shape of a **Cue** (GLOSSARY):
- its shown `start` and `end`;
- its `lines`, each a list of Words (display text and times). Today there is always one line.
- its `plain` lines: the Words' text after Word Edits, without the Caption Style's case or its end-punctuation and emoji stripping;
- its area and size;
- its `key`: the middle of its first Word on its timeline (`at`) and `media` (always empty for now);
- `edited` (always false for now) and `joinable` (whether merging it into the previous Cue fits the line limits; computed now, so later tickets only read it).

The renderer and the preview draw a Cue line by line. With one line, that is exactly what they draw today.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Every existing backend and frontend test passes unchanged, apart from renames.
- [ ] A Candidate with captions in each highlight mode (colour, box, none), custom-positioned, tracked and shrunk-to-fit, renders byte-identical frames before and after (compare frames at several times).
- [ ] The preview in the Advanced Edit and in the clip editor shows the same captions as before, and the caption lines on both Timelines are unchanged.
- [ ] A dry run lists each Cue with its times, lines, plain text and key. The plain text keeps the Words' case and punctuation, with Word Edits applied.
- [ ] The planner tests cover `plain` and `key`, and `joinable` for a pair that fits and a pair that doesn't.
