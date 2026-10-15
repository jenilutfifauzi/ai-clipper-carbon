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

**Status:** ready-for-agent

- [ ] Seam D: the shared fields of several Text Layers give each field's common value, or Mixed. Setting a field changes exactly that field on every picked layer.
- [ ] In the browser:
  - [ ] three Text Layers with different colours show "Mixed";
  - [ ] picking a colour sets all three, and one Cmd+Z restores them.
- [ ] Typecheck, test, build.
