# Templates: one branded Advanced Edit on every Candidate

Status: ready-for-agent
Created: 2026-10-22

## Problem Statement

Selection gives me fifteen or twenty Candidates per Job. Each one I publish should look like my channel: the same intro sting, a lower-third with the episode's title, a music bed, the same caption and hook style, the same colour, and an outro with a call to action. Today I build that by hand in the Advanced Edit of every Candidate.

The Clipboard helps a little. I can copy the layers from one Candidate and paste them into the next. But pasted items keep their times, so the outro's call to action lands mid-clip on a shorter Candidate and too early on a longer one. The lower-third still shows the first Candidate's title. The intro media Segment has to be put back by hand. The style and the colour have to be set again. Nothing does this for twenty Candidates at once, and nothing does it for a new Job before I open it.

Concat has project templates with media slots. A Concat template is a whole project, though, and its times never adapt to the media filling a slot. ai-clipper's Candidates already exist, already have their own cuts and hook, and differ in length.

## Solution

- **Save as Template.** In the Advanced Edit, "Save as Template" saves the Candidate being edited (its unsaved changes included) as a named, global **Template**. A Template holds:
  - its Timeline layers;
  - its style;
  - its picture and sound settings;
  - an optional Kicker;
  - the media Segments before its first Source Segment (the intro) and after its last (the outro).
- **The save dialog.** It lists each layer with its guessed **Anchor** (Start, End or Span), which I can change. I can save over an existing Template of mine. The poster is the frame at the playhead.
- **The Main Slot.** The Candidate's own Segments are never saved; their place is the **Main Slot**. On every Candidate it is applied to, the Template wraps that Candidate's own cut with the intro and outro.
- **Layers fit each length.** Each layer keeps its distance from the nearest boundary: the Clip's start, the Main Slot's start, the Main Slot's end, or the Clip's end.
  - A lower-third two seconds into the Main Slot stays two seconds in.
  - A call to action four seconds before the outro stays four seconds before it.
  - A music bed from the intro to the outro covers the whole Clip of every Candidate.
  - A fade-out keyed near a layer's end stays at its end.
  - The hook moves with the Main Slot, so it never sits on the intro.
- **Text from the Candidate.** A Template's Text Layer may hold `{title}`, `{hook}` or `{kicker}`, filled from each Candidate.
- **Apply to many.** On the Review page, "Apply Template" opens a checklist of the Job's Candidates, with those selected for rendering already ticked. One click puts the Template on all of them. In the Advanced Edit, the Templates tab applies one to the Candidate being edited, as one step of undo. Applying "No Template" takes a Template's items off.
- **Applying again replaces.** Whatever a Template put on a Candidate is marked as **Template items**. Applying the same Template again (after I improved it) or another one replaces those items, the intro, the outro and the style. Anything I made by hand on that Candidate stays. I'm told what was replaced, cut or left out.
- **A default for new Jobs.** One Template, or none, is the default. Each new Job's Candidates get it when Selection makes them, and so do Candidates I add later. I can choose another, or none, when I start a Job.
- **Library guards.** A video, song, image, Look or Face that a Template uses can't be deleted, and the refusal names the Template.
- **The agent can do all of it through MCP:** list, save, delete and set the default Template, apply one to many Candidates with a dry run first, and start a Job with a Template.

## User Stories

