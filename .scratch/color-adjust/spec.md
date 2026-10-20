# Color adjust: Grades, Looks, Imported Looks and Adjustment Layers

Status: ready-for-agent
Created: 2026-10-20

## Problem Statement

A Clip's picture is shown as it was shot. There is no way to change its colour anywhere: not in the clip editor, not in the Advanced Edit, not through the agent.

**Podcast footage often looks flat or off.** Typical problems:
- a warm or green cast from room lights;
- a dark speaker;
- washed-out contrast.

The owner can't correct any of this before the Clip goes out.

**Mixed sources don't match.** A media Segment or an Overlay from the Media Library can sit next to the Source with a quite different colour, and nothing evens them out.

**No styled look.** Concat, the reference editor, offers an Adjust panel, a catalogue of filter looks in categories, `.cube` LUT import and adjustment layers. The Advanced Edit offers none of these, and "filters and effects" is listed as Out of Scope of the Advanced Edit spec.

**The agent can't grade either.** No colour field exists in the model, so `edit_candidate` and `merge_candidate_items` have nothing to set.

## Solution

A picture gets a **Grade**: its **Adjust**, then a **Look** at an intensity. A Grade is constant over its item and never keyed.

**Where Grades apply:**
- **On items:** a Segment (of the Source or a media item) and an Overlay may each have one.
- **On the Candidate:** the Candidate has its own Grade, laid over the whole Main Track after the Segments' Grades and the Transitions. It is the one-step grade for a podcast, and it never touches the Overlays.
- **Adjustment Layers:** spans on a new Adjust Track lay a Grade over the Main Track and the Overlays under them, with a strength and fades. They never touch the Watermark, captions, Shapes, Text Layers or hook.

**The Adjust dials** follow Concat's ranges:

| Dial | Range | Neutral |
|---|---|---|
| Temperature | 2000–11000 K | 6500 |
| Exposure | ±3 EV | 0 |
| Tint, saturation, brightness, contrast, highlights, shadows, whites, blacks | −100..100 | 0 |
| Sharpen, fade, vignette | 0..100 | 0 |

**Looks:**
- **Built-in:** about 20 Looks in six categories: Cinematic, Film, Retro, Portrait, Black & White and Vibe. Each is a set of Adjust values written for this app.
- **Imported:** the owner can import a `.cube` file. It becomes an **Imported Look**, kept for every Job.

**Rendering and preview** (ADR 0013):
- The render folds each Grade into one table per channel and one colour matrix, plus an Imported Look's 3D table, sharpen and vignette.
- The preview uses an SVG filter of the same tables and matrix, so a dial drag shows at once and nearly matches the render.
- **Compare render** shows the exact pixels of one frame at the playhead, under a split line.

**Where the controls are:**
- **Advanced Edit, desktop:**
  - The Inspector has a Color section for the Pick, or for the Candidate when nothing is picked.
  - The Asset Panel has a Filters tab of Look cards shown on the owner's own frame. Hover to try a Look, click to apply it, drag it onto the Timeline to make an Adjustment Layer.
- **Advanced Edit, phone:** a toolbar with Filters and Adjust bottom sheets.
- **Clip editor:** the Candidate's Grade only.
- **Agent:** every field is reachable through `edit_candidate`, `merge_candidate_items`, `dry_run`, `list_assets` and `add_asset`.

## User Stories

**Grading items**

