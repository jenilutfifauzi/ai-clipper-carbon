# 09: 31 built-in Text Presets

**Parent spec:** `spec.md` (Solution "Text Presets"; Implementation Decisions "Text Presets (new library)"; Further Notes on Concat).

**What to build:** a full set of starting looks, designed for this app's short vertical Clips.

- 31 built-in Presets as data files, including the 4 from ticket 08 under their ids. They are grouped into a handful of categories (for example titles, labels, subtitles, stickers, quotes, callouts), each with an order and a sample text.
- They use the bundled Faces (ticket 07) and the whole Text Style: stroke, shadow, Block and Strips plates, radius and padding, line height, tracking, and wrap width where a look is a card.
- Concat's kinds of preset are inspiration only. None of its data or fonts are copied.
- Each Preset is checked by eye in a rendered frame. A contact sheet of all 31 is kept in this ticket's comments.

**Blocked by:** 03, 07, 08.

**Status:** ready-for-agent

- [ ] 31 built-ins are listed, each with a unique stable id, a category and a sample, and each validates as a Text Style.
- [ ] Every built-in renders without error in a short Clip, and its picture matches its tile in the Text tab.
- [ ] Every Face a built-in names is bundled.
- [ ] A contact sheet of the 31 rendered looks is attached in Comments.
