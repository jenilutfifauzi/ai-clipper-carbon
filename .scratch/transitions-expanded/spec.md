# Transitions expanded: 41 kinds, Seams, apply to all, Join Transitions and Overlay animations

Status: ready-for-agent
Created: 2026-10-18

## Problem Statement

A cut Clip's joins can carry a Transition, but the choice is thin and slow to use.

**Ten kinds.** Today there are only:
- a fade and two dips;
- four slides and one wipe;
- a zoom and a circle.

Concat offers 18 looks in eight shelves, among them a film burn, a light leak, a whip pan, a spin, a glitch and an RGB split, and ffmpeg's xfade alone has 57.

**No pictures.** The Transitions tab is a grid of text buttons, so the owner has to apply a kind to see what it does.

**Slow to apply and resize.**
- A Clip with ten joins needs ten drops.
- A Transition's length is changed only by a slider in the inspector.
- The Timeline shows a join as a diamond, whatever its length.

**The preview's slides are wrong.** In the render, xfade's slides move both pictures. In the preview the incoming Segment stays still under the outgoing one.

**Nothing carries over.** Every new cut starts as a hard cut, even when the owner always wants the same crossfade. A batch of Candidates cut by the agent has no house style for joins.

**Overlays pop on and off.** Text Layers and Shapes can fade, pop or slide in and out. An Overlay can't, short of keying its opacity by hand.

## Solution

**A catalogue of 41 kinds in seven groups.** Each kind is a recipe around one xfade (ADR 0012), so the filter graph keeps one xfade per join:
- **31 of xfade's built-ins**;
- **9 of Concat's looks**, made from native filters on the outgoing and incoming sides in front of a plain xfade, or from an expression that doesn't sample pixels;
- **Dip to colour.**

| Group | Kinds (stored id) |
|---|---|
| **Basic** | Fade (`fade`), Dip to black (`fadeblack`), Dip to white (`fadewhite`), Dip through grey (`fadegrays`), Dip to colour (`dipcolour`), Dissolve (`dissolve`), Blur dissolve (`blurdissolve`) |
| **Slide** | Push left/right/up/down (`slideleft`, `slideright`, `slideup`, `slidedown`), Cover left/right/up/down (`coverleft`, `coverright`, `coverup`, `coverdown`), Whip pan left/right (`whipleft`, `whipright`) |
| **Wipe** | Wipe left/right/up/down (`wipeleft`, `wiperight`, `wipeup`, `wipedown`), Clock wipe (`radial`) |
| **Shape** | Circle open (`circleopen`), Circle close (`circleclose`), Iris (`circlecrop`), Box (`rectcrop`), Doors vertical (`vertopen`), Doors horizontal (`horzopen`) |
| **Zoom** | Zoom in (`zoomin`), Squeeze across (`squeezeh`), Squeeze down (`squeezev`), Zoom blur (`zoomblur`), Spin (`spin`) |
| **Light** | Film burn (`filmburn`), Light leak (`lightleak`) |
| **Glitch** | Glitch (`glitch`), RGB split (`rgbsplit`), Pixelize (`pixelize`), Blur (`hblur`), Distance (`distance`), Slices (`hlslice`) |

The ten existing ids keep their meaning, so saved Candidates are unchanged. The old "Slide" labels become "Push", since xfade's slide moves both pictures.

**Knobs and sound.**
- **Strength** (0–100%) sets the amount of blur, spin, heat, leak, glitch or split on the nine Concat looks. Each look has its own default.
- **Colour** sets Dip to colour's colour.
- **Sound** is Linear (as today), Equal power or Cut, for every kind. A dip never drops the sound out.
- **Length** is 0.1–3 s (was 0.2–1.5). As today it is at most half the shorter neighbour, and the Clip is shorter by the overlap.

**The Transitions tab shows every kind moving.**
- Each group is a section with a sticky heading, over a grid of cards.
- A card shows two sample pictures, drawn in CSS with no image files, part-way through the kind. On hover it plays the kind in a loop.
- Cards use the same CSS look as the preview.
- A "Random" card applies a kind picked at random.
- Clicking a card applies it to the picked join. With no join picked, it applies to the join nearest the playhead and picks that join.
- Dragging a card onto a join still works.