1. As the owner, I want to warm up or cool down a Source Segment with a temperature dial in kelvin, so that a cast from room lights is corrected.
2. As the owner, I want a tint dial, so that a green or magenta cast is removed.
3. As the owner, I want to raise exposure on a Segment shot too dark, so that the speaker's face is visible.
4. As the owner, I want brightness and contrast dials, so that flat footage gets punch.
5. As the owner, I want highlights, shadows, whites and blacks dials, so that I can recover a blown window or lift dark corners without moving the mid-tones.
6. As the owner, I want a saturation dial from −100 (grey) to +100, so that colours can be muted or made vivid.
7. As the owner, I want a fade dial, so that blacks are lifted into a matte, film-like look.
8. As the owner, I want a sharpen dial, so that soft footage looks crisper.
9. As the owner, I want a vignette dial, so that the eye is drawn to the centre of the frame.
10. As the owner, I want to grade a media Segment on its own, so that a B-roll clip matches the Source next to it.
11. As the owner, I want to grade an Overlay on its own, so that picture-in-picture footage matches the Clip.
12. As the owner, I want an Overlay's Grade to leave its border and shadow untouched, so that my framing stays the colour I chose.
13. As the owner, I want a Segment's Grade to cover its whole frame, including the panels of a Split, its blurred Background and a colour Background, so that what I see is graded consistently.
14. As the owner, I want a Transition between two differently graded Segments to blend the two graded pictures, so that the join looks natural.
15. As the owner, I want to reset one dial with a double-click, so that I can undo one change without losing the others.
16. As the owner, I want to reset a whole Grade, so that I can start over.
17. As the owner, I want every change to a Grade to be one step of undo, so that I can step back through my grading.
18. As the owner, I want a dial drag to show on the preview at once, so that I can grade by eye.
19. As the owner, I want to grade several picked Segments and Overlays at once, so that matching shots get the same correction. Shared fields show a mixed state where they differ.

**The Candidate's Grade**

20. As a podcast owner, I want one Grade for the whole Clip, so that I can correct the Source once, not Segment by Segment.
21. As the owner, I want the Candidate's Grade to be laid on top of each Segment's own Grade, so that I can fix one shot and still grade the whole Clip.
22. As the owner, I want the Candidate's Grade to leave Overlays alone, so that a logo or product shot keeps its true colour.
23. As the owner, I want to set the Candidate's Grade in the Advanced Edit's Inspector with nothing picked, so that I don't need to select every Segment.
24. As the owner, I want to set the Candidate's Grade in the clip editor, so that I can grade a quick Clip without opening the Advanced Edit.

**Looks**

25. As the owner, I want a Filters tab of Looks grouped by category, so that I can browse ready-made colour styles.
26. As the owner, I want each Look's card to show my own frame at the playhead in that Look, so that I can judge it on my footage.
27. As the owner, I want to hover over a Look card to try it on the preview without applying it, so that I can compare Looks quickly.
28. As the owner, I want to click a Look card to give it to the picked items' Grades (or the Candidate's with nothing picked), so that applying it is one click.
29. As the owner, I want an intensity slider (0–100%) for a Grade's Look, so that a strong Look can be toned down.
30. As the owner, I want a Look to work on top of my Adjust dials, so that I can correct first and style after.
31. As the owner, I want to remove a Look from a Grade and keep its Adjust, so that I can try a different style.
32. As the owner, I want built-in Looks never to change under a saved Candidate, so that an app update doesn't silently recolour my Clips.

**Imported Looks**

33. As the owner, I want to import a `.cube` LUT, so that I can use a grade from my colourist or a LUT pack I own.
34. As the owner, I want an imported LUT to appear as a Look in an Imported category, so that it is used like any other Look, intensity included.
35. As the owner, I want my Imported Looks available in every Job, so that I import a LUT once.
36. As the owner, I want importing a file with an existing name to make a new Look, so that Candidates using the old one don't change.
37. As the owner, I want to delete an Imported Look I no longer use, and to be told when it is still in use, so that nothing loses its grade by surprise.
38. As the owner, I want a clear error naming the problem when a `.cube` file is invalid (a 1D table, a size over 65, a bad line), so that I can fix or replace it.
39. As the owner, I want an Imported Look's preview to be close to its render, and to be able to check the exact result, so that I can trust what I export.

**Adjustment Layers**

40. As the owner, I want to drag a Look onto the Timeline to make an Adjustment Layer, so that one grade covers a span across several Segments and Overlays.
41. As the owner, I want an Adjustment Layer's own Grade (Adjust and Look) edited in the Inspector, so that it is graded like any item.
42. As the owner, I want an Adjustment Layer to have a strength (0–100%), so that its effect can be dialled back.
43. As the owner, I want an Adjustment Layer to fade in and out, so that a grade can ease in for a mood change.
44. As the owner, I want an Adjustment Layer to grade the Main Track and the Overlays under it, but not the captions, Text Layers, Shapes, hook or Watermark, so that branding and text keep their colours.
45. As the owner, I want overlapping Adjustment Layers to apply one after another, so that a scene-wide grade and a flash can stack.
46. As the owner, I want Adjustment Layers on their own Adjust Track above the Overlay Track, so that I can see their spans.
47. As the owner, I want to move, trim, split, duplicate, copy, paste and delete Adjustment Layers like other layers, so that editing them feels the same.
48. As the owner, I want Adjustment Layers to follow the Main Track under the Magnetic timeline and to be split by Split all, so that they stay over the moments they were meant for.
49. As the owner, I want to hide and lock the Adjust Track, so that I can see the ungraded picture or protect my layers.

