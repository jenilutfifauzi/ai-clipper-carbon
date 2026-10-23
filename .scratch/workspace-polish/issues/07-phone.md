# 07: Phone

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- The phone player uses the deck Transport (04) and the panel look; Toolbar and Sheets keep their structure; the Toolbar has no Audio tab (Media covers it).

**Blocked by:** 03, 04

**Status:** ready-for-agent

- [ ] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.
