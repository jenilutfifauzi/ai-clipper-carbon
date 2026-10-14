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

**Status:** ready-for-agent

- [ ] Each change previews at once and is saved after 700 ms, like the hook text.
- [ ] Overrides are stored only for fields that differ from the Preset.
- [ ] Every control is keyboard reachable and labelled, in dark and light themes.

## Comments
