# 05: Inspector inline rows and collapsible groups

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- An Inspector-only context makes `Group` (`editor/StyleFields.tsx`) collapsible (chevron header, like `MoreOptions`) and `Slider`/field rows inline: label left, value/control right; a slider's track spans the full width under the row only where needed. The clip editor is unchanged.
- Which groups are folded is remembered by the browser per group title, in the workspace layout store (`workspaceLayout.ts`), clamped/normalised like its other fields.

**Blocked by:** None

**Status:** ready-for-agent

- [ ] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.
