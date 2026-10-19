# 05: Blur dissolve, Whip pan, Zoom blur, Spin and Glitch

**Parent spec:** `../spec.md` ("Catalogue and rendering" recipe sketches, "Preview"); ADR 0012 (native filters around one xfade; no sampling expressions).

**What to build:** the rest of Concat's looks, each a recipe of native filters on the two sides, enabled only over the overlap, in front of one xfade. Each has a CSS look that moves both sides, and reads `strength` where marked.

| Kind | Group | Recipe | Strength |
|---|---|---|---|
| `blurdissolve` (Blur dissolve) | Basic | blur on both sides, peaking at the middle where a filter allows ramping (e.g. `sendcmd`), else steady; then `fade` | the blur |
| `whipleft`, `whipright` (Whip pan) | Slide | horizontal `gblur` on both sides; then `slideleft` / `slideright` | the blur |
| `zoomblur` (Zoom blur) | Zoom | scale up by an expression in `t`, plus blur; then `fade` | the amount |
| `spin` (Spin) | Zoom | `rotate` (and shrink) by an expression in `t` on both sides; then `fade` | the turns, 0.5–2 |
| `glitch` (Glitch) | Glitch | `rgbashift` and `noise` over the overlap, around a slice or pixelize xfade | the amount |

If a recipe can't meet the render budget with native filters, simplify the look rather than use a sampling expression. Record what was chosen in the ticket's Comments.

**Blocked by:** 04.

**Status:** done

- [x] Each kind's middle frame differs from both sides' own pictures (real render), and its Clip is shortened by the overlap.
- [x] Spin's middle frame shows the picture turned. Whip pan's shows horizontal smear and the pictures moving.
- [x] Strength 0 and 1 give measurably different middle frames for each kind that reads it.
- [x] A 0.5 s join of each kind renders within the budget set in 04.
- [x] In the preview, Whip pan and Spin move both pictures with exact timing.

## Comments

**2026-10-19, agent:** Built. Every recipe is native filters on both sides around a built-in xfade; no `custom` expression.
- **Model** (`app/candidates.py`): `TransitionKind` gains `blurdissolve` (Basic, last), `whipleft`, `whipright` (Slide, after the Covers), `zoomblur`, `spin` (Zoom, last) and `glitch` (Glitch, first). `STRENGTHS`: 0.5 for each, Spin's 1/3 (one turn).
- **Recipes** (`app/transitions.py`):
  - `blurdissolve`: `gblur` on both sides, its sigma rising to strength × width/27 at the middle and back. gblur's sigma takes no expression, so `_blurred` steps it by `sendcmd` 30 times a second, aimed at the side's own instance (`gblur@{side.name}`), and `enable`s it over the overlap; then `fade`.
  - `whipleft`/`whipright`: the same ramp across only (`sigmaV=0`), up to strength × width/8; then `slideleft`/`slideright`.
  - `zoomblur`: `scale` with `eval=frame` by 1 + 0.6 × strength × `_peak`, `crop` back to the frame about the middle (its x/y by the same expression, as crop's `iw` is the configured size), plus the blur ramp (width/54); then `fade`. Outside the overlap the scale is 1, so `scale` passes frames on.
  - `spin`: `scale` down by up to 30% at the middle, `pad` back (`eval=frame`), then `rotate` by 2π × turns (0.5 + 1.5 × strength) × a smoothstep of the overlap's share, the incoming side one whole spin behind so it ends upright; `enable`d over the overlap; then `fade`.
  - `glitch`: `rgbashift` (red left, blue right by strength × width/18, green down a third of that) and `noise` (`alls` 60 × strength, temporal) on the overlap only, by `_overlapped`, 04's trim-and-concat (now shared with `_split`); then `hlslice`.
  - Measured in the budget test (fade 1.84 s): blurdissolve 3.07, whipleft 2.84, whipright 2.40, zoomblur 3.22, spin 2.29, glitch 2.23 s. All within `RENDER_BUDGET_SECS`.
- **MCP**: the Transition paragraph names the new kinds under their groups and says what `strength` is for each. `TOOLS_BUDGET_BYTES` didn't need raising.
- **Preview** (`editor/transitions.ts`), each by `strong(own, look)`: Blur dissolve a crossfade through `blur()`; Whip pan the Push of its side with `url(#transition-whip-N)` on both, N tenths of strength × peak (`WHIP_LEVELS`, `whipFilter`; `TransitionFilters.tsx` draws them as `feGaussianBlur` across only, in bounding-box units, an eighth of the width at most); Zoom blur `scale()` and `blur()` on both; Spin `rotate()` and `scale()` on both, the same turns and easing as the render; Glitch the Slices mask (now `slices`) with RGB split's filters at 1.5 × strength and a small horizontal shake. `CARD_MOMENTS` rests Spin at 0.35, since at 0.5 its one turn leaves both upside down.

Checked:
- Seam A, real ffmpeg, on 04's `striped_video`: each kind's middle differs from both sides (mean > 8) in a Clip shortened by the overlap; half a turn's Spin has the stripes lying across at the middle and not either side; Whip pan left's middle is less than half as sharp across as Push left's, its left half nearer the outgoing picture and its right half the incoming one (Whip pan right the reverse); strength 0 and 1 give middles differing by a mean over 6 for all six kinds. All six added to the render budget test.
- MCP: the strength sentence names the six; Slide and Zoom list the new kinds.
- vitest: the catalogue's groups and labels; which kinds read strength and their defaults; Whip pan's push and filter levels, none at 0; Spin's turns at strength 0 and 1, easing, shrink; Blur dissolve and Zoom blur blurring by strength, most halfway; Zoom blur's scale; Glitch's slices and tearing, nothing at 0. Every kind still shows all of the outgoing at 0 and only the incoming at 1.
- Tests run (related files only): backend `test_transitions.py`, `test_mcp.py`, `test_planner.py`: 138 passed; frontend `transitions.test.ts`, `Transitions.test.tsx`, `transitionPanel.test.tsx`, `transitionCards.test.tsx`, `transitionSound.test.ts`: 75 passed; `tsc` clean. `git merge main`: already up to date. Not looked at in a browser.

