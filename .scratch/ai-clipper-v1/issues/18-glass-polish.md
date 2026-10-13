# 18: Glass polish, themes, responsive, README

**Parent spec:** `spec.md` in this feature folder (Milestone M6; user stories 68–70; Design system).

**What to build:** The full Apple-style glass design system across every page. That means:
- glass surfaces with orange background blobs;
- spring transitions that respect reduced motion;
- a light/dark toggle;
- layouts that work at phone width.

Plus a README covering setup, daily use, the Reference Set and eval workflow, and troubleshooting.

**Blocked by:** 11 (Review UI), 16 (Hook overlay), 17 (Upload master file).

**Status:** done

- [x] Token values match the spec for both dark (default) and light themes. The theme choice is remembered per viewer.
- [x] These components are styled to the glass system: glass panel, buttons (orange primary, glass secondary), segmented control, slider, toggle, score ring, stage progress, disk meter, Candidate row, Transcript Picker, and Clip card.
- [x] No horizontal scroll at 375 px width. Review and Clip cards are usable on a phone.
- [x] `prefers-reduced-motion` disables the spring and blob motion.
- [x] Browser screenshots in dark, light, and phone width are attached to the ticket's comments.
- [x] The README covers:
  - prerequisites and setup;
  - running the app;
  - the Reference Set and `eval` workflow;
  - updating yt-dlp when YouTube breaks;
  - memory tips for 8 GB machines.

## Comments

**2026-10-14: implemented, not committed (awaiting owner review).** `npm run typecheck` and `npm run build` pass. `make test`: 243 passed (no backend change). The impeccable detector found nothing. Browser check done with ego-browser on the running `make dev` (below).

