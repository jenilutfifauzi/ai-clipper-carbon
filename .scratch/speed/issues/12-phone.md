# 12: Speed, Reverse and Freeze frame on a phone

**Parent spec:** `spec.md` in this feature folder (Solution "Editing": on a phone); ADR 0009.

**What to build:** on a phone, the owner reaches Speed, Reverse and Freeze frame from the Advanced Edit's toolbar.

- **A Speed button** in the toolbar for a Segment or a video Overlay picked alone opens a Speed sheet: the chips, the slider, the number field, the pitch switch and Reverse with its progress. A Freeze frame's sheet shows its Duration.
- **Freeze frame** sits beside Split in the toolbar.
- The Edit sheet's inspector shows the same Speed section.

**Blocked by:** 05, 08, 11.

**Status:** done

- [x] At phone width, picking one Segment shows Speed in the toolbar; picking two hides it.
- [x] The Speed sheet sets 2× and Reverse, each one step of undo, with the Timeline updating behind it.
- [x] Freeze frame from the toolbar inserts a 1 s Freeze frame at the playhead.
- [x] Every control of the sheet is reachable with the thumb and meets the 44 px tap target.

## Comments

**2026-10-17: done.** All frontend, `pages/job/advanced/`.

**What was built:**
- `actions.ts`: `paced(scene, video)`, the one picked Segment (a Freeze frame too) or video Overlay, whose Speed sheet the toolbar opens: `reversible` plus Freeze frames. Null for none or several picked, an image, a Text Layer or a Music Clip.
- `Chrome.tsx` `Toolbar`: a **Speed** tool button (FastForward icon) after Transform while `onSpeed` is given (`AdvancedEdit` passes it for `paced`), and a **Freeze frame** tool button (Snowflake) right after Split, in both the bar with nothing picked and the bar of a pick, wired to 11's `freezer` (`AdvancedEdit`'s `freezes`) and enabled while `canFreeze` at the playhead, as Split is.
- `SpeedFields.tsx` `SpeedPanel`: the phone's Speed sheet of a `paced` item. A Segment's or video Overlay's `SpeedFields` with the inspector's history groups (`<kind>:<id>:speed`, `:pitch`), `copy` from `AdvancedEdit`'s `copyOf`, Reverse through `setItemReverse`; a Freeze frame's `HoldFields` instead. The sheet is titled "Speed" (for a Freeze frame too); `AdvancedEdit`'s sheet state gains `"speed"`.
- Tap targets in a sheet (`in-data-sheet:`, as KeyEase and KeyCluster do): the chips and the number fields (Speed and Duration) are 44 px tall, and so is every `Slider`'s range input (`components/Slider.tsx`). This applies in the Edit and Transform sheets too. The switches already were (`min-h-11` labels), and so were the tool buttons (56 px). The R key cap is hidden in a sheet: a phone has no R.
- The Edit sheet's inspector already showed the same Speed section (05/08/11), so nothing changed there.

**Tests:** `advanced/phoneSpeed.test.tsx` (9): `paced` for one Segment, a Freeze frame and a video Overlay, and none for two Segments, an image, a Text Layer or nothing; the Toolbar rendered with `react-dom/server` shows Speed as a tool button only when `onSpeed` is given; the sheet's 2× (one change of `segment:s2:speed`, the Main Track 18 s down to 15 s) and Reverse (one change with no group, so it never merges into the Speed's step) driven through `SpeedPanel`'s props over `gestureSpeed`/`setReverse`; an Overlay's sheet; a Freeze frame's `HoldFields`; every control of the rendered sheet 44 px tall; Freeze frame through `freezer` at 3 s of a 6 s Segment inserting a 1 s Freeze frame (0–3, 3–4, 4–7) that is picked, and off within 0.3 s of an edge. Full `npx vitest run` passes and `tsc` is clean.

**Checked in the browser** (Vite from this worktree against the running backend, on a real Job at a phone viewport, nothing edited): with nothing picked the bar reads Text · Audio · Media · Transitions · Split · Freeze frame · Playback · Tracks · Pick (Split and Freeze frame off at 0:00). With a Segment picked it reads Done · Edit · Transform · Speed · Split · Freeze frame · Duplicate · Delete · Ripple · Pick. The Speed sheet's chips, slider, number field and two switches each measure 44 px tall. No screenshot: the browser's capture timed out in this environment.

**Decided differently, or for later:**
- **No DOM test library** (no jsdom or Testing Library in the repo), so there are no click-through component tests. The Toolbar is rendered statically without item actions, because Split and Freeze frame read the playhead through `useSyncExternalStore`, which a server render refuses without a server snapshot. The sheet is tested by calling `SpeedPanel` and driving the props it gives `SpeedFields`.
- **The button reads "Speed" for a Freeze frame too** (its sheet shows "Freeze frame" with its Duration), as the ticket words it.
- **The toolbar is now wider** (9 or 10 buttons). It already scrolled sideways (`overflow-x-auto`), so nothing more was done.
- **13 (walkthrough):** check on a real phone that the bar's scroll keeps Speed and Freeze frame easy to find, and that the sheet's 60 dvh leaves the Reverse switch in view without scrolling on a small phone.