1. As a channel owner, I want to save a Candidate's Advanced Edit as a Template, so that my channel's look is made once.
2. As a channel owner, I want to name a Template, so that I can tell "Podcast — main" from "Podcast — short teaser".
3. As a channel owner, I want my unsaved changes included when I save a Template, so that I needn't save the Candidate first.
4. As a channel owner, I want the media Segments before the first Source Segment saved as the intro, so that my sting opens every Clip.
5. As a channel owner, I want the media Segments after the last Source Segment saved as the outro, so that my end card closes every Clip.
6. As a channel owner, I want to be told that media Segments between Source Segments were left out of the Template, so that I'm not surprised they're missing.
7. As a channel owner, I want saving refused when the Candidate shows no Source at all, so that a Template always has a Main Slot.
8. As a channel owner, I want each layer's Anchor guessed when I save, so that most Templates need no thought.
9. As a channel owner, I want to change a layer's Anchor to Start, End or Span in the save dialog, so that a guess I disagree with is easy to fix.
10. As a channel owner, I want a layer inside the intro to stay on the intro, so that my sting's title stays on it.
11. As a channel owner, I want a layer inside the outro to stay on the outro, so that my end card's text stays on it.
12. As a channel owner, I want a Start layer to keep its distance from the Main Slot's start and its length, so that a lower-third appears at the same moment of every Clip.
13. As a channel owner, I want an End layer to keep its distance from the Main Slot's end and its length, so that a call to action appears just before every outro.
14. As a channel owner, I want a Span layer to stretch with the Main Slot, so that a music bed or a progress bar covers every Candidate.
15. As a channel owner, I want a stretched layer's Keyframes to keep their distance from its nearer edge, so that its fade-in and fade-out keep their timing.
16. As a channel owner, I want a stretched Music Clip to stop at its song's end, so that silence never plays as music.
17. As a channel owner, I want the hook to follow the Main Slot's start, so that it never covers my intro.
18. As a channel owner, I want layers that no longer fit a short Candidate trimmed or dropped, and to be told, so that nothing hangs past the Clip's end.
19. As a channel owner, I want to type `{title}` in a Template's Text Layer, so that each Candidate's lower-third shows its own title.
20. As a channel owner, I want `{hook}` and `{kicker}` too, so that a title card can repeat the Candidate's hook or Kicker.
21. As a channel owner, I want a Template to set a Kicker, so that every Clip of a series can say "EPISODE BARU".
22. As a channel owner, I want each Candidate's hook text kept when a Template is applied, so that the AI's hook for that moment is never lost.
23. As a channel owner, I want a Template to carry the Style Preset and Style Overrides, so that captions, the hook and the Watermark match.
24. As a channel owner, I want a Template to carry the Layout, so that every Clip is framed the same way.
25. As a channel owner, I want a Template to carry the Candidate's Grade and its Clip volume, so that every Clip has the same colour and level.
26. As a channel owner, I want a Template to carry the first Source Segment's Grade, Video Effects and Audio Effects, and give them to every Source Segment, so that my voice treatment and look reach every cut.
27. As a channel owner, I want each Candidate's own cuts, Speed, volume and fades kept, so that a Template never undoes my editing.
28. As a channel owner, I want the Transitions at the intro's and the outro's joins carried, so that the sting always cuts in the same way.
29. As a channel owner, I want the Word Edits and Cue Edits of the intro and outro carried, so that their caption corrections show on every Clip.
30. As a channel owner, I want the joins inside the Main Slot left as they are, so that my cuts keep their own Transitions.
31. As a channel owner, I want to save over one of my Templates, so that improving it keeps its name, its id and its default status.
32. As a channel owner, I want the poster to be the frame at the playhead, so that I pick a recognisable card.
33. As a channel owner, I want a Templates tab in the Asset Panel, so that I see my Templates as cards with their names and posters.
34. As a channel owner, I want each card to show its intro's and outro's lengths, so that I know how much it adds to a Clip.
35. As a channel owner, I want to apply a Template to the Candidate I'm editing as one step of undo, so that I can try one and take it back.
36. As a channel owner, I want to rename and delete Templates from the tab, so that the list stays tidy.
37. As a channel owner, I want to make a Template the default from the tab, so that new Jobs use it.
38. As a channel owner, I want "Apply Template" on the Review page, so that I can brand a whole Job without opening each Candidate.
39. As a channel owner, I want a checklist of Candidates with the selected ones ticked, so that I apply it exactly where I mean to.
40. As a channel owner, I want all the ticked Candidates changed together or not at all, so that a Job never ends half-branded.
41. As a channel owner, I want to see per Candidate what was replaced, trimmed or left out, so that I can check the odd ones.
42. As a channel owner, I want applying a Template again to replace the items it put there, so that improving a Template and reapplying it never doubles my lower-third.
43. As a channel owner, I want applying another Template to replace the first one's items, so that I can switch a Clip's branding.
44. As a channel owner, I want applying a Template to replace its items even where I changed them by hand, and to be told how many, so that reapplying gives the Template's look.
45. As a channel owner, I want the Text Layers, music and overlays I made by hand kept when a Template is applied, so that my one-off edits survive.
46. As a channel owner, I want my hand-made layers to move with the Main Slot when an intro is added or changes length, so that they stay over the same words.
47. As a channel owner, I want "No Template" to take a Template's items off a Candidate, so that I can return to a plain Clip.
48. As a channel owner, I want each application recorded as a Revision, so that the Revision History can restore what was there before.
49. As a channel owner, I want a Clip made before a Template was applied shown as changed since its render, so that I know to render it again.
50. As a channel owner, I want a default Template applied to every new Job's Candidates, so that Clips arrive branded.
51. As a channel owner, I want to choose another Template, or none, when I start a Job, so that a one-off episode can look different.
52. As a channel owner, I want a Candidate I add by hand to get the Job's Template, so that it matches the others.
53. As a channel owner, I want a Job whose Template was deleted before Selection finished to make plain Candidates and tell me, so that the Job never fails for it.
54. As a channel owner, I want deleting a media item, Look or Face that a Template uses refused, with the Template named, so that a Template never points at nothing.
55. As a channel owner, I want a Template whose Style Preset was deleted to fall back to Default, as Candidates do, so that it still applies.
56. As a channel owner, I want a Template whose Logo was deleted to show no Watermark, as Candidates do, so that it still applies.
57. As a channel owner, I want deleting my default Template to leave no default, so that new Jobs aren't given a Template I removed.
58. As a channel owner on a phone, I want to apply a Template to the Candidate I'm editing from a Templates sheet, so that I can brand a Clip away from my desk.
59. As a channel owner on a phone, I want the Review page's Apply Template dialog, so that I can brand a Job from my phone.
60. As an agent, I want `list_presets` with kind "template" to give each Template's name, id, default status, intro and outro lengths and its layers with their Anchors, so that I can pick one.
61. As an agent, I want `save_preset` with kind "template" to save a Template from a Candidate, with Anchors I can override, so that I can make one without the editor.
62. As an agent, I want `save_preset` with a `preset_id` to save over a Template, and `use_as_default` to make it the default, so that I manage Templates like other Presets.
63. As an agent, I want `delete_preset` with kind "template", so that I can remove one.
64. As an agent, I want `apply_template` with a Job, a list of Candidates and a Template (or none), so that I can brand a whole Job in one call.
65. As an agent, I want `apply_template` with `dry_run` to return each Candidate's result and notices without saving, so that I can check before I commit.
66. As an agent, I want `create_job_from_url` and `create_job_from_file` to take a Template, or none, so that I can start a branded Job.
67. As an agent, I want `get_candidate` and the dry run to show which items are Template items and from which Template, so that I don't remove them by mistake.

