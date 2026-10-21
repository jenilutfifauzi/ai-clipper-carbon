# 05: Narrate a picked Text Layer or the hook

**Parent spec:** `spec.md` in this feature folder (User Stories 4–7; Implementation Decisions "Frontend" (pre-filling)); ADR 0019.

**What to build:** a title is read aloud exactly when it appears. Opening the Narrate tab with a Text Layer or the hook picked fills the script with its words (lines joined by spaces) and fixes the start at its start, not the playhead. With several picked, the earliest on the Timeline wins. The owner can still edit the script before generating.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Vitest: a picked Text Layer fills the script and the Narration lands at the layer's start.
- [ ] Vitest: the picked hook does the same.
- [ ] Vitest: with several Text Layers (and the hook) picked, the earliest wins.
- [ ] Vitest: an edited script is what is sent, and the start stays the item's.
- [ ] Vitest: with nothing of these picked, the start is the playhead.
