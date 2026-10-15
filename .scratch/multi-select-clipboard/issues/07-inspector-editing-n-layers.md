# 07: Inspector: "Editing N layers"

**Parent spec:** `spec.md` in this feature folder (user stories 48–51).

**What to build:** with only Text Layers picked, the inspector restyles all of them at once.

- **The header** reads "Editing N layers".
- **The fields:** font, size, colour, outline and its colour, box with its colour and opacity, align, and the in/out animations with their length.
- **Values:** each field shows the shared value, or "Mixed" where the picked layers differ.
- **A change** writes that one value to every picked Text Layer. A slider or typing is one gesture group, so one undo step.
- **Hidden:** the words and the position.
- **Any other Pick of several items** keeps the summary from ticket 02.
- **The rule for the shared value** (shared value or Mixed) is a small pure function tested in Seam D.

**Blocked by:** 02.

**Status:** done

- [x] Seam D: the shared fields of several Text Layers give each field's common value, or Mixed. Setting a field changes exactly that field on every picked layer.
- [x] In the browser:
  - [x] two Text Layers with different looks show "Mixed" on the fields they differ in;
  - [x] picking a font sets both, and one undo restores each one's own.
- [x] Typecheck, test, build.

## Comments

**2026-10-15: done.** A field the picked Text Layers differ in shows the first one's value with a Mixed mark (the controls' existing `marker` slot; sliders print "Mixed" for their value), and the colour, box and animation fields that only some use show when any one uses them. Checked in the browser with two Text Layers from different presets.
