# 04: Resize the hook and captions from a corner

**Parent spec:** `spec.md` in this feature folder (user story 5).

**What to build:**
- The selection frame's corners set the Style's `size` (hook 40–160, captions 40–200), keeping the centre where it is. While held, the preview scales the item about its centre; the next plan sets its lines and size.

**Blocked by:** 03.

**Status:** done

- [x] Browser: resize in both editors; the render matches the preview.

## Comments

**2026-10-15: done** (with 02: the corners are part of `StageHandles`).

**Checks:** Browser: the hook's bottom-right corner was pulled out, saved as `size: 144` with its middle kept, and Cmd+Z took it back as one step.
