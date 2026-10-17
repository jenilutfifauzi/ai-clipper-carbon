# Text Layers at parity with Concat: Text Style, Text Presets, Faces, emoji and motion

Status: ready-for-agent
Created: 2026-10-17

## Problem Statement

A Text Layer in the Advanced Edit can show words, but it can't be styled the way short-form titles are.

**Its look is a handful of fields.**
- It has a face (one of 6 bundled), a size, a colour, an outline and an optional box. It also has an alignment and the hook's in/out animations.
- It has no drop shadow, line height, tracking or wrap width.
- Its box has no padding or radius of its own, and no per-line strips.
- Weight and italic can't be chosen: each bundled font is one file at one weight.

**It can't move or turn.**
- A Text Layer sits at its centre for its whole length.
- It can't be rotated, scaled or faded, and it can't be keyed.
- Overlays and Segments got all of that (ADR 0007, ADR 0008); Text Layers didn't.

**Long text shrinks.** Lines break only at newlines. A line too wide for the frame is set smaller, silently.

**Only 6 fonts.** The owner can't use their channel's brand font. The font list is fixed in code and checked everywhere a style names a font.

**No emoji, no CJK.**
- The planner strips emoji from every Text Layer, hook, Kicker and Watermark, because libass draws no colour glyphs.
- CJK falls back to whatever the operating system has, and the planner measures it as one em per character. Its layout is wrong, and it differs between a Mac and Linux.

**Four looks, none of one's own.**
- The Text tab offers 4 looks, Text, Title, Label and Subtitle, hard-coded in the frontend.
- The owner can't save a look they made, and can't choose which one new titles start from.
- The agent can't see the looks at all.

**Out of Scope until now.** `.scratch/advanced-edit/spec.md` lists keyframes and rotation (now overturned for Text Layers by ADR 0010). Text styles in Style Presets stays Out of Scope: Text Presets are a library of their own.

**Concat has it all.**
- Its title style has stroke, shadow, a plate with radius and padding, line height, tracking, wrap width and fixed height, opacity, weight and italic.
- Its font picker can be searched and fonts can be imported.
- It falls back to colour emoji and CJK faces.
- It ships 31 text presets as data, and "Use for new titles".

## Solution

A Text Layer gets a **Text Style** for its look and a **Transform** for its place. It is planned as text and rendered as a picture (ADR 0010).

**Text Style.**
- The look is grouped into one Text Style: a Face, size and colour.
- Stroke: colour and width.
- Drop shadow: colour, opacity, blur, distance and angle.
- Plate: a Block behind all the lines or Strips behind each one, with colour, opacity, radius, and padding across and down.
- Line height, tracking and alignment.
- Wrap width and fixed height.
- Weight and italic pick another Face of the same family; nothing is synthesised.

**Wrapping, not shrinking.**
- Lines break at newlines and between words at the wrap width (or at the frame's edge, less a margin).
- The box is at least the fixed height, with the words centred in it.
- When the words need more room the box grows. Text is never shrunk to fit.

**Transform and Keyframes.**
- A Text Layer is placed by a Transform as an Overlay is: centre, scale, rotation and opacity, with Keyframes and Eases on position, scale, rotation and opacity.
- Fade, Pop and Slide stack on top of the keyed values.

**On stage.**
- Side grips set the wrap width, and top and bottom grips the fixed height.
- Corner grips scale, and the rotate grip turns, as on an Overlay.
- The font size is set in the inspector.

**Pixels.**
- libass draws the layout once onto a transparent picture, and emoji from Noto Color Emoji are pasted in.
- The picture is placed by the Overlay's path in the render. The preview shows the very same picture, moved by the same maths.
- What the owner sees is what the Clip burns.

**Emoji and CJK.**
- Emoji show in colour in Text Layers, identical on a Mac, on Linux and in the browser.
- CJK is set in one bundled CJK Face whenever the style's Face lacks a character, and measured with it.
- The hook, the Kicker, the Watermark and the captions keep leaving emoji out. Captions now do so too.

**Imported Faces.**
- The owner imports TTF, OTF and TTC files, for every Job.
- A collection is split into its Faces. A variable font is split into one static Face per named instance.
- Each Face shows its copyright and licence from the font itself, with a warning (not a refusal) when the font says it may not be embedded.
- Imported Faces can be picked in every style: Text Styles, Caption Styles, Hook Styles and Watermark Styles.
- A Face that anything uses can't be deleted.
- The font picker can be searched and groups Faces by family.
- About 10–15 more OFL families, several weights each, are bundled, downloaded by `make setup`.

**Text Presets.**
- A library of Text Styles that a new Text Layer starts from, copied in and never linked.
- 31 built-in Presets ship as data, designed for this app. The 4 old looks are among them.
- The owner saves a layer's look as a Preset, and renames and deletes their own.
- One Preset is "used for new titles", by the Text tab's default button and by the agent.

**Hook and Caption Styles.**
- They gain line height, tracking, the same drop shadow, and their plate's (or highlight box's) padding and radius.
- They stay ASS.

