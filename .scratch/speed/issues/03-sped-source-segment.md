# 03: A sped Segment of the Source

**Parent spec:** `spec.md` in this feature folder (user stories 1, 7–8, 13–14; Solution "Captions of a Segment at Speed", "Word snapping"; Implementation Decisions "The planner", "The preview"); ADR 0009, ADR 0002.

**What to build:** a Segment of the episode at a Speed plays with its captions in time with its speech, its Word Edits on their Words, and its Layout and face tracking framed as at 1×. Through MCP; the editor UI comes in 05.

- **Planner.** Words of the Segment placed on the Timeline through the mapping's inverse, so caption lines and highlights follow. Word Edits and Layout Overrides matched by Source time as today. Scenes and the camera path of its analysis scaled by 1 ÷ Speed.
- **Snapping.** Unchanged: its ends snap to Words on the Source, and the longest-clip limit applies to its range as today and to the Clip on the Timeline.
- **The editor's preview words** (for Word Edits) get Timeline times through the mapping, so the clip editor's caption editing finds them.
- **A one-Segment Clip at a Speed is stored as its Segments,** not folded back into `start`/`end`.
- **Renderer.** The Source Segment's read, Scenes and sound through the same chain as 02, with the Clip's own volume.
- **Preview.** The decks play a Source Segment at its Speed × the preview rate with `preservesPitch`; the parked deck is set to the next Segment's rate on a swap; the Transition ghost plays the outgoing Segment at its rate.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] A 2× Source Segment's Words land at half their offsets from the Segment's Timeline start; at 0.5× at twice.
- [ ] A Word Edit on a Word of a 0.5× Segment is applied in the plan and the dry run.
- [ ] A Layout Override at a Source time inside a 2× Segment applies to the Scene holding it, at its scaled Timeline span.
- [ ] Rendered at 1.5×, the burned captions match the speech (checked against the plan's caption events) and the Clip's length is the range ÷ 1.5.
- [ ] A one-Segment Clip saved at 2× reloads with its Speed.
- [ ] In the preview, two Source Segments at 1× and 2× join seamlessly on the decks, the second at twice the rate, with the captions in time.
