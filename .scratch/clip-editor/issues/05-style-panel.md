# 05: Style panel

**Parent spec:** `spec.md` in this feature folder (user stories 8–19).

**What to build:**
- **Components** in `frontend/src/components/`: `Slider`, `ColorField`, `Select`, `Popover`, in the glass design system.
- **`StylePanel`:**
  - a Preset picker;
  - caption controls: font, size, colour, highlight colour, outline, shadow, case, highlight, position, and line limits;
  - hook style controls.
- **Overrides.** A field that differs from the Preset is marked and can be reset.
- **Preset actions.** "Save as preset" (asks for a name) and "Update preset". Neither is offered for a built-in Preset.

**Blocked by:** 01, 04.

**Status:** done

- [x] Each change previews at once and is saved after 700 ms, like the hook text.
- [x] Overrides are stored only for fields that differ from the Preset.
- [x] Every control is keyboard reachable and labelled, in dark and light themes.

## Comments

**2026-10-14: done.** `npm run typecheck` and `npm run build` pass. Checked in a browser on the scratch clone (test server on :8010).

Built:
- **Components:**
  - `Slider`: label, value output and a native range with the accent colour.
  - `ColorField`: system picker swatch and an editable `#RRGGBB` code, taken once it is a whole colour.
  - `Select`: a native select in the field look, with an optional style for the shown value (the font).
  - **`Popover` is moved to ticket 09**, its first user (the Scene's Layout popover).
- **`editor/StylePanel.tsx`:**
  - **Preset picker.** Switching Preset clears the overrides.
  - **Controls:** captions (font, size, colours, outline, shadow, highlight, position with a custom height, UPPERCASE), line breaks (most characters, most words, longest on screen, pause), and hook style (font, size, colours, box opacity, radius, position with a custom height).
  - **Overrides.** Each control shows the resolved value. A value equal to the Preset's removes the override. An overridden field shows an accent reset button labelled "Reset <field> to the preset".
  - **Saving.** Changes go to the preview at once (`onDraft`) and are saved after 700 ms, or when the Candidate is left.
  - **Preset actions.** "Reset all"; "Save as new" (an inline name form) saves the resolved look and switches the Candidate to it. "Update preset" (the owner's Presets, with overrides) bakes the overrides in. Delete has a confirm dialog and moves the Candidate to Default.

**Browser check** (2f6cdf1b):
- **Box highlight + size 140:** the preview showed the purple box behind the spoken Word and the purple hook box. The Candidate was saved with `preset_id: box-highlight` and `style_overrides: {caption: {size: 140}}`, `edited: true`, and only "Reset size to the preset" appeared.
- **Rendered on the test server:** the frame at 1.5 s matches the preview (box behind "SAYA", line size, hook).
- **"Save as new" ("Ungu besar"):** made the Preset with size 140 and moved the Candidate to it with no overrides. Deleting it moved the Candidate to Default.
- **Light theme:** the panel reads correctly.