**Copying with items**

50. As the owner, I want a split Segment's two parts to keep its Grade, so that splitting changes no colour.
51. As the owner, I want duplicate, copy and paste of a Segment or Overlay to bring its Grade, so that a graded shot can be reused.
52. As the owner, I want a Freeze frame to keep its Segment's Grade, so that the held frame matches.

**Checking the result**

53. As the owner, I want to hold a button to see the picture without any Grade, so that I can compare before and after.
54. As the owner, I want Compare render to show the server's exact frame at the playhead beside the preview under a split line, so that I can check the real pixels before rendering.
55. As the owner, I want Compare render to go away when the playhead moves or I edit, so that it never shows a stale frame.
56. As the owner, I want Compare render to work on unsaved edits, so that I don't have to save first.

**Phone**

57. As the owner on a phone, I want a Filters button showing a horizontal strip of Look cards with an intensity slider, so that I can apply Looks with my thumb.
58. As the owner on a phone, I want an Adjust button with the dials in a bottom sheet, so that I can correct colour on the go.
59. As the owner on a phone, I want to add an Adjustment Layer from the Filters sheet, so that span grades are possible there too.

**The agent**

60. As the agent, I want `edit_candidate` and `merge_candidate_items` to set a Segment's, an Overlay's and the Candidate's `grade`, field by field, so that I can correct colour without replacing whole items.
61. As the agent, I want `adjustment_layers` as a list keyed by `id`, merged and removed like the other lists, so that I can add span grades.
62. As the agent, I want `list_assets` kind `looks` to list every Look with its id, name, category and Adjust values, so that I can choose one by name.
63. As the agent, I want `add_asset` kind `look` to import a `.cube` from a path on this Mac, and `delete_asset` to remove an unused Imported Look, so that I can manage LUTs.
64. As the agent, I want the dry run to show each Segment's, Overlay's and Adjustment Layer's Grade and the Candidate's Grade, so that I can check what I set before saving.
65. As the agent, I want an out-of-range dial or an unknown Look refused with a clear message, so that I never store a broken Grade.

**Stability**

66. As the owner, I want Candidates saved before this feature to read with neutral Grades and no Adjustment Layers, so that nothing changes on upgrade.
67. As the owner, I want a neutral Grade to add nothing to the render, so that ungraded Clips render exactly as fast as before.
68. As the owner, I want keyed Overlays, keyed media Segments and Manual Scenes with Keyframes to be graded the same as unkeyed ones, so that motion never drops the grade.

## Implementation Decisions

**Model**
- **A new value object `Grade`** holds:
  - `adjust`: an `Adjust` value object with the thirteen dials, each with its range and neutral default (temperature 6500, everything else 0);
  - `look`: a Look id, or none;
  - `intensity`: 0–100, default 100, read only when a Look is set.

  A Grade where every field is neutral and there is no Look is the default.
- **New fields:**
  - `grade` on Segment (Source and media) and on Overlay;
  - `grade` on Candidate;
  - `adjustment_layers` on Candidate: a list of Adjustment Layers keyed by `id`.
- **An Adjustment Layer** has `id`, `start` and `secs` in Timeline time, `grade`, `strength` (0–100, default 100), `fade_in` and `fade_out` in seconds (each at most half its length).
- **Validation:**
  - Every dial is checked against its range.
  - A Look id must exist among the built-in and Imported Looks.
  - Stored Candidates without the fields read with defaults.
- **Use counting:** a Grade's Imported Look counts as a use, as Media Library items do, so the Look can't be deleted while a Candidate names it.
- **Copying:** split, duplicate, paste and Freeze frame copy the Grade along with the item.
- **Layer rules:** Adjustment Layers join the layer rules of ADR 0004 (Magnetic timeline, Ripple delete, Split all) and the Clipboard, like Text Layers, Shapes and Overlays.

