# 07: Advanced Edit items

**Parent spec:** `spec.md` in this feature folder (user stories 10–12).

**What to build:**
- `merge_candidate_items`: Text Layers, Music Clips, Overlays and Segments by `id`, Transitions by `after`, Word Edits and Layout Overrides by `at`, Style Overrides per section; one PATCH of what changed.
- `remove_candidate_items(kind, keys)`.

**Blocked by:** 04, 06.

**Status:** done

- [x] A Text Layer added, changed by id and removed; the others are kept, in order.
- [x] A Word Edit replaced at the same `at`.
- [x] A Style Override merged into its section, leaving the others.
- [x] Music from a Media Library item; an unknown item returns the API's message.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_mcp.py`:
  - Two Text Layers added; one changed by id keeps its other fields (y); a new one without `secs` is refused with the API's message.
  - A Word Edit replaced at the same `at`, another added, in order.
  - Style Overrides merged into their section, leaving the other section.
  - Removing a Text Layer, a Word Edit and a style override (`caption.size`); removing an unknown item is an error.
  - Music naming an unknown media item returns the API's message.

**Changes from the plan:**
- An item is merged field by field: the tool's schema for each kind has every field optional but its key (generated from the item's dataclass), so changing a Text Layer's text keeps its position and look.
- `remove_candidate_items` also removes style overrides, by `section.field`.
