# 06: Style Presets, assets and the Channel Profile

**Parent spec:** `spec.md` in this feature folder (user stories 12, 13, 15).

**What to build:**
- `list_presets`, `save_preset` (create, or replace by id), `delete_preset`.
- `list_assets(kind)`: fonts, Logos and Media Library items.
- `add_asset(kind, path)`: a Logo or a Media Library item from a local file, through the stores' own checks.
- `delete_asset(kind, asset_id)`: the API's message lists the Candidates still using an item.
- `get_channel_profile`, `set_channel_profile`.

**Blocked by:** 01.

**Status:** done

- [x] A built-in Preset can't be replaced or deleted.
- [x] A song added from a file is listed; one in use can't be deleted, and the message says where it is used.
- [x] A file that isn't media is a tool error with the store's message.
- [x] The Channel Profile round-trips.

## Comments

**2026-10-15: done.**

**Checks:**
- `tests/test_mcp.py`:
  - A Preset is saved, replaced and deleted; a built-in one can be neither replaced nor deleted.
  - A WAV and a PNG are added from files (which stay), and listed with the fonts.
  - A text file is refused as a Logo and as media.
  - A song used by a Candidate's Music can't be deleted, and the message names the Candidate.
  - The Channel Profile round-trips.
