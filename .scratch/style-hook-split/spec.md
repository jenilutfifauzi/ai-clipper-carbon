# Style and Hook split: one tab per thing

Status: done
Created: 2026-10-14

## Problem Statement

The editor's **Style** tab holds the Caption Style and the whole Hook Style (Shape, text, box, Quote Mark, Kicker colours, position, animation) in one long panel. The **Hook** tab holds only the hook's words and timing. So the Hook is split across two tabs, and the Style tab mixes two things. It is confusing to use.

## Solution

- **Tabs:** Text · **Captions** · **Hook** · Trim.
  - **Captions:** the Caption Style only.
  - **Hook:** everything about the Hook: its words, its look, and when and where it shows.
- **Style Preset picker:** one row above the tabs. A Preset still holds a Caption Style and a Hook Style together (GLOSSARY: Style Preset), so it belongs to neither tab. A hint under it says so.
- **Each tab shows its everyday controls.** The rest sit behind one **More options** disclosure, whose summary counts the Style Overrides inside it ("2 changed"), so a hidden change is never invisible.

**Replaces a rule of `hook-styles/spec.md` ("Subheadings, not accordions: everything stays visible").** The panel grew too long to scan, and the user asked for the simplest UI.

## User Stories

1. As a clipper, I change the captions' look in the Captions tab without scrolling past hook controls.
2. As a clipper, I write the hook, style it and time it in the Hook tab, without switching tabs.
3. As a clipper, I pick a Style Preset once, above the tabs, and see captions and hook change together.
4. As a clipper, I see the few controls I use most, and open More options for the rest.
5. As a clipper, I can tell when More options holds changes from the Preset.

## Implementation Decisions

- **One style draft for both tabs.** `useStyleDraft` (in `CandidateEditor`) owns the `StyleDraft` through `useDraftSave`:
  - edits are saved 700 ms after they pause, and at once when the Candidate changes;
  - both tabs edit the same draft, so neither overwrites the other's changes.
- **Captions, always shown:** font, size, text colour, highlight colour, "Highlight the spoken word", position, UPPERCASE.
  - **More options:** outline and shadow with their colours, and Line breaks.
- **Hook, always shown:**
  - **Words:** Kicker, hook text with Emphasis, the fit message.
  - **Look:** Shape cards; font, size, text colour, Emphasis colour, and box colour (not for No box).
  - **When and where:** position; "Comes on at", "Stays for".
  - **More options:** lines, alignment and capitals; box opacity and radius; outline and shadow; Quote Mark; Kicker colours; animation.
- **More options** is a native `<details>`:
  - keyboard-operable, with a focus ring;
  - the chevron turns (150 ms ease-out, motion-safe only); the content is not height-animated;
  - whether it is open is kept per tab while the editor is open.
- **Kept as they are:** override markers and reset per field, hidden controls keeping their values, live preview.

## Testing Decisions

The frontend has no test runner. Checks are `npm run typecheck`, `npm run build`, and a browser walkthrough:
- edits in both tabs inside 700 ms are both saved;
- a Preset change moves captions and hook together;
- the More options count;
- keyboard and both themes.

## Out of Scope

- Splitting a Style Preset into separate caption and hook Presets.
- Backend changes.
