# 0012: Transitions are recipes around one xfade, imitated in CSS

Status: accepted
Date: 2026-10-18

Builds on 0001 (the backend plans, the preview draws) and 0006 (the ghost's own decks).

## Context

The `transitions-expanded` feature (roadmap #10, `.scratch/advanced-edit-v2/roadmap.md`) takes Transitions from 10 kinds to 41, at parity with Concat's catalogue:
- **Today a Transition's kind is an ffmpeg xfade name.** The renderer passes `kind.value` straight to `xfade`, with no table in between.
- **Concat's looks are WGSL shaders** (film burn, light leak, whip pan, spin, glitch, RGB split, blur dissolve, zoom blur). xfade has no built-in for them.
- **xfade's `custom` mode takes a per-pixel expression** that can sample either picture (`a0(x,y)`…). This could draw any of those looks. Measured at 1080×1920 for one 0.5 s Transition, a 1.5 s test clip took:

  | Look | Render time | Note |
  |---|---|---|
  | fade (baseline) | 1.2 s | |
  | film burn | 5.7 s | no sampling |
  | whip pan | 18.9 s | three taps |
  | spin | 27.2 s | rotation |

  The same whip pan and spin took 1.1 s and 1.2 s as native filters (`gblur`, `rotate` with an expression in `t`, limited by `enable=` to the overlap) in front of a plain xfade.
- **In the preview, each side of a Transition is a DOM composite,** not one video:
  - a Layout's panels cropped from two videos, a blurred Background;
  - a Manual Scene's Transform;
  - a media Segment's Transform, Crop and Keyframes.

  The ghost (ADR 0006) is styled away as one layer. WebGL can't take a DOM composite as a texture.

## Decision

- **Each kind is a recipe:**
  - an optional native filter chain on the outgoing side and one on the incoming side, enabled only for the overlap;
  - then one `xfade`, either a built-in kind or a cheap `custom` expression that reads only `A`, `B`, `X`, `Y` and `P` and never samples.

  The filter graph keeps its shape: one xfade (and one acrossfade) per join.
- **`TransitionKind` stays an enum of stored ids.**
  - The 10 existing ids keep their xfade names, so saved Candidates stay valid.
  - The 10 recipes get new ids: `blurdissolve`, `whipleft`, `whipright`, `zoomblur`, `spin`, `filmburn`, `lightleak`, `glitch`, `rgbsplit` and `dipcolour`.
  - The backend holds a table from kind to recipe. The frontend holds an exhaustive `Record<TransitionKind, …>` of label, group and CSS look.
  - **A Transition has two knobs, unlike Concat's:**
    - `strength` (0–1, or unset for its kind's default). Only the recipes read it, as the amount of blur, the turns, the heat or the spread.
    - `colour`, read only by Dip to colour.
    
    xfade's built-ins have no knobs. A knob is kept when the kind changes, so changing back restores it.
  - **A Transition's sound is one of three:**
    - Linear (acrossfade's `tri`, the default);
    - Equal power (`qsin`);
    - Cut, which switches at the middle of the overlap.
- **The preview imitates every kind in CSS, on both layers.**
  - For the overlap, the ghost and the main picture layer are both styled: transforms, clip-path and masks, filters, a warm gradient layer blended over them, and SVG filters.
  - So in a push, a cover or a spin, the incoming side moves too.
  - The Transitions tab's cards use the same look functions on two built-in sample pictures. Each card holds mid-way and plays on hover.
  - Timing is exact; the look is near. A pixel dissolve, Distance and Glitch are the furthest from the render.

## Considered options

- **A `custom` expression for every look.** One format, but ffmpeg's expression interpreter costs 4–26 s of render per 0.5 s join, on every Candidate a batch renders.
- **Only xfade's built-ins.** This is the cheapest, but it would drop the looks the feature exists for (whip pan, spin, film burn, light leak).
- **A WebGL canvas for the overlap.** It would be the most faithful, and shaders could port xfade's formulas. But it would need a second compositor for Segment pictures (panels, crops, the blurred Background, Transforms, Keyframes), and that compositor would have to match the DOM exactly at both ends of the overlap.
- **A shared data file for the catalogue** (JSON read by Python and Vite), or a catalogue served by the API. Each side still needs its own code per kind (a recipe, a CSS look). The enum and the exhaustive `Record` make the type checkers enforce that every kind has both.

## Consequences

- **Every kind is written twice,** as an ffmpeg recipe and as a CSS look, and the two can drift. Backend tests render a frame mid-Transition per recipe. The preview has no pixel test.
- **A new look must be buildable from native filters around xfade,** or from an expression that doesn't sample. A swirl or a cube (per-pixel warps) is out until that changes.
- **The sound follows the Transition's sound setting for every kind,** dips included. A dip never drops the sound out on its own.
- **A knob must map onto a native filter's setting or a constant in the expression.** A knob that would need per-pixel sampling (a softness on xfade's built-in wipes, for example) is out.
