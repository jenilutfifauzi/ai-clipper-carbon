# 05: Lengths that don't fit

**Parent spec:** `../spec.md` (Apply step 4). See also GLOSSARY (Anchor) and ADR 0023.

**What to build:** on a much shorter or longer Candidate, a Template's layers still behave. Fades stay at their edges, music never runs past its song, and what can't fit is trimmed or dropped, and I'm told.

- **Keyframes:** those in a layer's first half keep their distance from its start, and those in its second half keep their distance from its end. Volume Keyframes count too.
- **Music Clips** are clamped to their song's length at their Speed, with a notice. They never loop.
- **A layer reaching outside the Clip** is trimmed, and dropped when shorter than the editor's least item length, with a notice. Its Keyframes follow the trim, as the Clipboard does.
- **A Span whose edges cross** on a short Candidate is dropped, with a notice.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Pure tests:
  - A Span lower-third with an opacity fade in its last 0.5 s keeps that fade at its end on a 20 s and a 75 s Candidate.
  - A 30 s song as a Span on a 75 s Candidate stops at 30 s, with a notice.
  - An End layer on a 5 s Candidate is trimmed or dropped, with notices.
  - A crossed Span is dropped.
