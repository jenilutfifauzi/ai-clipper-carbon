# 04: Style, look and text from the Candidate

**Parent spec:** `../spec.md` (Model: style, Grade, Main Slot treatment, Kicker; Capture; Apply steps 5 and 6). See also GLOSSARY (Template Field, Main Slot) and ADR 0023.

**What to build:** a Template gives every Candidate the same style, framing, colour and sound treatment. Its titles show each Candidate's own words.

- **A Template carries:**
  - the Style Preset id and the Style Overrides;
  - the Layout, and the Framing when the Layout is Manual;
  - the Candidate's Grade and Clip volume;
  - an optional Kicker;
  - the Main Slot treatment: the first Source Segment's Grade, Video Effects and Audio Effects at capture.
- **Apply:**
  - Replaces all of these on the Candidate, and gives the treatment to every Source Segment. Each Segment's cuts, Speed, Reverse, volume, fades and Keyframes are kept.
  - Replaces the Kicker only when the Template has one.
  - Never touches the hook text.
  - "No Template" leaves all of these as they are.
- **Template Fields:** `{title}`, `{hook}` (with Emphasis marks removed) and `{kicker}` in the Template's Text Layers are filled from the Candidate. An empty value leaves nothing, and gets a notice.
- **The editor and MCP show the Fields as typed** in a Template (`list_presets`) and filled on Candidates.
- **A Template whose Style Preset was deleted** applies Default, as on Candidates.

**Blocked by:** 01.

**Status:** done

- [x] Pure tests:
  - The style, Layout, Grade and Clip volume are replaced.
  - The treatment reaches three Source Segments, and their Speed and fades are kept.
  - The Kicker is replaced only when the Template has one, and the hook text is never touched.
  - `{title}` and `{kicker}` are filled, an empty Kicker leaves nothing with a notice, and `{hook}` drops the `*` marks.
- [x] HTTP: a Template naming a deleted Style Preset applies Default.