**Seams on the Timeline.** A join with a Transition is drawn as a **Seam**:
- a band over the two Segments' real overlap;
- a grip at each edge. Dragging either grip lengthens or shortens the Transition from both edges at once, within its bounds, as one step of undo, with a tooltip of its length.

A join without one stays a diamond.

**The join inspector** has:
- Length, Strength (for the looks that have one), Colour (Dip to colour), Sound;
- **Apply to all joins:** the picked join's whole Transition, written over every join;
- **Randomise all joins:** a random kind on every join, never the same as its neighbour's, keeping the picked join's length, knobs and sound;
- **Remove from all**;
- the existing "Remove transition".

**The preview moves both pictures.**
- For the overlap, the outgoing Segment (the ghost) and the incoming Segment's picture are both styled with CSS: transforms, clip-paths and masks, filters, a warm gradient layer blended over them, and SVG filters.
- Each moves as it renders, following xfade: a push, a whip pan and a spin move both pictures; a cover slides the incoming one over a still outgoing one; a squeeze moves only the outgoing one.
- Timing is exact and the look is near.
- The sound follows the Transition's sound on both sides.

**Join Transition in Style Presets.** A Style Preset gains a **Join Transition**: none, or a kind, length, strength, colour and sound. It is set where the Preset's other styles are edited; built-in Presets have none.
- **Every new join gets a copy.** A new join is any two Segments that come to meet with no Transition between them: by a split, an insert, a paste, a Freeze frame, a delete or a reorder, in the editor or by the agent.
- **It is copied, never linked.** Changing the Preset, or switching to another, leaves existing joins alone. A Transition the owner removes stays removed.

**Overlays animate in and out** as Text Layers do: Comes on and Goes off (none, Fade, Pop, Slide) and an animation length of 100–2000 ms. The animation changes the picture only. A video Overlay's sound keeps its own volume and Keyframes.

The agent reaches all of it through the MCP tools.

## User Stories

