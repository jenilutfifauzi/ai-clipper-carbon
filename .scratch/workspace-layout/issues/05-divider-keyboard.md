# 05: Dividers on the keyboard

**Parent spec:** `../spec.md` (Solution "Keyboard"; Implementation Decisions "Dividers", keyboard); GLOSSARY (Divider).

**What to build:** make each Divider a `separator` the keyboard can reach and size — a pattern the codebase doesn't have yet.

- **Roles:** `role="separator"`, `tabindex=0`, `aria-orientation` (`vertical` for the sidebar Dividers, `horizontal` for the bottom one), and `aria-valuenow`/`-valuemin`/`-valuemax` tracking the size.
- **Keys:** the arrows resize by `16px`, Shift by `64px`, clamped as a drag is; `Enter` resets the Divider (as a double-click).
- **Focus order:** Asset Panel → its Divider → player → Inspector's Divider → Inspector → Bottom tabs → the bottom Divider.
- A **collapsed sidebar renders no separator**.

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] Tab reaches each Divider in the stated order.
- [ ] The arrow keys resize by the step and Shift by the larger step, both clamped; `Enter` resets.
- [ ] `aria-valuenow` follows the size and `aria-orientation` is right per Divider.
- [ ] A collapsed sidebar exposes no focusable separator.
- [ ] vitest for the key handling and the ARIA; a browser/screen-reader spot-check.

## Comments
