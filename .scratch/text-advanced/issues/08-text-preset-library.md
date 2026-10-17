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

**Status:** done

- [x] The 4 built-ins are listed with stable ids, and can't be changed, renamed or deleted.
- [x] An owner's Preset can be saved, renamed and deleted, and survives a restart.
- [x] Changing or deleting a Preset leaves Text Layers made from it unchanged.
- [x] Deleting the default Preset makes built-in Text the default.
- [x] Add text and an MCP Text Layer without a style both take the default's look.
- [x] Apply look on two picked layers changes their style only, and one undo restores both.
- [x] A Preset saved by the agent appears in an open Text tab without reloading.

## Comments

**2026-10-17 (agent):** Built.

**What was built:**
- **The library** is `backend/app/text_presets.py`: `TextPreset` (id, name, style, sample, category, order, builtin) and `TextPresetStore`.
  - Built-ins are one JSON file each in `backend/assets/text-presets/` (`TEXT_PRESETS_DIR`; tracked, unlike `assets/fonts`). A file holds `id`, `name`, `category`, `order`, `sample` and `style`. The style is any of the Text Style's fields, laid over the defaults; the shadow and the plate are laid field by field.
  - `builtin_text_presets(folder)` loads them, sorted by `(order, id)`. It refuses an unknown field (top-level or in the style, e.g. `style.plate.colr`), a bad value and two files with one id, naming the file. **Ticket 09 adds a built-in by adding a file, nothing else.** A built-in `text` must exist.
  - The owner's Presets and the id used for new titles are in `DATA_DIR/text-presets.json` (`{"default": …, "presets": […]}`), written with `write_atomic` under a lock, as Style Presets are. A new id is 8 hex characters and never a built-in id. Built-ins raise `BuiltinPreset` and unknown ids `PresetNotFound` (both reused from `app/styles.py`).
  - `default()` returns the chosen Preset, or built-in Text when it is gone. Deleting the chosen one also resets the stored id.
- **The 4 old looks** are the files `text`, `title`, `label` and `subtitle` (categories Basic, Titles, Labels and Subtitles; orders 10, 100, 200 and 300, leaving gaps for ticket 09). Their styles equal the old frontend `TEXT_PRESETS`, plate padding and radius included.
- **API** (`backend/app/api.py`):
  - `GET /api/text-presets` lists every Preset as `TextPresetInfo`: the Preset plus `default: bool`.
  - `POST /api/text-presets` takes `{name, style}` and answers 201.
  - `PATCH /api/text-presets/{id}` takes `{name?, style?}`: rename, restyle or both. 409 for a built-in, 404 for an unknown id.
  - `DELETE /api/text-presets/{id}` answers 204, 409 or 404.
  - `PUT /api/text-presets/default` takes `{id}` and answers 404 for an unknown id.
  - `face_uses` now lists the owner's Text Presets as `kind: "text_preset"` ("Text Preset <name>"), so deleting a Face they name is refused.
- **Broadcast:** `TextPresetStore.watch` feeds `candidate_events`. It sends a `text_presets` event (`{ids}`) on every save, change, delete or new default. `useCandidateEvents` then calls `reloadTextPresets()`, so an open Text tab and the Apply look picker list them again.
- **MCP** (`backend/app/mcp_server.py`):
  - `list_presets(kind="text", include_styles)` gives id, name, category, builtin and default; with `include_styles`, also sample and style.
  - `save_preset(kind="text", preset={name, style}, preset_id?, use_for_new_titles?)` creates a Preset, or PATCHes it with `preset_id`. `use_for_new_titles` then makes it the default. A `preset_id` given alone with `use_for_new_titles` makes that Preset the default, built-in ones too.
  - `delete_preset(kind="text")`.
  - A new Text Layer's style is laid over the default Preset's. This covers a layer given without a style (or with only some of its fields) in `edit_candidate` (a BeforeValidator on `changes`, so the dry run too) and a new item in `merge_candidate_items`. A change to an existing layer merges into its own style, as before.
  - The server instructions have a Text Preset paragraph.
- **Frontend:**
  - `src/textPresets.ts` is the store (`useTextPresets`, `reloadTextPresets`, `saveTextPreset`, `renameTextPreset`, `deleteTextPreset`, `chooseForNewTitles`) and holds `shelvesOf` and `forNewTitles`.
  - `advanced/TextPresets.tsx` holds `lookOf`, `TextAssets` (the Text tab), `SaveAsTextPreset` and `ApplyLook`.
  - The Text tab has Add text (the default Preset), then the "Mine" shelf, then the built-in shelves, each tile drawn in its look. The ⋯ menu is a top-layer popover so the panel doesn't clip it. It offers Use for new titles, plus Rename (inline) and Delete (with confirmation) for the owner's.
  - A dragged tile carries the Preset id (`DRAG_TEXT`).
  - The inspector has Apply look (a select) in the Look group of one or several Text Layers, and Save as Text Preset for one. `actions.applyLook` makes one Outcome, so it is one undo step.
  - The hard-coded `TEXT_PRESETS` is gone, and so is its test in `textStyle.test.ts`. The backend tests now check the looks.
  - I checked the flow in the built app on a copy of a real Job: add, save, Apply look, Use for new titles, rename, Add text in the chosen look, and delete falling back to Text.

**Decisions:**
- **A Preset is a Text Style only,** as the spec says. A Text Layer made from one starts at the frame's centre with no animations, its words the Preset's sample. So the old Title (y 700, Pop in) and Subtitle (y 1400, Fade in/out) no longer bring their place and motion; their looks are unchanged.
- **The owner's Preset's sample is its name,** set on save and on rename.
- **Shelves:** built-in categories appear in the order of their first Preset's `order`.
- **`save_preset` with kind "text"** replaces the style as a whole when it is given (as a Style Preset's save does), rather than merging it field by field. Without a style, it renames only. Its `preset` is typed `PresetBody | TextPresetGiven`, where `TextPresetGiven` is a name and a free `style` object, validated by the API. This keeps the Text Style schema out of a second tool. The budget still grew: `TOOLS_BUDGET_BYTES` went from 67,500 to 68,500 (about 67.8 KB now).
- I didn't refuse wrap_width or fixed_height in a Preset's style. `TextLayer._check_drawn` refuses them on a layer until ticket 03 lands.

**Left:** nothing for this ticket. Ticket 09 adds its 27 files to `backend/assets/text-presets/` and may want shelf tiles to show a shadow. The tiles already draw it scaled, as a CSS `text-shadow`.