**The agent can do all of it:**
- set and merge a Text Layer's style, transform and Keyframes;
- list, save and delete Text Presets, and set the one for new titles;
- import a font from a file on the Mac;
- see in a dry run the wrapped lines, the bounds and the picture.

**Stored Clips render as they did.** Existing Text Layers are migrated with the size they used to be shrunk to, and a wrap width wide enough for their longest line.

## User Stories

**Text Style: the look**

1. As an owner, I want to give a Text Layer a stroke of any colour and width, so that white titles read over bright video.
2. As an owner, I want a drop shadow with its own colour, opacity, blur, distance and angle, so that a title lifts off the picture the way I like.
3. As an owner, I want a soft shadow (a large blur at zero distance), so that I get a glow-like halo without a stroke.
4. As an owner, I want a plate behind my text with its own colour and opacity, so that text stays legible on busy footage.
5. As an owner, I want to round the plate's corners with a radius, so that it looks like a pill or a soft card.
6. As an owner, I want to set the plate's padding across and down separately, so that wide labels and tall stickers both look right.
7. As an owner, I want the plate drawn either as one Block behind all lines or as a Strip behind each line, so that I can make TikTok-style captions.
8. As an owner, I want to set line height, so that stacked lines sit tight for punchy titles or airy for quotes.
9. As an owner, I want to set tracking, including negative, so that I can space headline letters out or pull them in.
10. As an owner, I want to align lines left, centre or right, so that text sits against the edge I choose.
11. As an owner, I want to choose a weight and italic from the family, so that one family gives me Regular, Bold and Black titles.
12. As an owner, I want weights the family doesn't have to be unavailable rather than faked, so that what I pick is what renders.
13. As an owner, I want a wrap width, so that a long sentence breaks into lines at the width I set instead of shrinking.
14. As an owner, I want a fixed height, so that a label keeps the same box whether it has one line or two.
15. As an owner, I want the box to grow when my words need more room than the height I set, so that text is never cut off or silently shrunk.
16. As an owner, I want the words centred vertically in a box taller than they need, so that short text in a fixed card looks balanced.
17. As an owner, I want newlines I type kept as line breaks, so that I control where a title breaks when I care.

**Transform, motion and stage**

18. As an owner, I want to rotate a Text Layer, so that I can tilt a sticker-style title.
19. As an owner, I want to scale a Text Layer as a whole, plate and shadow included, so that I can enlarge it without reflowing its lines.
20. As an owner, I want to set a Text Layer's opacity, so that it can sit softly over the video.
21. As an owner, I want to key a Text Layer's position, scale, rotation and opacity with Eases, so that titles fly in, spin, grow and fade like Overlays do.
22. As an owner, I want Fade, Pop and Slide to still work on a keyed Text Layer, stacked on its keyed values, so that I can combine an entrance with motion.
23. As an owner, I want to drag a Text Layer's side grips to set its wrap width, so that I shape the text block by hand.
24. As an owner, I want to drag its top and bottom grips to set its fixed height, so that I size a card on the stage.
25. As an owner, I want to drag its corner grips to scale it and its rotate grip to turn it, as with Overlays, so that every picture handles the same way.
26. As an owner, I want Auto-key to write a Keyframe when I move a keyed Text Layer, so that it behaves like an Overlay in the Keyframes pane.
27. As an owner, I want a Text Layer's Keyframes in the Dopesheet and Curves, so that I retime and ease them like any other.
28. As an owner, I want a Text Layer to be allowed past the frame's edges while its centre stays on the frame, so that I can slide titles in from off screen.

**Preview fidelity**

