# 06: Clean switches: Reduce noise, Enhance voice, Normalize loudness

**Parent spec:** `../spec.md` ("Catalogue module", "Normalize loudness", "Editor actions", "Inspector UI"); ADR 0017.

**What to build:** three switches at the top of the Inspector's Audio effects section, each showing its slider when on.

**The switches:**
- **Reduce noise** (strength 0–100, default 50): `afftdn`, with the strength mapped to noise floor and reduction. No model is shipped.
- **Enhance voice** (amount 0–100, default 60): a high-pass, light denoise, de-ess, compressor and limiter, scaled by the amount.
- **Normalize loudness** (target −30 to −12 LUFS, default −23):
  - The item's sound is measured up to that entry, then a steady `volume` gain is applied to reach the target, with a true-peak limiter at −1.5 dBTP.
  - A silent item gets no gain.
  - The measurement is cached with the Effected copy's key, so the preview and the render agree, and a render can reuse it.
  - The final loudness on the mix is unchanged.

**Where they land in the stack:**
- Reduce noise, then Enhance voice, go at the top when switched on.
- Normalize goes at the bottom.
- Switching one off removes its entry. They can be moved afterwards.

They are catalogue entries in the Clean group, hidden from the library. With several items picked, a switch applies to every sounding item.

**Blocked by:** 03, 04.

**Status:** ready-for-agent

- [ ] Seam A: Reduce noise lowers the level of a noise bed under a tone, and keeps the tone.
- [ ] Seam A: Enhance voice runs and keeps the item's length.
- [ ] Seam A: Normalize brings a quiet tone and a loud one near the target, steady over their length (no pumping).
- [ ] Seam A: the render reuses the cached measurement when one exists.
- [ ] Vitest: insert positions for each switch, alone and together with presets; switching off; a mixed Pick.
- [ ] The library doesn't list the Clean three. `list_assets` does.
- [ ] Walkthrough: switch on Reduce noise on the Source, hear "Preparing effects…" and then the cleaned sound.
