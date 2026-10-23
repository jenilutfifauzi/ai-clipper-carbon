# 01: Flat panels

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- A `panel` utility in `frontend/src/index.css` beside `glass`: solid `--surface`, 1px `--border`, `rounded-panel`, no backdrop filter, no shadow.
- The Assets aside, Inspector aside, Bottom tabs section and Meters use `panel`; popovers, menus and sheets keep `glass`.

**Blocked by:** None

**Status:** done

- [x] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.

## Comments

- `panel` utility in `frontend/src/index.css` (surface fill, hairline border, `--radius-panel`, no blur/shadow). The Assets and Inspector asides, the Bottom tabs section and Meters use it; `Panel`, sheets, menus, popovers and dialogs keep `glass`. The player becomes a `panel` with ticket 04. Verified with `meters.test.tsx` and `tsc --noEmit`.