29. As an owner, I want the preview to show exactly the pixels the Clip will burn, so that strokes, shadows, tracking, emoji and CJK never surprise me after rendering.
30. As an owner, I want moving, turning, scaling and fading a Text Layer to be instant in the preview, so that placing it feels direct.
31. As an owner, I want the previous look to stay on screen while a changed one is being drawn, so that the preview never blinks or goes blank.
32. As an owner, I want text that is scaled up to stay sharp in the Clip, so that a zoom-in title doesn't blur.

**Emoji and CJK**

33. As an owner, I want emoji in my Text Layers drawn in colour, so that titles like "🔥 WAJIB TONTON" work.
34. As an owner, I want emoji to look the same in the preview and the Clip on any machine, so that the render matches.
35. As an owner, I want emoji to keep their own colours under my text colour, stroke and shadow, so that they look like emoji, not tinted glyphs.
36. As an owner, I want Japanese, Chinese or Korean text in a Text Layer to show real glyphs, measured correctly, so that its lines and box fit.
37. As an owner, I want CJK to render the same on the Mac and on a Linux host, so that a Clip doesn't change by where it is rendered.
38. As an owner, I want emoji still left out of the hook, Kicker, Watermark and captions, cleanly, so that they never show as empty boxes.

**Faces: bundled and imported**