1. As the owner, I want 41 Transition kinds grouped as Basic, Slide, Wipe, Shape, Zoom, Light and Glitch, so that I can find the look I want quickly.
2. As the owner, I want each card in the Transitions tab to show the kind part-way through, so that I can tell kinds apart without applying them.
3. As the owner, I want a card to play its Transition in a loop while I hover it, so that I see the motion before choosing.
4. As the owner, I want the group headings to stay visible while I scroll the tab, so that I know which group I am in.
5. As the owner, I want clicking a card to apply it to the picked join, so that choosing is one click.
6. As the owner, I want clicking a card with no join picked to apply it to the join nearest the playhead and pick that join, so that a click is never wasted.
7. As the owner, I want to drag a card onto a join on the Timeline, so that I can place a Transition exactly where I drop it.
8. As the owner, I want the cards to be disabled with a hint when the Clip has only one Segment, so that I understand Transitions need a cut.
9. As the owner, I want a "Random" card, so that I can try looks without choosing one myself.
10. As the owner, I want the existing Fade, Dips, Slides (now Push), Wipe, Zoom in and Circle open to stay as they were on my saved Candidates, so that nothing I made changes.
11. As the owner, I want Push and Cover to be different kinds, so that I can choose between both pictures moving and the incoming one sliding over a still outgoing one.
12. As the owner, I want Whip pan, Spin, Zoom blur, Film burn, Light leak, Glitch, RGB split and Blur dissolve, so that my Clips can have the looks Concat has.
13. As the owner, I want a Strength slider for those looks, so that I can make a burn subtler or a spin wilder.
14. As the owner, I want a Strength I set to come back when I switch a join to another kind and back, so that experimenting doesn't lose my setting.
15. As the owner, I want Dip to colour with a colour picker, so that a dip can match my brand.
16. As the owner, I want Transition lengths from 0.1 to 3 seconds, so that I can have snappy whips and slow dissolves.
17. As the owner, I want a Transition never to take more than half the shorter Segment, as today, so that a short Segment isn't swallowed.
18. As the owner, I want to choose the sound of a Transition (Linear, Equal power, Cut), so that speech across a join sounds right.
19. As the owner, I want a dip to keep the sound crossfading by default, so that dialogue isn't silenced at a join.
20. As the owner, I want a join with a Transition drawn on the Timeline as a band over its overlap, so that I see how long it is and where it sits.
21. As the owner, I want to drag either edge of that band to change the length, so that I can resize it where I am looking.
22. As the owner, I want a tooltip with the length while I drag, so that I can set it precisely.
23. As the owner, I want the drag to stop at the length's bounds and at half the shorter Segment, so that I can't make an invalid Transition.
24. As the owner, I want one drag to be one step of undo, so that undo puts the length back in one go.
25. As the owner, I want a join without a Transition to stay a diamond I can click or drop on, so that adding one is unchanged.
26. As the owner, I want "Apply to all joins" in the join inspector, so that every join gets the picked join's kind, length, strength, colour and sound at once.
27. As the owner, I want "Remove from all", so that I can return the Clip to hard cuts in one step.
28. As the owner, I want "Randomise all joins", so that a Clip gets varied Transitions with no two neighbours alike.
29. As the owner, I want each of those to be one step of undo, so that I can try them freely.
30. As the owner, I want a locked Video Track to refuse Seam drags and the "all" actions, so that a lock protects the Main Track's timing.
31. As the owner, I want the preview's Push, Cover and Spin to move the pictures as the render does, so that what I see matches the render.
32. As the owner, I want every kind imitated in the preview with exact timing, so that I can judge pacing before rendering.
33. As the owner, I want the preview's sound across a join to follow the Transition's sound setting, so that I hear what the render will give.
34. As the owner, I want to give a Style Preset a Join Transition, so that my house crossfade is applied without thinking.
35. As the owner, I want every new join to get the Preset's Join Transition when it has none, whether I split, insert, paste, freeze, delete or reorder, so that cuts come out styled.
36. As the owner, I want a Transition I removed to stay removed, so that the Preset doesn't fight my choices.
37. As the owner, I want changing or switching the Preset to leave existing joins alone, so that a Preset change doesn't rewrite my edit.
38. As the owner, I want built-in Presets to have no Join Transition, so that nothing changes until I set one.
39. As the owner, I want the agent's cuts to get the Preset's Join Transition too, so that a batch of agent-cut Candidates shares my house style.
40. As the agent, I want an edit that states the Transitions list to be taken as stated, so that I can choose a hard cut on a new join.
41. As the agent, I want every new kind, strength, colour and sound in the tool schemas, so that I can set them like the owner.
42. As the agent, I want the dry run to list the Transitions with their kind, times, strength, colour and sound, so that I can check my joins before rendering.
43. As the agent, I want to set a Style Preset's Join Transition through save_preset, so that I can set up a house style for a batch.
44. As the owner, I want Overlays to fade, pop or slide in and out, so that a picture-in-picture doesn't pop on abruptly.
45. As the owner, I want the same Comes on, Goes off and Animation length fields as a Text Layer, so that every layer animates the same way.
46. As the owner, I want an Overlay's animation to work with its Keyframes (opacity and scale multiplied), so that keyed motion and animation combine.
47. As the owner, I want a video Overlay's sound unaffected by its animation, so that its own volume and Keyframes stay in charge.
48. As the agent, I want an Overlay's animation fields in edit_candidate and merge_candidate_items, so that I can animate Overlays too.
49. As the owner on a phone, I want the same grouped cards in the join inspector, and Seam grips I can touch, so that Transitions work on mobile.
50. As the owner, I want rendering a Clip with the new looks to take about as long as with a fade, so that a batch render isn't slowed down.

## Implementation Decisions

### Model