## Implementation Decisions

The decisions are recorded in ADR 0023 (`docs/adr/0023-templates-are-marked-copies-anchored-by-their-edges.md`). The terms are in GLOSSARY: Template, Main Slot, Anchor, Template Field, Template item.

### Model

- **The Template store** is global, like the Text Preset and Export Preset stores.
  - A JSON file in the data directory, written atomically under a lock.
  - Holds the Templates and the default Template's id (or none).
  - No built-in Templates.
  - Each Template's poster is a PNG kept beside the store, named by the Template's id.
- **A Template holds:**
  - id, name, created and updated times;
  - intro and outro: ordered media Segments, each as on a Candidate, with the Transitions at their joins (between intro Segments, intro→Main Slot, Main Slot→outro, between outro Segments) and their Media Words' Word Edits and Cue Edits;
  - layers: Text Layers, Shapes, Music Clips (of Media Library items only, never the Source's sound), Overlays and Adjustment Layers, each as on a Candidate plus its Anchor;
  - the hook's distance from the Main Slot's start and its length;
  - the Style Preset id and Style Overrides, and the Layout (and the Framing when it is Manual);
  - the Candidate's Grade and Clip volume (`source_volume`);
  - the Main Slot treatment: a Grade, a Video Effect stack and an Audio Effect stack;
  - an optional Kicker.
- **An Anchor is stored per edge:** for each of a layer's start and end edges, which boundary it hangs from (Clip start, Main Slot start, Main Slot end, Clip end) and its distance from that boundary. Start, End and Span are the names the UI and MCP show for the three useful combinations:
  - **Start:** both edges hang from the boundary nearest the start edge.
  - **End:** both edges hang from the boundary nearest the end edge.
  - **Span:** the start edge hangs from a start-side boundary and the end edge from an end-side boundary.
  - The guess on saving hangs each edge from its nearest boundary. A layer wholly inside the intro or the outro always hangs from that part's boundaries.
- **Candidate items gain an optional Template mark:** the id of the Template that put them there. These items are:
  - Text Layers, Shapes, Music Clips, Overlays and Adjustment Layers;
  - Segments and Transitions;
  - Word Edits and Cue Edits keyed on media.

  The planner and the renderer ignore it. Edits keep it, and so does the Clipboard (a pasted copy loses it).
- **JobOptions gains the Job's Template:** the default (when not given), a Template id, or none. It is resolved to an id or none when the Job is created.

### Capture (pure)

`capture(candidate edits, anchor overrides) → Template parts + notices`, with no I/O.

- **What comes from where:**
  - The media Segments before the first Source Segment are the intro, those after the last the outro.
  - Media Segments between Source Segments are left out, with a notice.
  - A Candidate with no Source Segment is refused.
  - Music Clips of the Source's sound are left out, with a notice.
  - The Main Slot treatment is the first Source Segment's Grade, Video Effects and Audio Effects.
- **Boundaries** are measured on the Candidate's own Timeline, Transitions' overlaps included.
- **Template Fields** are saved as typed. The editor shows them as typed in the Template, and filled on Candidates.

### Apply (pure)

`apply(template or none, candidate) → candidate edits + notices`, with no I/O. Run once per Candidate.

1. **Remove** every Template item: layers, intro and outro Segments, their Transitions, and their media Word Edits and Cue Edits.
2. **Put in** the intro before the Candidate's first Segment and the outro after its last, with the Template's Transitions at those joins. A Candidate with no Segments (one implicit Segment) gets an explicit Source Segment for its range first. The joins inside the Main Slot are untouched; the Join Transition does not apply to the intro's and outro's joins.
3. **Move the hand-made layers and the hook** by however much the Main Slot's start moved, as a ripple at Timeline 0 would, whatever the editor's Magnetic switch. The hook then keeps the Template's distance from the Main Slot's start and the Template's length.
4. **Compute the new boundaries.** Place each Template layer by its Anchor and mark it.
   - Keyframes in a layer's first half keep their distance from its start; those in its second half, from its end.
   - A Music Clip is clamped to its song's length at its Speed.
   - A layer reaching outside the Clip is trimmed, and dropped when shorter than the editor's least item length. Each is a notice.
   - A Span whose edges cross is dropped, with a notice.
5. **Fill Template Fields** in the Template's Text Layers from the Candidate's title, hook text (Emphasis marks removed) and Kicker. An empty value leaves nothing in its place.
6. **Replace** the Style Preset id and Style Overrides, the Layout and Framing, the Candidate's Grade and Clip volume, and every Source Segment's Grade, Video Effects and Audio Effects. Replace the Kicker when the Template has one.
7. **Notices** count:
   - Template items replaced that had been changed by hand. A Template item counts as changed when it no longer equals what that Template's application put there; apply compares the Candidate's Template items with a fresh application of the Template it names, or counts them all as replaced when that Template is gone.
   - Layers trimmed, dropped and clamped.
   - Fields left empty.
- **"No Template"** runs steps 1 and 3 only. Style, Grade and Kicker are left as they are.

### Server

- **REST:**
  - `/templates`: list; create from a Job's Candidate, its draft edits and anchor overrides; replace; rename; delete; set or clear the default; poster.
  - A capture preview, which returns the guessed Anchors and notices without saving.
  - `POST /jobs/{id}/templates/apply`: `{template_id | null, candidate_ids, dry_run}`. It applies to every listed Candidate inside one `change_candidates` lock, so it never meets a stale Revision. Each changed Candidate gets its next Revision and a Revision History state. It refuses (409) unless the Job is in review or rendering. It returns per-Candidate edits and notices, and saves nothing on `dry_run`.
- **Validation:** saving a Template validates its media, Looks, Faces and Logo as an edit is validated (422 for missing or unusable items).
- **Delete guards:** `media_uses`, `look_uses` and `face_uses` also scan the Template store, with a `template` use kind naming the Template. Deleting a Logo stays unguarded; a Template showing it then has no Watermark, as Presets and Candidates.
- **Deleting a Template:**
  - Clears the default if it was the default.
  - Jobs whose options name it apply nothing when their Candidates are made, and record a notice on the Job.
  - Candidates keep their Template items, whose mark now names a missing Template.
- **New Jobs:** Selection and `add_candidate` apply the Job's Template to each new Candidate before it is first saved, so the first Revision is already branded.
- **The poster** is made by the existing save-frame pipeline from the editor's draft at the playhead, at a card size.

### MCP

- **The Preset tools take `kind: "template"`:**
  - `list_presets` gives each Template's summary and layers with Anchors.
  - `save_preset` takes `{name, job_id, candidate_id, anchors?}`, with `preset_id` to replace one and `use_as_default` to make it the default.
  - `delete_preset` deletes one.
- **New `apply_template(job_id, candidate_ids, template_id | null, dry_run)`.** Its dry run lists each Candidate's resulting items and notices.
- **`create_job_from_url` and `create_job_from_file`** accept the Template through JobOptions.
- **The server instructions** gain a Templates paragraph covering:
  - copies, not links;
  - Template items are replaced on reapply;
  - Anchors;
  - Template Fields;
  - removing a Template item by hand (`remove_candidate_items`) is allowed and is not undone by anything but reapplying.

### Editor

- **Asset Panel: a Templates tab** (desktop) and a Templates sheet (phone).
  - Cards show the poster, name, intro and outro lengths, and a star on the default.
  - Actions:
    - Apply to this Candidate. The editor asks the server for a dry run and puts the result in as one draft change, one step of undo. It is saved like any edit.
    - Rename, delete and make default, on desktop only.
    - "No Template".
- **"Save as Template…"** is in the Advanced Edit's menu, desktop only. It opens a dialog with:
  - a name field;
  - a "Save over" choice of the owner's Templates;
  - the layer list with an Anchor control each;
  - the capture notices.
  - The poster is taken from the playhead.
- **Inspector:** a Template item shows a small "From Template ‹name›" note.
- **Review page:** "Apply Template…" opens a dialog with:
  - a Template picker (and "No Template");
  - the Candidates as a checklist, the selected ones ticked;
  - a preview of notices from a dry run.

  Confirming applies all of them in one request.
- **New Job form:** a Template choice: the default, another, or none.

## Testing Decisions

Good tests here check what a Candidate becomes and what the API and MCP accept and refuse: the times, Anchors, marks, notices and refusals. They don't check how the functions are split internally. Nothing in this feature renders, so no test runs ffmpeg. The planner already renders whatever items a Candidate holds.

- **Seam B: pure capture and apply** (prior art: `test_planner.py`, `test_segments.py`, `test_keyframes.py`):
  - **Capture:**
    - intro and outro are split off;
    - a media Segment in the middle is left out with a notice;
    - a Candidate with no Source is refused;
    - Source-sound Music Clips are left out;
    - each edge's Anchor is guessed from its nearest boundary;
    - an override to Start, End or Span is stored as its edges;
    - the Main Slot treatment is taken from the first Source Segment.
  - **Apply:**
    - A Start lower-third and an End call to action land at the same distances on a 20 s and a 75 s Candidate.
    - A Span music bed covers intro to outro on both, and is clamped at its song's end.
    - A Keyframe near a Span layer's end keeps its distance from the end.
    - The hook follows a 3 s intro.
    - Hand-made layers move by the intro's length and keep their marks (none).
    - Reapplying replaces Template items, counts hand-changed ones, and never doubles them.
    - Applying another Template replaces the first's items.
    - "No Template" removes them and pulls the hand-made layers back.
    - Template Fields are filled, and an empty Kicker leaves nothing.
    - A short Candidate trims or drops layers, with notices.
    - The Main Slot treatment reaches every Source Segment, and their Speed, volume and fades are kept.
    - Intro and outro Transitions and media Word Edits travel.
    - An implicit single-Segment Candidate is made explicit.
- **Seam A: HTTP and MCP** (prior art: `test_text_presets.py`, `test_export_presets.py`, `test_media_library.py`, `test_revisions.py`, `test_mcp.py`, `test_selection.py` with `fakes.py`):
  - **Template CRUD:** save over keeps the id and default; deleting the default clears it; the poster PNG exists.
  - **Validation:** a missing media item or Face is refused (422).
  - **Bulk apply:**
    - It changes all the listed Candidates with one Revision each, in one request.
    - `dry_run` saves nothing.
    - A Job not in review is refused (409).
    - An unknown Candidate fails the whole batch.
  - **Delete guards:** deleting a media item, Look or Face that a Template uses gives 409 with a `template` use.
  - **New Jobs:** a new Job with the default Template, through fake Selection, has its Candidates branded at Revision 1. "None" leaves them plain. A deleted Template gives plain Candidates and a Job notice. `add_candidate` applies the Job's Template.
  - **MCP:**
    - `save_preset`, `list_presets` and `delete_preset` with kind "template".
    - `apply_template` with and without `dry_run`.
    - `create_job_from_url` with a Template.
    - `get_candidate` shows marks.
- **Editor (vitest; prior art: `actions.test.ts`, `clipboard` tests, `joinTransition.test.ts`, the Review tests):**
  - Applying from the tab is one undo step.
  - The save dialog shows guessed Anchors and posts overrides.
  - The Review dialog ticks the selected Candidates and sends one request.
  - The Inspector shows "From Template".
  - The phone sheet offers Apply only.
- Run only this feature's test files, never the full backend suite.

## Out of Scope

- **A live link** between a Template and its Candidates. Changes reach a Candidate only when the Template is applied again.
- **Built-in Templates.**
- **Media slots other than the Main Slot** (Concat's placeholders filled with any file on instantiate), and text slots other than the three Template Fields.
- **Copying asset files into a Template**, or exporting and importing Templates as files to share between Macs.
- **Templates per Job,** or in the Channel Profile. The default is a global setting, chosen per Job when it starts.
- **Scaling layers by the ratio of lengths,** and looping a song to fill a Span.
- **Carrying the Source's cuts, Word Edits, Cue Edits or Layout Overrides,** which belong to one Source's timeline.
- **Media Segments between Source Segments** in a Template.
- **Saving, renaming or deleting Templates on a phone.**
- **A Template history** or versions. Saving over replaces it, and Candidates keep their copies.
- **Canvas aspect** (roadmap #20). A Template is in 1080×1920 output pixels like everything else.

## Further Notes

- **ADR 0023** records the core choices:
  - copies marked as Template items;
  - edge Anchors to four boundaries;
  - the server applies Templates in one locked change per Job;
  - references by id with delete guards.
- **This overturns no Out of Scope item of the Advanced Edit spec.** It turns its "Text styles in Style Presets (duplicate a layer instead)" into a different answer: a Template carries Text Layers with their Text Styles. It does not put text styles into Style Presets.
- **Hand-made layers always ride with the Main Slot when a Template is applied,** whatever the browser's Magnetic switch says. The server can't read that switch, and leaving them in place would put them on the intro.
- **Earlier specs name this feature as their consumer:**
  - `transform-crop`: one Transform shape.
  - `audio-effects`: effect stacks as ordinary item fields.
  - `captions-advanced`: Word Edits and Cue Edits of intro and outro media Segments.
  - ADR 0020: a Template keeps Word-planned captions.
- **Concat was used for behaviour only:**
  - templates as copies;
  - a poster per Template;
  - refusing to save a Template that names missing media.
- **It differs from Concat in four ways:**
  - Concat keeps the template's times fixed.
  - Concat fills media slots in a new project instead of wrapping an existing Candidate.
  - Concat copies asset files into the template.
  - Concat has no way to reapply a template to existing work.
