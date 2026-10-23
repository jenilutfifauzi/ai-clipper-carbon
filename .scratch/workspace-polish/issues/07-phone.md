# 07: Phone

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- The phone player uses the deck Transport (04) and the panel look; Toolbar and Sheets keep their structure; the Toolbar has no Audio tab (Media covers it).

**Blocked by:** 03, 04

**Status:** done

- [x] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.

## Comments

- The phone player sits in a `panel` with the same `PreviewHeader` and the deck Transport from ticket 04 (in a narrow player its buttons take their own row above the timecode and Take/Hold/Fullscreen; rate and loop stay in the Playback sheet). Below a 26rem header the format line hides so the AspectPicker fits.
- Toolbar and Sheets keep their structure; `PHONE_ASSET_TABS` has no Audio (ticket 03), and the Media sheet has the category chips. Undo/Redo are in the timeline toolbar (ticket 06).
- Ran deckTransport, mediaTab, phoneColor, phoneMixing, phoneSpeed, phoneAudioEffects, narrate and aspectPicker tests; `tsc --noEmit` clean; `vite build` emits the `panel` utility and the `@container media` query. Not yet checked in a real browser (screenshots at desktop/phone widths, light and dark).