Built:
- `styles/tokens.css`: the spec's values for both themes:
  - dark: `#000` background, glass `rgb(255 255 255 / 0.06)`, edge 0.12, a 1 px inner-top highlight, text `#fff` and 0.6, orange `#FF9F0A` with a gradient to `#FF6A00`;
  - light: `#F5F5F7` background, glass white 0.7, text `#000`;
  - new tokens: `--fill` (Apple's systemFill, for inset wells), `--focus`, `--blob`, `--shadow-raised` and `--shadow-accent`, `--theme-color`, `--glass-filter: blur(28px) saturate(180%)`, `--ease-spring` (a `linear()` damped spring, damping 0.72, under 4% overshoot, 380 ms, generated numerically) and `--ease-out`.
  - **The light block is written twice:** once under `@media (prefers-color-scheme: light) :root:not([data-theme="dark"])` and once as `:root[data-theme="light"]`. The two must stay identical. `light-dark()` would avoid the copy, but it isn't Baseline widely available yet, and an older iPhone would lose every colour.
- `index.css`:
  - `@utility glass` (fill, edge, highlight, shadow, blur) and `@utility raised` (a control on glass);
  - the `.blobs` layer;
  - base styles: range inputs drawn like macOS's slider (track filled up to `--range-fill`), themed scrollbars and caret, `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation` on controls, and a focus ring in `--focus`.
- `theme.ts`, `components/ThemeToggle.tsx` and an inline script in `index.html`. The script applies a stored choice before first paint, so there is no flash.
- `components/ScoreRing.tsx` (new).
- Restyled: `Panel` (glass), `Button`, `Segmented`, `Switch`, `ProgressBar`, `StageProgress`, `DiskMeter`, `StatusBadge`, `ConfirmDialog`, and the Candidate row, Transcript Picker, hook editor, preview, Clip card, Recent Jobs, the form, the Job header and the notes.

**Theme toggle** (the header's sun/moon button). It has two states, per web.dev's guidance on dark-mode toggles:
- It switches to the opposite of what is on screen.
- The choice is stored (`localStorage["ai-clipper-theme"]`) only when it differs from the system's. Toggling back to the system's theme removes it, so the app follows the system again.
- With nothing stored, the app follows the system, dark when the system is dark.
- Every storage access is in try/catch: with storage blocked, the theme still applies for the page's life.
- It follows system changes and other tabs (`storage` event), updates `theme-color` for the browser chrome, and turns off transitions for the frame the tokens swap.

**Glass and cost.** Only top-level surfaces blur: the panels, the error and quota notes, and the dialog. Everything inside them uses plain translucent fills: buttons, segments, rows, wells and Clip cards. So a page has 3–6 blurred layers, and none sits over a video:
- the header isn't sticky;
- the Candidates panel is sticky only beside the editor;
- the video players are inside panels, not under them.

The blobs are two radial gradients on one fixed layer, with no `filter: blur`. They drift over 48 s and 60 s. **One cost:** while the blobs drift, the panels' backdrop has to be blurred again each frame. That runs on the GPU, which Whisper (MLX) also uses. A static blob layer is a one-line change if transcription is measurably slower.

**Components:**
- **Buttons:** primary is the orange CTA gradient with a soft orange shadow; secondary is a raised glass control. Press feedback is 0.97 scale, hover is gated by Tailwind v4.
- **Segmented control:** the thumb springs to the choice.
- **Switch:** an orange gradient track; the thumb springs.
- **Stage progress:** a rail between markers, and done stages in orange. When no stage is running (review), the stages collapse to one row instead of 250 px.
- **Disk meter:** it now also labels the bar's grey "other files" share.
- **Score ring:** in each Candidate row and on Clip cards, with the label "Score N out of 100".
- **Transcript Picker:** an inset well; taller lines on touch screens (`pointer-coarse:leading-8`).
- **Clip card:** a 20 px-rounded 9:16 player. Its width is capped at `85svh × 9/16`, so a phone held sideways still shows the whole frame.
- **Slider:** no screen uses one yet. Range inputs are styled at the base layer and were checked on an injected input (`t18-focus-and-slider-dark.png`).

**Responsive (375 px).**
- The Home and Review grids now use `grid-cols-1` (`minmax(0, 1fr)`). Home scrolled sideways by 55 px: a long upload file name in Recent Jobs set the implicit grid track's min-content.
- On a phone, a Recent Jobs row shows its status under the title, so the title keeps the width.
- On narrow screens, tapping a Candidate scrolls its editor (below the list) into view: smooth, or instant under reduced motion.
- `scrollWidth == 375` on Home and on the Job page, through the review and the Clips.

**Reduced motion.** I removed the global "0.01 ms for everything" rule, which web.dev advises against. Every transition and animation is now gated with `motion-safe:` or `prefers-reduced-motion: no-preference`. Checked under emulated `reduce`:
- the blobs' `animation-name` is `none`;
- the switch and segment thumbs have `transition-duration: 0s`;
- spinners stand still.

**Fixes:**
- **Upload Jobs' badge.** The status badge said "Downloading" during an upload Job's first stage. It now reads **"Preparing file"**: the upload itself finishes on Home, before the Job exists, so "Uploading" would be wrong. The error note now reads "Failed during file preparation" and "Retry from file preparation", and warnings say "Upload:". This is checked in code only: no upload Job was in that stage during the check.
- **Copy buttons now click-checked.** I clicked them and read the macOS clipboard back with `pbpaste`; the owner's clipboard was saved before and restored after.
  - Editor "Copy title" (Clipboard API) gave the exact title.
  - Editor "Copy TikTok", with `navigator.clipboard` removed to force the `execCommand` fallback a phone over LAN http uses, gave the exact description, a blank line and the hashtags.
  - A Clip card's "Instagram" button gave the exact text.
- **A bug that predated this ticket: `Button` size overrides did nothing.** Tailwind orders same-property utilities by value, not by class order, so a `px-0`, `px-3` or `min-h-10` passed in lost to the base `px-4` and `min-h-11`. The icon-only buttons (delete, and the new toggle) squeezed their icon to 12 px wide. `Button` and `buttonClass` now take a `size` prop (`md`, `sm`, `xs`, `icon`), and all call sites use it.
- **Accessibility:**
  - the focus ring uses `--focus`, which is `#b25000` in light, since systemOrange on white is under 3:1;
  - each Clip card's copy row is a group labelled "Copy posting text";
  - the delete dialog still opens, closes with Esc and returns focus to its trash button (checked).

**README.md** (new, at the repo root) covers:
- prerequisites and setup;
- `.env`: Gemini or OpenAI-compatible/DeepSeek, keys, pacing, the free tier's ~20 requests a day against about 4 per 40-minute episode, and quota waits;
- running: `make dev`, `make build`, and phone access with `--host 0.0.0.0`, with a no-auth warning;
- the daily workflow;
- the CLI commands;
- the Channel Profile through `PUT /api/profile`, since it has no page;
- the Reference Set, `make eval`, `postable.yaml` and `make gate`;
- troubleshooting: `make update-ytdlp`, cookies, 503/429 waits, and memory on 8 GB (close Chrome during full transcription);
- where data lives.

**Screenshots** (session scratchpad `/private/tmp/claude-501/-Users-indobuzz-Developer-ai-clipper/671b7433-cf72-467e-acb4-09f567632e9e/scratchpad/`):
- dark: `t18-home-dark.png`, `t18-review-dark.png` (Job `1d5d363bec2e`), `t18-review-editor-dark.png`, `t18-clips-dark.png`, `t18-dialog-dark.png`, `t18-focus-and-slider-dark.png`;
- light: `t18-home-light.png`, `t18-review-light.png`, `t18-review-editor-light.png`, `t18-clips-light.png`;
- 375 px: `t18-phone-home-dark.png` and `t18-phone-home-light.png` (full page), `t18-phone-review-top-dark.png`, `t18-phone-review-top-light.png`, `t18-phone-editor-dark.png`, `t18-phone-clips-dark.png`, `t18-phone-clips2-dark.png`, `t18-phone-clips-light.png`.

`make dev` was already running from an earlier session. I reused it and left it running. The browser task space is closed, and no stored theme was left behind. No Job data was changed: the delete dialog was cancelled.

Open issues:
- **No Channel Profile page.** The spec lists one, but no ticket built it. The README documents the API instead.
- **Not tested on a real phone.** The phone checks used Chrome's mobile emulation. Sticky hover, the keyboard, safe areas and the `execCommand` copy in Safari need a real iPhone.
- **The blob drift's GPU cost** during transcription isn't measured (see above).
- **Low contrast on input edges in light.** A 0.08 black edge on a light grey fill is under 3:1. The fields are labelled, but WCAG 1.4.11 strictly asks for more.
- **An empty top in the editor panel.** It keeps a 20 px slot for the "Saving… / All changes saved" status, so the panel doesn't shift when it appears.


**2026-10-14: verified by the owner's session.** 243 tests pass, the frontend builds, and the Clip-card screenshot was reviewed. Committed.
