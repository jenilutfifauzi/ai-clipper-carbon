# 04: Recording settings

**Parent spec:** `spec.md` in this feature folder (Solution "Settings"; Implementation Decisions "the take flow"); ADR 0018.

**What to build:** a chevron beside the mic button opens a popover holding:
- **the choice of microphone**, listed from the browser's inputs, with labels once permission is given;
- **"Hear the Clip (headphones)"**: with it on, the master bus stays audible while recording;
- **a test meter** reading the chosen input.

The browser remembers the choice of input and "Hear the Clip" in localStorage, with every read and write wrapped in try/catch, as the workspace layout is. A remembered input that is gone falls back to the default. The popover follows the editor's existing popover idiom, and is reachable by keyboard.

**Blocked by:** 02 (Record a Take).

**Status:** done

- [x] The popover lists the inputs, and the next Take records from the one chosen (vitest, fake `enumerateDevices` / `getUserMedia`).
- [x] With "Hear the Clip" on, the bus stays audible while recording; with it off, the bus is silent (vitest).
- [x] Both settings survive a reload, a broken localStorage doesn't break the page, and a missing remembered input falls back to the default (vitest).
- [x] The test meter moves with the chosen input and stops when the popover closes (vitest).