- **`TransitionKind`** stays a StrEnum of stored ids. It grows from 10 values to the 41 in the table above; the existing ten are unchanged.
- **`Transition`** gains:
  - `strength: float | None` (0–1, unset means the kind's default);
  - `colour: Colour | None` (read by `dipcolour` only; its default is black);
  - `sound: TransitionSound` (`linear` (the default), `equal_power`, `cut`).
- **`secs` is bounded 0.1–3.0** (was 0.2–1.5). The default stays 0.5, and the half-the-shorter clamp (`transition_overlap`) is unchanged.
- **A knob on a kind that doesn't read it is kept, not refused,** so switching kinds and back restores it.
- **No migration.** Stored Transitions read with the defaults.
- **`StylePreset` gains `join_transition`:** none, or a Transition without `after`. Built-ins have none. There is no Style Override for it, since it is copied, never linked.
- **`Overlay` gains `animation_in`, `animation_out` and `animation_ms`**, with the `Animation` enum and the 100–2000 ms range a Text Layer has (defaults: none, none, 300).

### Join Transition rule

- **One pure rule, written as twins in the backend and the editor.** A join is a pair of adjacent Segment ids. Given the Main Track before and after a change, every join present after and not before, with no Transition, gets a copy of the Candidate's Style Preset's Join Transition. Its `after` is the join's first Segment.
- **The editor applies it inside the action that changes the Main Track,** in the same undo step: split, Split all, insert of a media Segment, paste, Freeze frame, delete, Ripple delete, reorder.
- **The backend applies it in the Candidate update** when the Segments change and the update doesn't state `transitions`. When it does, the stated list is taken as is, so the agent can leave a new join cut.
- **Removing a Transition never triggers the rule,** since the join is not new.
- **Changing a Candidate's Preset touches no join.**

### Catalogue and rendering (ADR 0012)

- **A backend table maps each kind to its recipe:**
  - an optional filter chain on the outgoing side and one on the incoming side, enabled only over the overlap;
  - one xfade: a built-in name, or a `custom` expression reading only `A`, `B`, `X`, `Y`, `P` and constants.
- **A test checks that every kind has a recipe.**
- **The renderer looks up the recipe** instead of passing `kind.value` straight to xfade. Built-in kinds keep producing the same graph as today.
- **The Render Plan's `TransitionEvent` carries** `kind`, `strength`, `colour` and `sound`, beside `start` and `end`.
- **Recipe sketches.** These guide the implementer and are not binding; each needs its native filters' timeline support or `sendcmd` checked:

  | Kind | Sketch | Strength |
  |---|---|---|
  | `blurdissolve` | Blur on both sides, peaking at the middle where a filter allows ramping (else steady), then `fade` | the blur |
  | `whipleft` / `whipright` | Horizontal `gblur` on both sides, then `slideleft` / `slideright` | the blur |
  | `zoomblur` | Scale up by an expression in `t` and blur, then `fade` | |
  | `spin` | `rotate` (and shrink) by an expression in `t` on both sides, then `fade` | the turns, 0.5–2 |
  | `filmburn` | A non-sampling expression: crossfade plus a warm, triangular flash clamped to white | the heat |
  | `lightleak` | A non-sampling expression: a warm diagonal band sweeping with `P`, added and clamped | |
  | `glitch` | `rgbashift` and `noise` over the overlap, around a slice or pixelize xfade | |
  | `rgbsplit` | `rgbashift` on both sides, then `fade` | the spread |
  | `dipcolour` | The `fade` filter out to the colour on the first half and in from it on the second, then `fade` | |

  Colour-based looks may run in `gbrp` over the overlap and convert back.
- **Render cost is budgeted.** A 0.5 s join of any recipe must stay within a few seconds of a plain fade at 1080×1920. Per-pixel sampling expressions are not allowed (ADR 0012's measurements).
- **Sound.**
  - Linear is `acrossfade`'s default `tri`.
  - Equal power is `qsin` on both curves.
  - Cut switches at the middle of the overlap: each side gets a short `afade` at the middle and `acrossfade` uses `nofade` on both curves.

### Preview

- **Look functions.** A frontend table `Record<TransitionKind, { label, group, look }>` makes the type checker demand every kind. `look(progress, strength, colour)` returns the styles of the outgoing layer, the incoming layer and an optional veil or gradient layer.
- **The incoming side is styled too:** during an overlap, the preview's Segment picture layer is styled, never the Overlays, captions, Picture layers, hook or Watermark above it. Push, Whip pan and Spin move both sides; Cover moves only the incoming one, over a still outgoing one; Squeeze moves only the outgoing one, as xfade does.
- **CSS means.**
  - Wipes, doors, box and circles use `clip-path`.
  - Clock wipe uses a `conic-gradient` mask.
  - Blurs and greys use `filter`.
  - Film burn and Light leak use a gradient layer with `mix-blend-mode: screen`.
  - RGB split, Pixelize and Glitch use SVG filters (with a plain fallback where a browser lacks them).
  - Dissolve uses a noise mask.
  - Distance is a crossfade.
- **Sound.** The ghost's and the incoming Segment's volumes follow the Transition's sound curve over the overlap.
- **Cards** render the same `look` over two CSS-drawn sample pictures. They hold at the kind's card moment (mid-way by default) and animate on hover. There is no WebGL and no image assets.

### Advanced Edit

- **Transitions tab.**
  - Grouped sections with sticky headings, a "Random" card, and cards that apply on click and drag onto joins.
  - The click target is the picked join, else the join nearest the playhead, which then becomes the Pick.
  - Cards are disabled with a hint in a Clip of one Segment.
- **Seam.** On the Video Track, a join with a Transition is drawn as a band from its event's start to its end, with a grip at each edge.
  - Dragging a grip changes `secs` by twice the pointer's travel in Timeline seconds, clamped to 0.1–3 and to the overlap clamp, shown live, committed as one undo step.
  - No snapping.
  - Clicking the band picks the join.
  - Grips have phone-sized hit areas.
  - A locked Video Track draws the band without grips.
- **Join inspector:**
  - Length, Strength (only for kinds that read it), Colour (Dip to colour), Sound (a segmented control);
  - Apply to all joins, Randomise all joins, Remove from all, Remove transition.

  Each action is one undo step. The "all" actions are disabled on a locked Video Track.
- **Randomise** picks uniformly from all 41 kinds for each join in order. It never repeats the kind of the join before, and keeps the picked join's `secs`, knobs and sound. The "Random" card does the same for one join, avoiding its neighbours' kinds.
- **Style Preset editor.** A Transitions section, where the Preset's caption, hook and Watermark styles are edited, holds: kind (or None), length, strength, colour and sound. It is read-only for built-ins.
- **Overlay inspector** gets the Text Layer's motion fields (Comes on, Goes off, Animation length).

### Overlays animated

- **An animated Overlay is drawn by a frame process,** as a keyed one is. The animation is applied on top of its keyed values exactly as for Picture layers: opacity and scale multiplied, Slide's drop added, each end at most half its length.
- **The preview applies the same maths** through the Picture layers' look.

### Agent (MCP)

- **The schemas carry the new values automatically:** kinds, `strength`, `colour`, `sound`, Overlay animation fields and `join_transition` on `save_preset`.
- **The tool descriptions** name the seven groups with their kinds, the knobs and which kinds read them, the sound options, the length bounds, the Join Transition rule and the "stated list is taken as is" exception.
- **The dry run's plan view gains `transitions`:** after, kind, start, end, strength, colour, sound.

## Testing Decisions

Good tests here check what is seen, heard and stored:
- pixels and audio levels of real renders;
- times and fields in a Preview Plan;
- what the API and MCP accept, refuse and store;
- what the editor's actions leave in a Candidate.

They don't check how a filter string is spelled.

- **Seam A: HTTP and real ffmpeg** (prior art: `test_transitions.py`'s crossfade render and mid-frame test, the keyed Overlay and Text Layer animation renders):
  - **Every recipe kind:** a frame in the middle of the Transition differs from both sides' own pictures, and the Clip's length is shortened by the overlap.
  - **`dipcolour`:** the middle frame is the chosen colour.
  - **`filmburn` and `lightleak`:** they brighten the middle frame above both sides.
  - **Strength:** 0 and 1 give measurably different middle frames for a strength-reading recipe.
  - **Built-in kinds:** a sample of new ones (`coverleft`, `pixelize`, `radial`) renders.
  - **Render cost:** a recipe join stays within a set budget of a fade join on the same input.
  - **Sound:**
    - With two tones, Cut has only the first tone just before the middle and only the second just after.
    - Equal power keeps the summed level near constant at the middle.
    - Linear matches today.
  - **Animated Overlay:** a Fade-in Overlay is transparent at its start frame and opaque after `animation_ms`. A Pop one is smaller at the start.
- **Seam B: planner (pure)** (prior art: the planner tests of overlaps and keyed pictures):
  - The 0.1–3 bounds are refused or accepted as given, and the half-the-shorter clamp still applies.
  - `TransitionEvent` carries kind, strength, colour and sound.
  - An Overlay's animation multiplies its keyed opacity and scale.
- **The Join Transition rule as shared cases.** One JSON fixture of before/after Main Tracks, Transitions and a Join Transition, with the expected Transitions after, is read by both the backend and the editor tests (prior art: the shared Segment time fixtures). It covers:
  - split, insert, paste, Freeze frame, delete of a middle Segment, reorder;
  - a removed Transition that stays removed;
  - a Preset with none.
- **Model, API and MCP:**
  - A stored Transition without the new fields reads with the defaults.
  - A knob on a kind that doesn't read it is kept.
  - An update changing Segments without `transitions` fills new joins from the Preset, and one stating `transitions` is taken as is.
  - `save_preset` stores and returns `join_transition`.
  - The dry run lists `transitions`.
  - `merge_candidate_items` sets an Overlay's animation.
- **Editor (vitest)** (prior art: the Advanced Edit `actions` tests and the clipboard and freeze-frame tests):
  - Apply to all, Randomise all and Remove from all are each one undo step. Randomise never gives two neighbours the same kind.
  - A card click with no join picked targets the join nearest the playhead.
  - A Seam drag's length is clamped to the bounds and to half the shorter Segment.
  - The "all" actions and the Seam refuse a locked Video Track.
  - The look table has an entry for every kind, and each look shows the outgoing picture at progress 0 and only the incoming one at 1.

## Out of Scope

- **Per-pixel warps** (Swirl, Cube) and anything needing sampling expressions, by ADR 0012's render budget.
- **Knobs beyond strength and colour:** directions as knobs (they stay separate kinds), softness on xfade's built-in wipes, a circle's centre, the shape of a shape wipe (heart, star).
- **xfade kinds left out as near duplicates:**
  - `fadefast` and `fadeslow`;
  - `smooth*`, `diag*` and `wipetl`/`wipetr`/`wipebl`/`wipebr`;
  - `*wind`, `reveal*`;
  - `vertclose`, `horzclose`;
  - `hrslice`, `vuslice`, `vdslice`.
- **A WebGL preview.** The preview stays CSS (ADR 0012).
- **Search and favourites** in the Transitions tab.
- **Snapping a Seam's grips.**
- **Transitions between Text Layers, Shapes or Overlays.** Overlays get in/out animations instead.
- **New animation kinds** for Text Layers, Shapes or Overlays beyond Fade, Pop and Slide. Overlay animation affecting sound.
- **Transitions in Templates.** Those come with the `templates` feature (#21), which saves the whole edit.
- **A Style Override for the Join Transition.** It is copied, never linked.

## Further Notes

- Decided in a grilling session on 2026-10-18. See ADR 0012 and GLOSSARY (Transition, Seam, Join Transition, Style Preset, Overlay).
- References in `docs/referensi/concat` (behaviour only, never code):
  - `concat-effects/packages/*/effect.toml`: the 18 looks, their shelves and their defaults;
  - `concat-project/src/model.rs`: `Transition { id, duration }` on the incoming clip;
  - `concat/ui/timeline/lanes.slint`: the Seam band and its symmetric grips;
  - `concat/ui/workspace/media-pane.slint`: shelves of cards that apply on one click.
- **Measurements behind ADR 0012** (ffmpeg 9.0.2, 1080×1920, one 0.5 s Transition in a 1.5 s test):

  | Look | `custom` expression | Native filters + xfade |
  |---|---|---|
  | fade | 1.2 s | |
  | film burn | 5.7 s | |
  | glitch | about 6 s | |
  | whip pan | 18.9 s | 1.1 s (`gblur` + `slideleft`) |
  | spin | 27.2 s | 1.2 s (`rotate` + `fade`) |

- Concat's Transitions don't shorten its timeline: the incoming clip is pre-rolled over the outgoing one's tail. Ours keep the overlap model (ADR 0004: changing a Transition moves no layers).
