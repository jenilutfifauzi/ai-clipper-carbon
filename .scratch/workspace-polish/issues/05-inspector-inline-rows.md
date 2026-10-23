# 05: Inspector inline rows and collapsible groups

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- An Inspector-only context makes `Group` (`editor/StyleFields.tsx`) collapsible (chevron header, like `MoreOptions`) and `Slider`/field rows inline: label left, value/control right; a slider's track spans the full width under the row only where needed. The clip editor is unchanged.
- Which groups are folded is remembered by the browser per group title, in the workspace layout store (`workspaceLayout.ts`), clamped/normalised like its other fields.

**Blocked by:** None

**Status:** done

- [x] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.

## Comments

- `components/inspectorLayout.ts` holds the Inspector-only context (`InspectorLayout`, folded titles + `onFold`); `Inspector.tsx` provides it from `layout.use().foldedGroups`. `Group` becomes a `<details>`/`<summary>` with a chevron (named `group/fold` so a nested `MoreOptions` chevron isn't rotated by it); `Slider` is one row label | track | value, except with an `after` (Keyframe cluster), where it keeps the stacked row with the full-width track; `Switch` (own label only, not `labelledBy` rows), `Select` and `ColorField` put the label in a 38% left column. `Segmented` and the Transform `NumberField` 2-column grid stay stacked (they need the width). The Inspector-only 2-column grids in `TextLayers.tsx` (Motion) and `TextStyleGroups.tsx` (Plate padding) are stacked so the inline rows fit.
- Without the context every field renders byte for byte as before: `inspectorInline.test.tsx` compares against markup rendered from the pre-ticket components.
- `foldedGroups: string[]` in the workspace layout store: strings only, deduped, at most `MAX_FOLDED` (64, the latest) since some titles carry a number. `resetLayout` clears it (every group open again); `setGroupFolded` writes nothing when unchanged. `layout.use` now passes a server snapshot so the Inspector renders under `renderToStaticMarkup`.
- Phone: the Inspector's Sheet gets the inline rows and folding too (a phone sheet is wider than the desktop Inspector column).
