# 03: Asset tabs and one Media tab

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- `AssetTabs`: icon above a small label, active tab on a filled background (Concat style), still a container query to drop labels when narrow.
- The Audio tab merges into Media. Media gets a sub-nav (narrow left column on desktop, chips on a phone): All / Video / Audio / Images. All shows the Source picker, videos, images and audio sections; each category filters. Uploading still works per kind.
- `PHONE_ASSET_TABS` and every place that opens the `audio` tab (e.g. Toolbar, Add audio) now open Media on its Audio category.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.