**Looks**
- **The catalogue module** holds the Looks: the built-in ones and those in the Imported Look store.
  - **Built-in Looks** are data files in the backend: id, name, category, order and Adjust values. About 20 across Cinematic, Film, Retro, Portrait, Black & White and Vibe. A shipped Look never changes; a revised one gets a new id.
  - **The Imported Look store** is global, beside the Faces and Logos stores, not a Media Library kind.
- **Importing a `.cube` file:**
  - Parse it as text.
  - Accept only 3D tables with a size of 2–65. Rescale `DOMAIN_MIN`/`DOMAIN_MAX` and Resolve's input range.
  - Refuse 1D tables, and name the offending line in errors.
  - Store the table, and name the Look from the file's TITLE or file name. A clash gets "Name (2)". Every import is a new id.
  - At import, fit per-channel tables and a 3×3 matrix to the 3D table, for the preview's approximation, and keep them with the Look.
- **The catalogue's interface:**
  - list every Look (id, name, category, Adjust, whether it has a table, and the fitted approximation);
  - get one;
  - import a file;
  - delete one, refused while in use;
  - give the path of an Imported Look's table for the render.
- **The HTTP API** grows routes to list, import and delete Looks. No thumbnail route is needed: cards are drawn in the browser.

**The fold (ADR 0013)**
- **A pure function folds a Grade** (with its Look's Adjust values merged by intensity) into:
  - three 256-entry tables (R, G, B) for exposure, brightness, contrast, highlights, shadows, whites, blacks and fade;
  - a 3×4 colour matrix for temperature, tint and saturation;
  - sharpen and vignette amounts;
  - an optional Imported Look table with its intensity.
- **The Look's intensity** mixes the folded result of the Grade with the Look over the folded result without it. Tables and matrices are mixed linearly, which is exact for tables and matrices. Sharpen and vignette amounts are mixed linearly too.
- **The fold is written in Python (render) and TypeScript (preview), and pinned by one shared JSON fixture** of Grades and their expected tables and matrix. Prior art: the Keyframe sampler (ADR 0008) and the Speed mapping.
- **Neutral fast path:** a neutral Grade folds to nothing, and the render adds no filters for it.

**Planner**
- The Render Plan carries the Grades as given, not folded:
  - on each Segment plan;
  - on each Overlay event;
  - on the plan itself, for the Candidate;
  - a list of Adjustment Layer events (start, end, grade, strength, fades) in Timeline time.
- The Preview Plan carries the same. The MCP dry run lists them in the segment, overlay and plan views, plus `adjustment_layers`.

**Renderer**
- **Segment Grade:** applied to each Segment's chain output, before the concat or xfade, so Transitions blend graded pictures. A Clip of one range applies it at the frame chain's end.
- **Candidate Grade:** applied to the joined Main Track, before the Overlays.
- **Overlay Grade:** applied in the picture chain after scale and flip, before alpha, corners, border, shadow and opacity.
- **Keyed pictures go through frame processes, and get their Grade there:**
  - a keyed video Overlay or keyed media Segment, in its decoder's filters;
  - a keyed image, graded once by ffmpeg before its frames are drawn;
  - a keyed Manual Scene, through its Segment's Grade at the chain's end.
- **Adjustment Layers** are applied after the Overlays and before the Watermark, captions, picture layers and hook. Each one:
  - splits the stream;
  - grades one branch;
  - blends it back over the ungraded branch by strength times its fade ramp, limited by `enable` to its span.

  Overlapping layers chain in list order.
- **Filters used:** `lutrgb` (or `curves`) for the tables, `colorchannelmixer` for the matrix, `lut3d` for an Imported Look's table, `unsharp`, `vignette`, and `blend`/`overlay` for an Adjustment Layer's mix. The graph stays one `-filter_complex` at 1080×1920.

**Compare render**
- A new endpoint takes a Candidate id, an optional unsaved draft (as the Preview Plan endpoint does) and a Timeline time. It returns one PNG of the full rendered frame there, drawn by the render path. It is not kept as an Export file.
- It reuses the `save_frame` frame-drawing path without storing the result.

**Preview (frontend)**
- **The fold module** (TypeScript, pure) turns a Grade into an SVG filter definition: `feComponentTransfer` tables, an `feColorMatrix`, an approximate sharpen (`feConvolveMatrix`) and a vignette (a radial gradient layer).
- **Where the filters go:** filters are defined once per distinct Grade in a hidden SVG and referenced by CSS `filter: url(#…)`.
  - **Source Segments:** the Source panel slots switch filter at each Segment's span, on both decks and the Transition ghost.
  - **Media Segments, Overlays:** each element carries its item's filter.
  - **The Candidate's Grade and Adjustment Layers:** go on wrappers around the Main Track and the Overlay stack. An Adjustment Layer is drawn as a filtered wrapper whose opacity follows strength times fade, over an unfiltered one.
- **Imported Looks** use their fitted approximation.
- **The before view:** a hold-to-see-original button drops every Grade filter while held.
- **Compare render:** shows the returned PNG over the paused player under a draggable split line, and clears it on any playhead move or edit.

**Advanced Edit UI**
- **Inspector:**
  - A Color section for Segments, Overlays and Adjustment Layers: Look picker, intensity, and dials grouped as Color, Lightness and Effects. Each dial has a double-click reset; the section has a reset button.
  - With nothing picked, the Inspector shows the Candidate's Grade.
  - Several picked items edit shared fields, as Transform does.
  - An Adjustment Layer also shows strength and its fades.
- **Asset Panel, Filters tab:**
  - Look cards by category, each the frame at the playhead (the picked item's picture, or the Clip's) under the Look's SVG filter.
  - Hover auditions the Look on the preview.
  - Click applies it to the Pick's Grades, or the Candidate's with nothing picked, as one undo step.
  - Drag onto the Timeline makes an Adjustment Layer of 3 s (or to the Clip's end) with that Look.
  - An Import button takes `.cube` files.
  - An Imported card has a delete action, refused with the reason while in use.
- **Timeline:** a new Adjust Track above the Overlay Track, with lanes as other layer Tracks have. It hides (dropping Adjustment Layers from the preview only) and locks.
- **Phone:** toolbar buttons Filters (card strip, intensity, "Add as layer") and Adjust (dials in a bottom sheet), for the Pick or the Candidate. No hover audition and no Compare render.

**Clip editor**
- A Color section for the Candidate's Grade: Look, intensity, dials and reset. Its preview draws every Grade and Adjustment Layer.

**MCP**
- **Grades:** `grade` is a nested field of Segments, Overlays and the Candidate. Field-by-field merge comes from the existing derived patch models.
- **Adjustment Layers:** `adjustment_layers` joins the item lists keyed by `id` for `edit_candidate`, `merge_candidate_items` and `remove_candidate_items`.
- **Assets:**
  - `list_assets` gains kind `looks`;
  - `add_asset` gains kind `look` (a `.cube` path);
  - `delete_asset` handles Looks.
- **Docs:** the server instructions describe Grades, dial ranges, Looks and Adjustment Layers.

## Testing Decisions

Good tests here check what is seen and stored, not how a filter string is spelled:
- pixel colours of real renders;
- fields in a Preview Plan;
- what the API and MCP accept, refuse and store;
- what the editor's actions leave in a Candidate.

- **Seam A: HTTP and real ffmpeg** (prior art: the transition mid-frame renders, the keyed Overlay renders, `save_frame`'s tests). These check, on a test source of known colours:
  - **Dials:**
    - Raising temperature makes a grey patch warmer (R up, B down).
    - Raising exposure brightens it.
    - Saturation −100 makes a coloured patch grey.
    - Vignette darkens a corner more than the centre.
  - **Looks:** a Look at intensity 0 matches no Look, and 100 differs.
  - **Imported Look:** an identity `.cube` leaves pixels unchanged (within rounding), and a channel-swap `.cube` swaps channels.
  - **Scope:**
    - A Segment's Grade changes only that Segment's frames.
    - The Candidate's Grade changes a Segment frame but not an Overlay's pixels.
    - An Overlay's Grade leaves its border colour unchanged.
    - An Adjustment Layer changes frames inside its span and not outside. It grades an Overlay under it, and leaves a Text Layer's pixels alone. At strength 0 it changes nothing, and mid-fade it is between.
  - **Keyed:** a keyed Overlay with a Grade is graded like an unkeyed one.
  - **Neutral:** a neutral Grade renders the same pixels as no Grade.
  - **Compare render:** the endpoint returns a PNG of the full frame, matching the render's frame at that time, for a saved Candidate and for a draft.
- **Seam B: planner (pure)** (prior art: the planner tests of Overlays, keyed pictures and Transitions):
  - Segment plans, Overlay events and the plan carry their Grades.
  - Adjustment Layer events carry times, strength and fades.
  - An Adjustment Layer past the Clip's end is cut at the end, and one wholly past it is dropped.
- **Seam C: the fold, over a shared JSON fixture** (pytest and vitest; prior art: the Keyframe sampler and Speed mapping fixtures). The cases are:
  - neutral;
  - each dial alone at its ends;
  - a mix;
  - a Look at 0, 50 and 100%;
  - an Imported Look's table reference.

  Both implementations must produce the fixture's tables and matrix within a tolerance.
- **Looks and import (pytest):**
  - Built-in Looks load, and every id is unique.
  - Each built-in Look's Adjust values are within range.
  - A valid `.cube` file imports.
  - A 1D table, a size over 65 and a malformed line are each refused with the line named.
  - A clashing name gets "(2)" and a new id.
  - Deleting a Look in use is refused.
  - The fitted approximation of an identity table is the identity.
- **Model, API and MCP:**
  - Stored Candidates without the fields read with defaults.
  - Out-of-range dials and unknown Look ids are refused.
  - `merge_candidate_items` sets one dial of a Segment's Grade and keeps the others.
  - `adjustment_layers` add, merge and remove by `id`.
  - `list_assets` kind `looks`, `add_asset` kind `look` and `delete_asset` work.
  - The dry run lists Grades and Adjustment Layers.
- **Editor (vitest)** (prior art: the Advanced Edit actions, clipboard, freeze-frame and Magnetic timeline tests):
  - **Undo:** a card click on a Pick of mixed Segments and Overlays sets their Looks as one undo step. With nothing picked, it sets the Candidate's.
  - **Copying:** split, duplicate, paste and Freeze frame keep the Grade.
  - **Adjustment Layers:**
    - They ripple under the Magnetic timeline and split under Split all.
    - The Adjust Track refuses edits while locked.
    - Dropping a card on the Timeline makes one, with the Look, at the drop time.
  - **Preview:** the preview's filter for a Grade is built from the fold's output, and a neutral Grade adds no filter.

Run only this feature's test files, never the full backend suite.

## Out of Scope

- **Effects** (blur, glow, glitch, chroma key and the rest): `video-effects` (#12) builds on this chain and preview approach. Blend modes for Overlays are also #12.
- **Wheels and curves:** lift/gamma/gain wheels and per-channel curves are later work. They would extend the fold with more table and matrix terms.
- **Keyframed Grades:** dials, intensity and an Adjustment Layer's strength are constant. A split gives a change of grade, and an Adjustment Layer's fades give a gradual one.
- **Grades in Style Presets and Job-wide Grades.**
- **Bundled `.cube` files with built-in Looks** (licensing): built-in Looks are Adjust values only.
- **ACEScct or log LUTs:** Imported Looks are applied in display encoding.
- **1D LUTs and 3D tables larger than 65.**
- **Grading Text Layers, Shapes, captions, the hook or the Watermark.**
- **A WebGL preview.**
- **Compare render on a phone, and hover audition on a phone.**
- **Concat's ordered and bypassable filter chain:** a Grade has one fixed order.

## Further Notes

- Overturns "filters" in the Advanced Edit spec's Out of Scope, recorded in ADR 0013 (`docs/adr/0013-a-grade-is-folded-curves-and-a-matrix-imitated-in-svg.md`). Effects stay out.
- Concat (`docs/referensi/concat`, the `concat.adjust` package) was used for behaviour and ranges only, never code.
- **The SVG preview is near, not exact,** for sharpen, vignette and Imported Looks. Compare render is the check.
- **Preview colour space:** SVG filters must run in sRGB (`color-interpolation-filters="sRGB"`) to match ffmpeg's tables on 8-bit YUV converted to RGB.
- **Render cost:** a Grade adds a handful of cheap per-pixel filters per Segment. An Adjustment Layer adds a split and a blend over its span. The render-cost check in Seam A should hold a graded Clip within a set budget of an ungraded one.
- **Built-in Looks:** writing the about 20 Look values is part of the work. Name and tune them against sample footage with Compare render.
