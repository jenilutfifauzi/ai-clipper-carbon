# 10: Changed-since-render, and the editor's final layout

**Parent spec:** `spec.md` in this feature folder (user story 28).

**What to build:**
- **Staleness:**
  - `RenderedClip.inputs`: a hash of everything a render used (range, hook, resolved styles, edits, timing, Layouts);
  - `JobDetail` gives each Candidate's current hash;
  - Clips show "changed since this render" when the two differ.
- **Editor layout.** `CandidateEditor` gets its final layout: the preview and the tabs side by side on wide screens, with the timeline full width below.

**Blocked by:** 01–09.

**Status:** done

- [x] Any edit from tickets 01–09 marks a rendered Clip as changed, and undoing it clears the mark.
- [x] Old `clips.json` files without `inputs` still load. They compare by the v1 fields.
- [x] Browser walkthrough of every user story, in dark and light, at a laptop and a narrow width.

## Comments

**2026-10-14: done.** `make test`: 298 passed (1 new Seam A test). `npm run typecheck` and `npm run build` pass. Checked in a browser on the scratch clone.

**Change from the plan:** there is no `inputs` hash.
- A hash would have to be recomputed and sent for every Candidate after every edit.
- Instead, `RenderedClip` records the editor's edits as rendered (Preset, overrides, Word Edits, hook timing, Layout Overrides) and the styles they resolved to.
- The Clip card compares those with the Candidate as it is, and with its Preset's current styles (Presets loaded once with the Clips). So an updated Preset also marks its Clips changed.
- A Clip rendered before the editor (fields `null`) is compared by range, hook text and layout, as before.

Built:
- **Backend:** the new `RenderedClip` fields (all optional, so old `clips.json` files load), filled by `_render`.
- **`Clips.tsx`:** `changedSince(candidate, output, presets)` with key-order-independent deep equality.
- **Editor layout:**
  - **Wide (xl):** the preview column (20 rem, sticky) beside tabs. The tabs are Text (caption words), Style (Style panel), Hook (text and timing) and Clip (the clip's layout and the Transcript Picker). They follow the tab pattern: `role=tablist`, ←/→ between tabs.
  - **Below them, full width:** the timeline and the picked Scene's layout.
  - Clicking a caption block switches to Text. Narrower screens stack everything.
- **README:** the daily workflow describes the editor, and `presets.json` is listed under data.

**Browser check** (2f6cdf1b, rendered again with this code):
- No "Changed since this render" note after the render. Caption size 150 showed it, resetting the size cleared it, and changing the hook's time showed it again.
- The render had transcribed the trimmed range afresh with Whisper ("Yuh" for "yuk"), and the 3 Word Edits made earlier on the episode transcript's Words still applied: ticket 06's re-transcription criterion, seen on real data.
- **Laptop width:** preview and tabs side by side.
- **390 px:** no horizontal page scroll (`scrollWidth` 390), and the timeline scrolls within its box.
