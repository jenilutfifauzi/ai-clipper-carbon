# 01: One style draft, and the Preset bar above the tabs

**Parent spec:** `spec.md` in this feature folder (user story 3; "One style draft for both tabs").

**What to build:**
- **`editor/useStyleDraft.ts`:**
  - loads the Presets;
  - owns the `StyleDraft` through `useDraftSave`;
  - resolves the Caption Style and Hook Style;
  - offers `set`, `reset`, pick, reset all, and the Preset saved and deleted handlers.
- **`StyleMarker`:** the reset-to-Preset button, as a component both tabs use.
- **`editor/PresetBar.tsx`:** the Preset picker and its actions, moved out of `StylePanel`. It is rendered above the editor's tabs, with a hint that a Preset sets captions and hook together.
- **`CandidateEditor`:** reads the draft for the preview from the hook instead of `styleDraft`.

**Blocked by:** none.

**Status:** done

- [x] A change previews at once and is saved after 700 ms, or at once on leaving the Candidate.
- [x] Changes in two tabs within 700 ms are both saved.
- [x] Preset actions (pick, reset all, save as new, update, delete) work as before.

## Comments

**2026-10-14: done.** `npm run typecheck` and `npm run build` pass.

Built:
- **`editor/useStyleDraft.ts`:** `useDraftSave` keyed by the Candidate holds the `StyleDraft`. `controls` (null while the Presets load) gives the resolved styles, `set`/`reset` per field, `pick`, `resetAll`, `saved` and `deleted`.
- **Change from the old panel:** picking a Preset is saved after the pause like any edit, not at once. Leaving the Candidate still flushes it.
- **`editor/StyleFields.tsx`:** `StyleMarker`, `countChanged`, `fontChoices`, `Group`, `StyleFieldsSkeleton`.
- **`editor/PresetBar.tsx`:** above the tabs, with the hint "Sets the captions and the hook together. Change either in its own tab." Its skeleton holds the bar's and the hint's height.

**Browser check** (1d5d363bec2e, scratch clone on :8010):
- Strips in Hook, then Size +2 in Captions and Outline +1 within 700 ms, saved together as `{caption: {size: 112, outline: 8}, hook: {shape: strips}}`.
- Reset all cleared both parts.
- Picking Box highlight saved `preset_id: box-highlight`.
