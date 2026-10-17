# 08: The Text Preset library

**Parent spec:** `spec.md` (Solution "Text Presets"; Implementation Decisions "Text Presets (new library)", "MCP"); GLOSSARY (Text Preset).

**What to build:** looks become a library the owner adds to, and the agent can use.

- **Built-in Presets are data files shipped with the app**, one per Preset: a stable id, a name, a category, an order, a sample text, and a Text Style laid over the defaults. This ticket ships the 4 existing looks (Text, Title, Label, Subtitle) as the first built-ins. The hard-coded list in the frontend goes.
- **The owner's Presets** are kept in one file in the data directory, written atomically, as Style Presets are. They can't take a built-in id.
- **Use for new titles:** one Preset id is stored as the default. It is built-in Text at first, and falls back to it when its Preset is deleted.
- **API:** list (built-in and the owner's, with the default marked), save a Text Style with a name, rename, delete (refused for built-ins), and set the default. Changes are broadcast on the existing events.
- **The Text tab:**
  - shelves "Mine" first, then built-ins by category, each drawn in its look;
  - click adds a Text Layer at the playhead, and dragging onto the timeline still works;
  - an Add text button uses the default;
  - each Preset's menu offers Use for new titles, and Rename and Delete for the owner's.
- **Inspector:** "Save as Text Preset" on a Text Layer. "Apply look" on the picked Text Layers replaces their Text Style only (words, Transform and Keyframes kept), as one undo step.
- **A Text Layer copies its Preset's look;** nothing links them.
- **MCP:** `list_presets`, `save_preset` and `delete_preset` take `kind: "text"`, and the default can be set. A Text Layer given without a style takes the default's Text Style.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] The 4 built-ins are listed with stable ids, and can't be changed, renamed or deleted.
- [ ] An owner's Preset can be saved, renamed and deleted, and survives a restart.
- [ ] Changing or deleting a Preset leaves Text Layers made from it unchanged.
- [ ] Deleting the default Preset makes built-in Text the default.
- [ ] Add text and an MCP Text Layer without a style both take the default's look.
- [ ] Apply look on two picked layers changes their style only, and one undo restores both.
- [ ] A Preset saved by the agent appears in an open Text tab without reloading.