39. As an owner, I want more bundled families with several weights, so that I have good choices without importing.
40. As an owner, I want to import TTF, OTF and TTC files, so that I can use my channel's brand font.
41. As an owner, I want a font collection split into its Faces on import, so that each weight is pickable.
42. As an owner, I want a variable font split into a Face per named instance, so that its weights work in the render (libass draws only a variable font's default).
43. As an owner, I want to see an imported Face's copyright and licence text, so that I know what I'm using.
44. As an owner, I want a warning when a font says it may not be embedded, so that I decide knowingly; the import still goes through.
45. As an owner, I want imported Faces available in every Job, so that I import my brand font once.
46. As an owner, I want imported Faces in the Caption, Hook and Watermark Style pickers too, so that my whole Clip can use one brand font.
47. As an owner, I want to search the font picker by name, so that I find a family among dozens.
48. As an owner, I want Faces grouped by family in the picker, with weight and italic beside it, so that the list stays short.
49. As an owner, I want each family previewed in its own face in the picker, so that I choose by eye.
50. As an owner, I want deleting a Face that a Text Layer, Text Preset or Style Preset uses to be refused with where it is used, so that no Clip changes silently.
51. As an owner, I want a file that isn't a font refused with a clear message, so that I know what went wrong.
52. As an owner, I want importing the same Face twice not to make duplicates, so that the picker stays clean.

**Text Presets**

53. As an owner, I want 31 built-in Text Presets in the Text tab, shown in their own look, so that I start from a good title quickly.
54. As an owner, I want built-in Presets grouped by kind (titles, labels, subtitles, stickers, …), so that I find a fitting one.
55. As an owner, I want the old Text, Title, Label and Subtitle looks among the built-ins, so that what I know is still there.
56. As an owner, I want to save a Text Layer's look as a Text Preset with a name, so that I reuse my channel's title style.
57. As an owner, I want my own Presets shown first, so that my styles are at hand.
58. As an owner, I want to rename and delete my own Presets, so that the library stays tidy.
59. As an owner, I want built-in Presets protected from change and deletion, so that I can always get back to them.
60. As an owner, I want a Text Layer to keep its look when the Preset it came from changes or is deleted, so that past Clips never change.
61. As an owner, I want to mark any Preset "Use for new titles", so that the Text tab's plain add button and the agent start from my style.
62. As an owner, I want new titles to fall back to the built-in default when my chosen Preset is deleted, so that adding text always works.
63. As an owner, I want to click a Preset to add a Text Layer at the playhead, or drag it onto the timeline, as today, so that adding text stays quick.
64. As an owner, I want to apply a Preset's look to the picked Text Layers without changing their words, Transform or Keyframes, so that I restyle existing titles in one step.

**Hook and Caption Styles**

65. As an owner, I want line height on the Hook and Caption Styles, so that two-line hooks and captions sit as I like.
66. As an owner, I want tracking on the Hook and Caption Styles, measured when lines are broken and the hook fitted, so that spaced headlines still fit.
67. As an owner, I want the same shadow (colour, opacity, blur, distance, angle) on the hook and captions, so that all text on the Clip shares one look.
68. As an owner, I want padding and radius on the hook's box and the caption highlight box, so that they match my Text Layers' plates.
69. As an owner, I want existing Style Presets to render as before, so that new fields only change what I change.

**Migration and stored Clips**

70. As an owner, I want my existing Text Layers to render exactly as before after the update, so that re-rendering an old Clip changes nothing.
71. As an owner, I want my existing Text Layers to open in the inspector with their look in the new fields, so that I can keep editing them.

**Agent (MCP)**

72. As the agent, I want to set a Text Layer's style and transform in `edit_candidate`, so that I can style titles.
73. As the agent, I want `merge_candidate_items` to change only the style and transform fields I give, so that I don't restate a whole look.
74. As the agent, I want to key a Text Layer's position, scale, rotation and opacity, so that I can animate titles.
75. As the agent, I want a new Text Layer without a style to take the Preset used for new titles, so that my titles match the owner's.
76. As the agent, I want a dry run to list each Text Layer's wrapped lines, its bounds once turned and scaled, and its picture's URL, so that I can check the layout.
77. As the agent, I want to list, save and delete Text Presets and set the one for new titles, so that I manage the owner's looks.
78. As the agent, I want to import a font from a path on the Mac and list Faces with their family, weight, italic and licence info, so that I can use a brand font.
79. As the agent, I want clear refusals (unknown Face, a weight the family hasn't got, a deleted Face in use, values out of range), so that I can correct my call.

**Concurrency and robustness**

80. As an owner, I want Text Preset and Face changes made by the agent or another tab to appear in my Text tab and pickers, so that I never pick a stale list.
81. As an owner, I want a Text Layer whose text has no drawable characters to show nothing, as an empty one does today, so that a stray emoji-only hook doesn't fail.
82. As an owner, I want a render to fail clearly if a Face file has gone missing from disk, so that I know to re-import it.

## Implementation Decisions

**Domain and model** (GLOSSARY: Text Layer, Text Style, Text Preset, Face; ADR 0010)

A Text Layer becomes:
- `id`, `text`, `start`, `secs`;
- `transform`: a Transform (ADR 0007). Text Layers use its centre, scale, rotation and opacity; stretch and flip stay at their defaults and are refused if set otherwise;
- `keyframes` for position, scale, rotation and opacity (ADR 0008);
- `style`: a Text Style;
- `animation_in`, `animation_out`, `animation_ms`, as today.

A Text Style has:
- `font`, a Face id. The existing ids stay valid. Weight and italic are not separate fields: they are read from the Face.
- `size`, as today a libass size in output pixels; `colour`.
- `stroke_width` (output pixels) and `stroke_colour`.
- `shadow`: `colour`, `opacity`, `blur` (px), `distance` (px) and `angle` (degrees). Off when its opacity or both its distance and blur are 0.
- `plate`: `shape` (none, block or strips, reusing the Hook Shape's values), `colour`, `opacity`, `radius` (px), `padding_x` and `padding_y` (px).
- `line_height`, a multiple of the size.
- `tracking`, in px, which may be negative.
- `align`.
- `wrap_width` (px, 0 means the frame less TEXT_MARGIN each side) and `fixed_height` (px, 0 means the words' own height). Both are the box's outer size, the plate's padding included: lines break at `wrap_width − 2 × padding_x` (decided at the code review, 2026-10-17, so that a side grip drags the edge the owner sees).

Every length is in output pixels, as every other field of a Candidate is.

The Text Style is one value type, shared by Text Layers and Text Presets. `merge_candidate_items` merges it field by field, and the shadow and plate by their own fields.

Opacity is the Transform's only. A Text Preset carries no opacity of the layer; a plate has its own.

**Migration**
- Flat look fields move into `style`, and `x` and `y` into `transform`.
- `outline` and `outline_colour` become the stroke.
- `box`, `box_colour` and `box_opacity` become a Block plate with today's padding and radius constants converted to px at the layer's size.
- `TEXT_LEADING` becomes `line_height`.
- The size the planner would shrink the layer to is computed once with today's metrics and stored. `wrap_width` is set to fit its longest line, so that no new break appears.
- It runs with the existing Candidate migration, and Revision History is migrated on read.

**Planner (layout)**
- It breaks lines at newlines and between words at the wrap width, greedily (UAX #14 break opportunities). A word wider than the wrap width breaks between characters.
- Each line is split into runs by Face. A character the style's Face lacks is given to the bundled CJK Face if that Face has it. An emoji (the existing Extended_Pictographic set, sequences with ZWJ, variation selectors and keycaps kept whole) becomes an emoji run of advance 1.0 em at the style's size. Anything else is left out, as emoji are today.
- Line pitch comes from the style's Face only, so a fallback run doesn't change it.
- Tracking is added after every character but the last of a line.
- The box is `max(words + padding, fixed_height)` high and `max(widest line + padding, wrap width if set)` wide: padding is added on an axis the words size, and a set width or height already holds it. Words are centred vertically within it.
- The planner works out:
  - each line's runs and anchors;
  - each emoji's place and size;
  - the plate's rectangles (one Block, or a Strip per line);
  - the shadow's offset from its distance and angle;
  - the picture's size and the point the Transform centres on;
  - the picture's scale factor: the largest scale the layer reaches (constant, keyed, or Pop's peak), so that the picture is at most 4096 px on its longest side.
- It never shrinks text.
- The Text Layer's event in the Render Plan carries that layout and a content hash of it. Its Transform and Keyframes are planned exactly as an Overlay's are, so the plan reports its bounds once turned and scaled.
- Hook, Kicker, Watermark and caption text keep using `without_emoji`. Captions are now filtered too.

**Rasteriser (new module)**
- Input: a Text Layer event's layout and style. Output: a straight-alpha RGBA PNG at the planned size.
- It writes an ASS script for the layout:
  - every run positioned by the planner, with `\fn` for fallback runs, `\fsp` for tracking and the stroke as `\bord`;
  - the plate as `\p1` drawings;
  - the shadow as its own event below the text: the text in the shadow colour and opacity, offset and `\blur`red. libass's `\blur` applies to the outline when there is one, so the shadow can't be a `\shad` of the main event.
- It runs ffmpeg once: a transparent `color` source at the picture's size in `rgba`, through `ass` with `alpha=1` and a fonts directory holding just the Faces the layout needs.
- It then composites the emoji images at their planned places and sizes, over the shadow and plate and under nothing.
- Pictures are cached on disk by the layout's hash, beside the other derived files, and swept with them (ADR 0005). Making one is fast enough to run inside the preview-plan request path or right after it; the render makes any missing picture first.
- Clean transparency through `ass` with `alpha=1` on ffmpeg 9 is the first thing the first ticket proves.

**Renderer**
- Text Layers leave the ASS script. Each Text Layer's picture enters the filter graph as an Overlay's image does: Transform, Keyframes, Eases, opacity and stacking order unchanged (over the captions, under the hook).
- Fade, Pop and Slide become a time-varying multiplier on opacity, scale and an offset on y. They are applied after the keyed values, with the same curves the hook uses.
- The hook, Kicker, captions and Watermark stay ASS.
- Their new fields:
  - tracking is `\fsp`, and is measured by line breaking and the hook's fit;
  - line height replaces their fixed leading in the anchors;
  - the shadow is an event below each line (as for the rasteriser), replacing `\shad` where blur or angle is set;
  - the box padding and radius replace the constants.
- A per-render fonts directory joins bundled and imported Faces, since `ass` takes one `fontsdir`.

**Faces**
- The static font list becomes a registry: the bundled Faces and the imported ones, kept for every Job in the data directory.
- A Face has:
  - an id (existing ids kept; imported ones derived from the file's PostScript name, with a suffix on collision);
  - its family (name IDs 16/1) and the family libass matches (the file's own);
  - weight (OS/2 usWeightClass) and italic (fsSelection or the post table's angle);
  - its file, whether it was bundled or imported;
  - copyright and licence text (name IDs 0, 13, 14), and a flag when OS/2 fsType says Restricted.
- `FontId` validation reads the registry, wherever a style names a Face. A missing file fails a render clearly.
- Importing:
  - TTF and OTF give one Face. A TTC gives one Face per member, written out as its own file.
  - A variable font gives one static Face per named instance (fontTools' instancer). A variable font with no named instances gives its default.
  - A Face whose bytes are already imported is not added again.
  - A file fontTools can't read is refused.
  - Restricted fsType adds a warning to the response; it is never refused.
- Deleting an imported Face is refused while any Candidate (and its Revision History), Text Preset or Style Preset names it, as a Media Library item's is; the refusal lists where. Bundled Faces can't be deleted.
- Metrics are cached per Face and cleared when a Face is added or removed.
- `make setup` downloads ~10–15 more OFL families, with their weights and italics where useful, plus one CJK Face (Noto Sans JP or SC, OFL, one weight) and the Noto Color Emoji images (Apache-2.0). All are recorded in THIRD_PARTY_NOTICES.
- Fonts API:
  - lists Faces with family, weight, italic, bundled or imported, licence info, and today's metrics;
  - serves each Face's file to the browser, with the cache keyed by id and content so a re-imported Face isn't stale;
  - imports from an upload;
  - deletes, as above.
- Emoji images are served by codepoint sequence for the font picker's samples and nothing else: the preview shows them inside the picture.

**Text Presets (new library)**
- Built-in Presets are data files shipped with the app, one per Preset: a stable id (stored forever), a name, a category, an order, a sample text, and a Text Style (any subset, laid over the defaults).
- The 31 are designed for this app, from the bundled Faces. They take Concat's kinds as inspiration and copy none of its data. The 4 old looks are among them under their names.
- The owner's Presets are kept in one file in the data directory. They are written atomically, as Style Presets are, and can't take a built-in id.
- One Preset id is stored as the one used for new titles, built-in "Text" by default. A deleted one falls back to the default.
- API: list (built-in and owner's, with the default marked), save from a Text Style with a name, rename, delete, and set the default. Changes are broadcast on the existing events so other tabs and editors refresh.
- A new Text Layer copies the Preset's Text Style. Nothing links them.

**Preview and editor**
- The preview draws a Text Layer as the picture the backend made (an `<image>` in the SVG). It places, turns, scales and fades the picture with the Overlay's maths, keyed and animated. It keeps the last picture until a new one has loaded.
- Inline editing of a Text Layer's words on stage keeps today's editable field over the picture while typing.
- Stage grips on a picked Text Layer:
  - side grips set `wrap_width`, top and bottom grips `fixed_height`, each shown live as an outline until the next plan;
  - corner grips set `transform.scale` and the rotate grip `transform.rotation`, with Auto-key as for Overlays.
- The inspector gains Text Style sections: Face picker, size, colour, stroke, shadow, plate, spacing (line height, tracking), box (wrap width, fixed height) and alignment. The Transform's fields and keyframe buttons sit beside them, as an Overlay's.
- The Face picker can be searched, groups by family, previews each in its face, and offers weight and italic among the family's Faces. It has an Import button and is used in every style picker, including Caption, Hook and Watermark.
- The Text tab:
  - shelves "Mine" first, then built-ins by category, each drawn in its look;
  - each Preset's menu offers "Use for new titles", and "Rename" and "Delete" for the owner's;
  - "Save as Text Preset" sits in a Text Layer's inspector;
  - "Apply look" on the picked Text Layers replaces their style only, as one undo step.
- The Keyframes pane, Auto-key, Dopesheet and Curves treat a Text Layer like an Overlay.

**MCP**
- `edit_candidate` and `merge_candidate_items` take Text Layers with `style`, `transform` and `keyframes`, merging style and transform field by field.
- A Text Layer given without a style takes the Preset used for new titles.
- The dry run lists each Text Layer's wrapped lines, its bounds once turned and scaled, and its picture's URL.
- `list_presets`, `save_preset` and `delete_preset` take `kind: "text"`, and the Preset for new titles can be set.
- `add_asset` takes `kind: "font"` (a path on this Mac).
- `list_assets` with `kind: "fonts"` lists Faces with family, weight, italic and licence info. `delete_asset` deletes an imported Face with the same refusal.
- The tools' descriptions and the glossary resource use Text Style, Text Preset and Face.

**Phasing** (tickets in this order, each shippable)

1. Text Style and Transform on Text Layers, the migration, the planner's wrapping layout, the rasteriser and the renderer's picture path, and the preview showing the picture. Stroke, shadow, Block and Strips plate, line height, tracking, wrap width and fixed height all work with the 6 bundled Faces. Stage grips. MCP style and transform.
2. The Face registry and imports (TTF, OTF, TTC, variable), licence info, refused deletion, the searchable picker everywhere, and the bundled families.
3. Text Presets: 31 built-ins, the owner's Presets, Use for new titles, Apply look, and MCP.
4. Emoji and CJK in Text Layers; captions leave emoji out.
5. Text Layer Keyframes (position, scale, rotation, opacity), with animations stacked on them.
6. Line height, tracking, shadow, and plate padding and radius on the Hook and Caption Styles.

## Testing Decisions

Good tests here check what is seen and stored: pixels of a rendered frame or of a Text Layer's picture, the lines and bounds in a Preview Plan, what the API and MCP accept, refuse and list, and what the editor's actions leave in a Candidate. They don't check how an ASS line or a filter string is spelled.

No new seam: the rasteriser is tested through the picture endpoint and through renders.

- **Renders and pictures (HTTP + real ffmpeg, prior art: the Overlay and keyed-picture render tests):**
  - **The picture.** It has clean transparency (alpha 0 away from the text, no dark fringe on a white stroke over transparency) and the planned size at the largest scale. The same layout gives the same file.
  - **Look and placement.** A Text Layer's colour, stroke and plate land at the planned bounds in a rendered frame. A rotated layer's plate corners lie where the plan's turned bounds say. A shadow's offset follows its angle and distance.
  - **Motion.** A keyed Text Layer is at its keyed place and opacity at given frames. Pop over a keyed scale peaks at the product of the two.
  - **Emoji and CJK.** An emoji renders in colour (several distinct hues in its box), and a CJK line has ink where its run is planned.
  - **Hook and captions.** With tracking and line height they shift as planned, and a stored Style Preset renders the same as before.
- **Planner (pure, prior art: the planner tests):**
  - **Wrapping.** Lines wrap at the wrap width and at newlines, and an over-long word breaks. The fixed height is a least height with the words centred, and the box grows past it.
  - **Spacing and runs.** Tracking widens a line by (n−1)×tracking. Line height sets the anchors' pitch. A fallback run is measured with the CJK Face and keeps the pitch. Emoji runs and their places are listed.
  - **The picture's scale** comes from the keyed maximum and is capped at 4096.
  - **Migration.** A migrated stored layer plans the same lines, size and bounds it did before.
  - **Hook and captions.** The hook's fit and caption breaks count tracking.
- **Faces (API, prior art: the Media Library and Style tests):**
  - **Importing.** TTF, OTF and TTC import into the right Faces. A variable font yields one Face per named instance with the right weights. A duplicate isn't added twice, and a non-font is refused.
  - **Licence.** A Restricted fsType font is accepted with a warning, and licence text is listed.
  - **Deleting.** It is refused while a Candidate, a Revision, a Text Preset or a Style Preset uses the Face, and the refusal lists where.
  - **Validation.** A style naming an imported Face validates, and an unknown Face is refused.
- **Text Presets (API, prior art: the Style Preset tests):**
  - **The library.** It lists 31 built-ins with stable ids. The owner's Presets are saved, renamed and deleted, while built-ins refuse all three. A deleted default falls back.
  - **Use.** A new Text Layer copies the look, and changing the Preset afterwards leaves it as it was.
- **Editor (vitest, prior art: the Advanced Edit `actions` tests):**
  - **Adding.** "Add text" uses the default Preset.
  - **Grips.** Side and top/bottom grips set wrap width and fixed height. Corner and rotate grips set the Transform and Auto-key on a keyed layer.
  - **Presets.** Apply look keeps words, Transform and Keyframes as one undo step. Saving a Preset adds it under Mine.
- **MCP (prior art: the MCP tests):** merging style and transform fields, the dry run's lines, bounds and picture URL, `kind: "text"` Presets, the font import, and the refusals.

## Out of Scope

- Text styles inside Style Presets: Text Presets are their own library (`.scratch/advanced-edit/spec.md` keeps this line).
- Emoji in the hook, Kicker, Watermark and captions: they keep leaving them out.
- More than one CJK Face (Traditional Chinese, Korean or Japanese and Simplified side by side); right-to-left and complex scripts beyond what libass shapes with the bundled Faces.
- Per-word or per-character styling inside a Text Layer (rich text), and karaoke timing in Text Layers.
- Synthesised bold or italic.
- Font licence enforcement: no import is refused for its licence.
- Hand-written or shared Preset files on disk, and importing or exporting Presets.
- Gradient fills, textures, multiple strokes, or inner shadows.
- Keying a Text Layer's size, colours, stroke, shadow or plate (only its Transform is keyed).
- Concat's Languages shelf of Presets.
- Text on a path, and 3D text.

## Further Notes

- **ADR 0010 records the choice to rasterise Text Layers,** and its trade-offs: a rasterisation per look change, and a cache of pictures.
- **Ticket 1 starts by proving `ass` with `alpha=1`.** On this machine's ffmpeg 9.0.2 and libass 0.17.5, it should give clean straight alpha with antialiased edges. If it doesn't, the fallback is to render the text white-on-black and black-on-white and recover alpha from the two (difference matting), still with libass.
- **The Linux host (`.scratch/linux-host/`) needs nothing new from the system for text,** since every Face and emoji image is bundled. This removes today's dependence on the system's fallback fonts.
- **Concat (`docs/referensi/concat`) is reference for behaviour only.** Its Preset data and fonts are not copied.

## Code review fixes (2026-10-17)

- **Frontend** (A1–A3, the frontend half of A9, all of C):
  - A Text Layer's bounds are rounded to the nearest pixel as a picture's are, in the planner (`_turned_box`, so `text_bounds_at` and the dry run too) and the preview (`textEventAt`, through picture.ts' `boundsAbout`), so that they agree to the pixel; they were rounded outwards (floor/ceil) and the preview's could differ by 1 px. The inspector says Stroke for `stroke_width`, and `nudge`'s comments say Text Layers are keyed.
  - "look" in code: `TextLook` is `UntimedTextLayer`, `lookOf` `fromPreset`, `applyLook` `applyTextStyle`, `ApplyLook` `ApplyTextPreset` (the owner still reads "Apply look"), styleShape's `shadowLook` `drawnShadow`. The Render Plan event's `look` is left to the backend half.
  - One Transform fields component for pictures and Text Layers (`TransformFields` with `onReset` instead of a Crop) and one keyed wrapper (`useKeyedTransform`) for Overlays, video Segments and Text Layers; one set of shadow fields (`editor/ShadowFields.tsx`'s `shadowControls`) for the hook, the captions and Text Layers, its on/off and offset in `editor/shadow.ts`; one list store (`listStore.ts`) under `fonts.ts` and `textPresets.ts`; `FRAME` and `textStagePicture` reused. `ImportFont`, the shadow helpers and `Mixed` moved into `editor/`, so that `editor/` no longer imports from `advanced/`.
- **Backend** (review items A4–A8, A9's backend half, B1–B8):
  - ASS writing is one public module, `backend/app/ass.py` (colours, alpha, tags, rounded boxes, the `ass` filter), used by `renderer.py` and `text_pictures.py`; text geometry is `FontMetrics.letters_height` and `FontMetrics.centre_y`; listeners are `app/listeners.py`'s `Listeners` (Faces, Text Presets, `fonts.on_change`); `styles.laid_over` merges a style's fields for Style Overrides and built-in Text Presets alike.
  - One `styles.Tracking` (−50..200, the wider range, so no stored value is refused) for captions, hook and Text Styles; `Plate` uses `Padding`; `candidates.MIN_TEXT_SIZE` feeds migration. Text Presets raise their own `TextPresetNotFound` / `BuiltinTextPreset` (same 404/409 responses). `FALLBACK_FACE`, `TextRun.face`; `_character_count` (planner) and `_character_clusters` (line_breaks); line_breaks uses emoji.py's `ZWJ` and `VARIATION_SELECTORS`.
  - Shrink-to-fit leftovers removed: `TextLayout.size`, `TextEvent.size`, `POP_PEAK`, the padding rescale and the `\fs` tag. `TextEvent` no longer repeats its layout: `lines`, `image` and `picture_key` (was `look`) are computed from `layout` and still in the Render Plan JSON; `size` and `radius` are gone from it (the style's size, `layout.radius`). `anchors` stay on the event: they are on the frame, the layout's are from its picture's corner. The frontend's `TextEvent` type, `textPicture.ts` (`key`), `InlineText` and the tests follow. Picture names change once (the layout's hash lost `size` and `TextRun.font`), so existing pictures are made again on next open.
  - `renderer.text_look` → `text_animation`.
