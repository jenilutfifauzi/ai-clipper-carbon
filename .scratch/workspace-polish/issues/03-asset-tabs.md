# 03: Asset tabs and one Media tab

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- `AssetTabs`: icon above a small label, active tab on a filled background (Concat style), still a container query to drop labels when narrow.
- The Audio tab merges into Media. Media gets a sub-nav (narrow left column on desktop, chips on a phone): All / Video / Audio / Images. All shows the Source picker, videos, images and audio sections; each category filters. Uploading still works per kind.
- `PHONE_ASSET_TABS` and every place that opens the `audio` tab (e.g. Toolbar, Add audio) now open Media on its Audio category.

**Blocked by:** 01

**Status:** done

- [x] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.

## Comments

- `AssetTab` loses `audio`; `AssetTabs` is icon over a 10px label, the open tab on `bg-fill` with an accent icon, labels shown from a 24rem container (8 tabs).
- `MediaLibrary.tsx`: `MediaCategory`, `MEDIA_CATEGORIES`, pure `mediaSections()` / `uploadOf()` and a `MediaCategories` sub-nav (chips; with `column`, a narrow column once the Asset Panel's body is ≥20rem via `@container/media`, chips below that). `MediaAssets` takes per-kind upload accept/label/empty text and `uploads` (so All lists uploads under way once).
- `AssetPanel` takes `category`: All = Source picker + "Videos and images" + "Audio" sections; Video = Source picker + videos; Images; Audio (what the Audio tab was). `AdvancedEdit` keeps `mediaCategory` state; the desktop aside shows the column/chips, the phone Media sheet shows chips.
- Phone Toolbar: Adjust now sits right after the Filters tab. This fixes `phoneColor.test.tsx` "with nothing picked … Filters as the asset tab", which was already failing on the base commit 3894a03 (the Templates tab had landed between Filters and Adjust).
- New `mediaTab.test.tsx`; ran it with narrate, templatesTab, effectsTab, phoneColor, phoneMixing, phoneSpeed, phoneAudioEffects and mediaInUse (all pass), plus `tsc --noEmit`.
