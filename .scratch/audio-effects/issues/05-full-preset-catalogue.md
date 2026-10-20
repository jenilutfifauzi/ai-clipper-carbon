# 05: The full preset catalogue

**Parent spec:** `../spec.md` ("Catalogue module").

**What to build:** the effect library offers all 22 presets, matched in behaviour and settings to Concat's (never copied). Telephone, Echo and Pitch came in 01; this ticket adds the other 19.

- **Voice:** Sweet, Deep, Chipmunk, Robot, Megaphone, Whisper.
  - Pitch-type ones keep the item's length: rate change, resample, then tempo-correct.
- **Tone:** Bass, Treble, Bright, Radio, Vinyl, Lo-fi, Distorted.
  - Most end in a limiter.
- **Space:** Room, Hall, Plate, Cathedral, Stadium, Underwater.
  - Room, Hall, Plate, Cathedral and Stadium are multi-tap `aecho`, scaled by size.

Each preset has its own settings, one marked as the intensity, each with a range and a default. Built-in effects never change their sound in a later version; a revision is a new id.

**Blocked by:** 01.

**Status:** done

- [x] All 22 presets are in the registry, with groups and orders.
- [x] Every preset runs at its default, minimum and maximum over a 1 s tone, without error and at the input's length.
- [x] Seam A spot checks: Deep lowers a tone's pitch, Chipmunk raises it, Underwater removes energy above 1 kHz, and Hall leaves a tail inside the item.
- [x] `list_assets(kind="audio_effects")` lists them all.
