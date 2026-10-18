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

**Status:** ready-for-agent

- [ ] Each kind's middle frame differs from both sides' own pictures (real render), and its Clip is shortened by the overlap.
- [ ] Spin's middle frame shows the picture turned. Whip pan's shows horizontal smear and the pictures moving.
- [ ] Strength 0 and 1 give measurably different middle frames for each kind that reads it.
- [ ] A 0.5 s join of each kind renders within the budget set in 04.
- [ ] In the preview, Whip pan and Spin move both pictures with exact timing.
