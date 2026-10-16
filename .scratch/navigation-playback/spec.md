# Navigation and playback in the Advanced Edit at parity with Concat

Status: ready-for-agent
Created: 2026-10-16

## Problem Statement

Moving around a Clip in the Advanced Edit is slow, and its preview has gaps.

- **The playhead can't be moved precisely from the keyboard.**
  - ←/→ move the picked items, not the playhead.
  - There is no frame step, no Home/End, and no jump to the next join or item edge.
  - To land on a cut, the owner drags the playhead and hopes.
- **Zoom has no keys.** Shift+Z fits, but zooming in or out takes the wheel or the buttons.
- **The preview stalls at every join.** The Source video seeks at each Segment's start, and the pause is visible on every cut, even on a local file (ADR 0002's known gap).
- **A stretch can't be watched again and again.** Judging a cut or a beat means pressing Space, dragging back and pressing Space again.
- **Speed and size are fixed.** The owner can't play faster to review a long Clip, slower to judge a cut, or full screen to watch it as a viewer would.
- **The Timeline can't be skimmed.** To see what is at a point, the owner moves the playhead and loses their place.
- **The keys are undiscoverable.** No sheet lists them.
- **Concat has all of this.** It has frame step (Shift ×10), Home/End, zoom keys, a preview axis (S) with optional sound, and a shortcuts sheet.

## Solution

The Advanced Edit gets Concat's navigation keys and a better preview. See GLOSSARY.md (Edit Point, Skim, Loop Region) and ADR 0006 (the preview plays the Source on two decks).

**Keys** (desktop; never while typing in a field). One keymap table defines them, and the shortcuts sheet is drawn from the same table.

| Key | Does |
|---|---|
| ← / → | Playhead one frame back / forward |
| Shift+← / → | Ten frames |
| Alt+← / → | Move the picked Text Layers, Music Clips and Overlays one frame |
| Alt+Shift+← / → | Move them ten frames |
| Home / End | Playhead to the Clip's start / its last frame |
| ↑ / ↓ | Playhead to the previous / next Edit Point |
| = / - | Zoom the Timeline in / out about the playhead |
| Shift+Z | Zoom to fit (unchanged) |
| I / O | Set In / Out at the playhead |
| L | Loop on / off |
| Alt+X | Clear In and Out |
| S | Skim on / off |
| F | Fullscreen preview on / off |
| ? | Shortcuts sheet |
| Space | Play / pause (unchanged) |

- **A frame is one frame of the Clip,** whose rate is the Source's (the plan's fps: 25, 30, 50 or 60). The playhead sits on that grid.
- **←/→ always belong to the playhead.** Clicking an item on the Timeline no longer gives it the keyboard focus. An item reached with Tab keeps its own arrows (move, Shift trims its end, Alt ×10), so the Timeline stays usable from the keyboard alone.
- **There is no J/K/L shuttle.** A browser cannot play video backwards. Space and the playback rate cover the rest.

**Edit Points.** ↑/↓ jump between the same points that items snap to:
- Segment joins;
- the edges of Text Layers, Music Clips and Overlays;
- the edges of the hook;
- 0 and the end of the Clip.

Items on hidden Tracks are skipped. The jump stops at the first and last point and does not wrap.

**Seamless joins.** The preview keeps a second deck of Source videos parked at the next join and swaps to it there. A join between Source Segments plays without a pause, and so does a Loop Region's wrap. A media Segment's video waits on its first frame. The clip editor gets the same, as it shares the preview.

**Loop Region.**
- I and O mark In and Out at the playhead. The Timeline's ruler shows the Region as a band, and its ends can be dragged.
- L, or a loop button in the player bar, turns Loop on and off. Loop needs both marks. Pressing L with none set marks the whole Clip.
- **With Loop on,** Space plays from the playhead if it is inside the Region, and otherwise from In. At Out it goes back to In without stopping.
- **With Loop off,** playing stops at the Clip's end as it does today.
- Alt+X clears the marks and turns Loop off.
- The Region is kept in the editor only. It is never saved, never undone, never seen by the agent, and gone when the editor closes.

**Playback rate.** A menu in the player bar offers 0.5×, 1×, 1.5× and 2×.
- It applies to everything the preview plays: the Source decks, media Segments, Overlays, Music Clips and the clock of media Segments.
- The browser keeps the pitch.
- It is kept in the editor only and starts at 1× each time.
- It is not a Clip's speed: that is the later `speed` feature.

**Skim** (desktop only).
- S turns it on and off, and the browser remembers it. A Skim button sits beside the zoom buttons.
- While it is on and the preview is paused, the preview shows the frame under the pointer as it moves over the Timeline, with a thin line marking that spot.
- The playhead does not move. When the pointer leaves, the preview shows the playhead's frame again at once.
- A second switch next to it plays the sound under the pointer in short snippets. It is off by default and also remembered.

**Fullscreen preview.**
- F, or a button in the player bar, puts the whole stage full screen: the video, captions, hook, Text Layers, Overlays and Watermark.
- Play/pause, the time and an exit button show while the pointer moves, and fade out after a moment.
- Editing on the stage is off while full screen.
- Esc or F leaves.
- On an iPhone, where only a `<video>` can go full screen, the stage fills the whole window instead.

**Shortcuts sheet.** ? or a keyboard icon in the top bar opens a sheet listing every key above, grouped by playback, navigation, editing and view. It is drawn from the keymap table, and on a Mac it names keys as a Mac writes them (⌥, ⇧, ⌘). It is not shown on a phone.

**On a phone.**
- The player bar gets ◀ / ▶ frame buttons and the fullscreen button.
- A "Playback" bottom sheet, opened from the toolbar, holds:
  - the rate;
  - In, Out, Loop and Clear;
  - previous and next Edit Point.
- There is no Skim (there is no hover) and no shortcuts sheet.

**Already there:** playing stops at the Clip's end, and Space at the end plays from the start.

## User Stories

**Frame step and jumps**

1. As an owner, I want → to move the playhead one frame, so that I can find the exact frame of a cut.
2. As an owner, I want Shift+→ to move ten frames, so that I can cover ground quickly without losing precision.
3. As an owner, I want ← and Shift+← to do the same backwards, so that I can go back as easily as forward.
4. As an owner, I want a frame to be a frame of the Clip as rendered (its fps), so that what I step to is a frame that really exists in the output.
5. As an owner, I want the playhead to land on the frame grid when I step, so that steps never drift between frames.
6. As an owner, I want frame step to pause playback, so that I see the frame I stepped to.
7. As an owner, I want the frame step to stop at 0 and at the last frame, so that I never step into nothing.
8. As an owner, I want Home to take the playhead to the Clip's start, so that I can replay from the top.
9. As an owner, I want End to take the playhead to the Clip's last frame, so that I see how the Clip ends, not a frame after it.
10. As an owner, I want ↓ to jump to the next Edit Point, so that I can go from cut to cut without dragging.
11. As an owner, I want ↑ to jump to the previous Edit Point, so that I can go back a cut.
12. As an owner, I want Edit Points to include the edges of Text Layers, Music Clips, Overlays and the hook, as well as Segment joins, so that I can check where every item starts and ends.
13. As an owner, I want items on hidden Tracks to be skipped by ↑/↓, so that I only visit what I'm looking at.
14. As an owner, I want ↑/↓ to stop at the first and last Edit Point rather than wrap, so that I know when I've reached the end.
15. As an owner, I want the Timeline to scroll to keep the playhead in view after a jump or a step, so that I never lose it off-screen.

**Moving items by key**

16. As an owner, I want Alt+←/→ to move the picked Text Layers, Music Clips and Overlays one frame, so that I can nudge them precisely now that bare arrows move the playhead.
17. As an owner, I want Alt+Shift+←/→ to move them ten frames, so that bigger nudges are still quick.
18. As an owner, I want a run of Alt+arrow presses to undo as one step, as arrow moves do today, so that undo stays clean.
19. As an owner, I want clicking an item on the Timeline not to steal the arrow keys, so that ←/→ keep stepping frames after I pick something.
20. As a keyboard-only owner, I want an item I reach with Tab to keep its own arrows (move, Shift to trim its end), so that I can still edit the Timeline without a mouse.

**Zoom keys**

21. As an owner, I want = to zoom the Timeline in, so that I can see detail without reaching for the trackpad.
22. As an owner, I want - to zoom it out, so that I can get the overview back.
23. As an owner, I want these zooms to keep the playhead where it is on screen, so that what I'm working on stays under my eyes.
24. As an owner, I want a zoom with the playhead off-screen to bring it to the middle, so that the zoom lands where I am working.
25. As an owner, I want the zoom keys to step as the zoom buttons do and stop at 1× and the deepest zoom, so that they behave the same as the buttons.

**Seamless joins**

26. As an owner, I want the preview to play across a join between Source Segments without a pause, so that I judge the cut as a viewer will see it.
27. As an owner, I want a Split or Blur Scene's second panel to cross the join without stalling too, so that every part of the frame is seamless.
28. As an owner, I want a media Segment to start on its first frame when its turn comes, so that inserted videos don't stall either.
29. As an owner, I want a join's sound to carry on without a gap, so that cuts sound as they will in the Clip.
30. As an owner, I want playback after a seek or an edit to be seamless again by the next join, so that editing doesn't leave the preview stuttering.
31. As an owner, I want the preview to fall back to seeking when the next join isn't ready (several very short Segments in a row), so that playback never freezes.
32. As an owner, I want Transitions to look and sound as they do today, so that nothing I've built changes.
33. As an owner, I want the clip editor's preview to play cut Clips seamlessly too, so that both editors agree.

**Loop Region**

34. As an owner, I want I to set In at the playhead, so that I can mark where a stretch starts.
35. As an owner, I want O to set Out at the playhead, so that I can mark where it ends.
36. As an owner, I want setting In after Out (or Out before In) to swap them, so that I never get an empty Region.
37. As an owner, I want the Region shown as a band on the ruler, so that I can see what will loop.
38. As an owner, I want to drag the band's ends, so that I can adjust the Region without moving the playhead.
39. As an owner, I want L to turn Loop on and off, so that I can loop and stop looping quickly.
40. As an owner, I want L with no marks to loop the whole Clip, so that one key loops what I'm watching.
41. As an owner, I want playback with Loop on to return from Out to In without stopping, so that I can watch a stretch over and over.
42. As an owner, I want the return from Out to In to be seamless, so that a looped beat or cut plays smoothly.
43. As an owner, I want Space outside the Region to start from In, so that I hear the loop straight away.
44. As an owner, I want Space inside the Region to play from the playhead, so that I can start mid-loop.
45. As an owner, I want Alt+X to clear the marks and turn Loop off, so that I can get back to normal playback.
46. As an owner, I want a loop button in the player bar that shows whether Loop is on, so that I know why playback keeps returning.
47. As an owner, I want the Region to stay where it is in Timeline time when I edit, and to be clamped inside the Clip if the Clip gets shorter, so that it never points past the end.
48. As an owner, I want the Region not to be saved, undone or shared with other editors or the agent, so that it is a viewing aid and not part of the Candidate.

**Playback rate**

49. As an owner, I want to play at 1.5× or 2×, so that I can review a long Clip faster.
50. As an owner, I want to play at 0.5×, so that I can judge a cut or a word's timing closely.
51. As an owner, I want every sound and video in the preview to follow the rate, so that music, Overlays and media Segments stay in sync.
52. As an owner, I want the pitch kept at speed, so that speech stays intelligible.
53. As an owner, I want the rate to show in the player bar, so that I don't mistake a fast preview for a fast Clip.
54. As an owner, I want the rate back at 1× each time I open the editor, so that I'm never surprised by a leftover speed.

**Skim**

55. As an owner, I want S to turn Skim on, so that I can see what's anywhere on the Timeline just by pointing.
56. As an owner, I want the preview to show the frame under the pointer while Skim is on and playback is paused, so that I can find a moment without moving the playhead.
57. As an owner, I want a line on the Timeline where the pointer is, so that I know which time the preview is showing.
58. As an owner, I want the preview to snap back to the playhead's frame at once when the pointer leaves the Timeline, so that I never lose my place.
59. As an owner, I want Skim to show captions, the hook and every layer at the skimmed time, so that I see the whole frame there.
60. As an owner, I want an optional Skim sound, off by default, so that I can find a word by ear when I want to and stay quiet when I don't.
61. As an owner, I want Skim and its sound to be remembered by the browser, so that I don't turn them on every time.
62. As an owner, I want Skim to stop while playing, so that the preview shows the playback and not the pointer.
63. As an owner, I want dragging an item or the playhead to work as before with Skim on, so that Skim doesn't get in the way of editing.

**Fullscreen**

64. As an owner, I want to watch the preview full screen, so that I see the Clip as a viewer would.
65. As an owner, I want captions, the hook and every layer drawn full screen, so that it's the Clip and not just the video.
66. As an owner, I want play/pause, the time and an exit button that show when I move the pointer, so that I can control playback without leaving.
67. As an owner, I want F or Esc to leave full screen, so that getting out is easy.
68. As an owner, I want stage editing off while full screen, so that a stray click doesn't move a layer.
69. As an owner on an iPhone, I want the preview to fill the window, so that I get the closest thing to full screen that the phone allows.
70. As an owner, I want Space and the arrow keys to keep working full screen, so that I can review without leaving.

**Shortcuts sheet**

71. As an owner, I want ? to open a sheet of every shortcut, so that I can learn them.
72. As an owner, I want a keyboard icon in the top bar that opens the same sheet, so that I can find it without knowing ?.
73. As an owner, I want the sheet grouped by playback, navigation, editing and view, so that I can scan it quickly.
74. As an owner on a Mac, I want keys named as a Mac writes them (⌘, ⌥, ⇧), so that the sheet matches my keyboard.
75. As an owner, I want the sheet to always match what the keys really do, so that I can trust it.
76. As an owner, I want Esc to close the sheet, so that it's quick to dismiss.

**Phone**

77. As an owner on a phone, I want ◀ and ▶ frame buttons in the player bar, so that I can step frames without a keyboard.
78. As an owner on a phone, I want a fullscreen button in the player bar, so that I can watch the Clip big.
79. As an owner on a phone, I want a Playback sheet with rate, In/Out/Loop/Clear and previous/next Edit Point, so that I get the same tools without crowding the player bar.
80. As an owner on a phone, I want seamless joins too, so that the preview plays the same everywhere.

**Unchanged and safe**

81. As an owner, I want none of these keys to fire while I type in a field or edit text on the stage, so that typing never moves the playhead.
82. As an owner, I want Cmd/Ctrl+= and Cmd/Ctrl+- to stay the browser's page zoom, so that I can still zoom the page.
83. As an owner, I want Space, undo/redo, split, copy/paste, duplicate, delete and Shift+Z to keep working as today, so that nothing I've learned breaks.
84. As an owner, I want playing to stop at the Clip's end when Loop is off, as today, so that I'm not surprised.

## Implementation Decisions

**The keymap table (new, pure).**
- One table lists every Advanced Edit shortcut. Each row has:
  - its id;
  - its keys (a key name plus modifiers, with Cmd/Ctrl as "command");
  - the group shown on the sheet;
  - a label;
  - whether it is desktop only.
- **A resolver** takes a key event's key and modifiers, plus a context, and returns the row's id or nothing. The context says:
  - whether a field or stage text has the focus;
  - whether an item reached by Tab has it;
  - whether the stage is full screen.
- **`useShortcuts` dispatches by id** instead of comparing keys inline. The sheet renders the same rows.
- **Platform naming** (⌘ ⌥ ⇧ on a Mac, Ctrl/Alt/Shift elsewhere) is a pure function of the row and the platform.
- **Precedence:**
  - a focused field or stage text takes everything, as today;
  - an item focused by Tab keeps its own arrows, Enter/Space and Delete;
  - everything else goes to the table.
- Bare letters (I, O, L, S, F) are matched case-insensitively, as Concat does, so that Caps Lock doesn't break them. They are ignored with Cmd/Ctrl, so that Cmd+L and Cmd+F stay the browser's.

**Navigation math (pure, in or beside the Timeline-view module).**
- **Frame grid.**
  - Snapping a time to the Clip's frame grid uses `round(t·fps)/fps`.
  - A step of n frames is `(round(t·fps)+n)/fps`, clamped to 0 and the last frame (`duration − 1/fps`).
  - fps comes from the Preview Plan, and falls back to 30 until a plan arrives.
  - The Timeline's playhead rounding (1/30 s today) uses the same fps.
- **Edit Points.**
  - `editPoints(edits, played, hiddenTracks)` gives the sorted, de-duplicated times. They are the existing snap points (hook edges, item edges, Segment ends as played) plus 0 and the duration, minus items on hidden Tracks.
  - `nextEditPoint` and `previousEditPoint` take a time and give the nearest point strictly after or before it, past a tolerance of half a frame, or nothing at either end.
- **Zoom about the playhead.**
  - A function takes the zoom, the scroll, the Timeline's width, the playhead's time and a factor (×1.5 or ÷1.5, the buttons' step). It returns the new zoom and scroll, clamped to 1 and MAX_ZOOM.
  - The playhead keeps its screen position when visible, and is centred when it isn't.
- **Loop Region.** Pure helpers do the following:
  - normalise In/Out (swapped when crossed, clamped inside the Clip, with at least one frame between them);
  - give the start time for Play with Loop on (the playhead if inside, otherwise In);
  - give the wrap target at Out.

**`Playback` with two decks (ADR 0006).**
- **Registering videos.** It takes the two decks as registered video pairs instead of one attached master: `attachDeck(slot, master, follower)`. Media Segment videos and followers keep following through `follow` as today.
- **The live deck** is played, heard and read for time, as the single master is today.
- **The parked deck** is muted, paused and seeked to the park target:
  - while playing, the next Source Segment's `source_start` after the current Segment, or In when Loop is on and Out comes before the next join;
  - while paused, the Source Segment that starts at the next join after the playhead.

  It re-parks after every seek, edit of the Segments, Loop change and swap.
- **The swap.** At the handover (the current `HANDOVER_SECS` before a join, or at Out with Loop on), if the parked deck is at its target and has fired `seeked`, the decks swap:
  - the parked deck plays and unmutes;
  - the old live deck pauses, mutes and is hidden;
  - listeners are told the live deck changed.

  Otherwise it seeks the live deck, as today.
- **A join into a media Segment** works as today: the Source decks wait while the Segment's clock runs. A media Segment's video is parked at its `source_start` whenever its Segment is not the current one.
- **Loop.** The Loop Region and the Loop switch are set on `Playback`. Its tick wraps at Out instead of stopping at the end.
- **Rate.**
  - The rate is set on `Playback`. It applies the rate to both decks, and to every element that follows it: media Segments, Overlays and Music, through `follow` and the music follower.
  - It scales the clock of a media Segment.
- **Skim.**
  - `skim(time | null)` is used only while paused.
  - With a time, it seeks the parked deck there and makes it the shown deck, while `time` and the live deck stay put. Followers and the plan-drawn layers render at the skim time through a separate "shown time" that `usePlayback` subscribers can select.
  - With `null`, it shows the live deck again and re-parks.
  - Skim sound, when on, plays the parked deck unmuted for about 80 ms at each new position, throttled.
- **The panels follow the live deck.** The preview mounts both decks' panel videos. Each panel shows the live (or skimming) deck's video and hides the other. The Transition ghost is unchanged: it keeps its own pair and its own `Playback`.

**Advanced Edit UI.**
- **Focus.**
  - Pointer-down on a Timeline item no longer focuses it: the focus stays on the page, and keyboard focus by Tab is unaffected.
  - The global move-by-arrow becomes Alt+arrow, one frame, or ten with Shift. It keeps its undo group so that a run merges.
- **The ruler.** It draws the Loop Region band with draggable ends, and the Skim line.
- **The player bar.** It gains the loop button, the rate menu, the fullscreen button and, on a phone, ◀/▶ frame buttons.
- **The phone's toolbar** gains a Playback bottom sheet.
- **The top bar** gains the keyboard icon that opens the shortcuts sheet.
- **Fullscreen** uses the Fullscreen API on the stage's container. Where it isn't available for elements (iPhone Safari), a fixed, full-window layout is used instead.
  - Stage editing (drag, inline text) is disabled while full screen.
  - Controls auto-hide after about 2 s without pointer movement.
- **Remembered by the browser,** like the Magnetic timeline: Skim on/off and Skim sound on/off.
- **Kept in the editor only:** the Loop Region, Loop on/off and the rate.

**No backend, model, API or MCP change.** Nothing here is saved on the Candidate.

## Testing Decisions

A good test checks behaviour at a public boundary: what goes in and what comes back. It survives a refactor of the internals. Its expected values come from worked examples, not from recomputing them the way the code does. React components are not unit-tested: the repo has no component tests and Vitest runs in Node.

**Three seams, agreed with the owner.**

**Seam E: the pure Timeline-view module (existing, extended).**
- Prior art: the existing Timeline-view tests, which state a Clip and a Timeline width in a comment and assert the view that comes out.
- **Frame grid:**
  - stepping +1 and −10 at 25, 30 and 60 fps from a time between frames;
  - clamping at 0 and at the last frame;
  - End on a 10 s Clip at 30 fps is 9.9667.
- **Edit Points:**
  - a Clip of three Segments with a Text Layer, a Music Clip and the hook gives the sorted points with duplicates merged;
  - a hidden Text Track drops its edges;
  - next/previous from a point, from half a frame before a point, and at both ends (nothing).
- **Zoom about the playhead:**
  - the playhead visible keeps its screen x;
  - the playhead off-screen is centred;
  - clamping at 1× and 40×.
- **Loop Region:**
  - crossed marks swap;
  - marks past the Clip clamp;
  - Play's start inside and outside the Region;
  - the wrap target.

**Seam F: `Playback` driven by fake videos and a fake clock (new).**
- **The fakes.**
  - A fake video is an EventTarget with:
    - `currentTime`, `paused`, `muted`, `playbackRate`;
    - `play()` and `pause()` that fire `play` and `pause`;
    - a seek that fires `seeked` when the test says so.
  - `requestAnimationFrame` and `performance.now` are stubbed so that the test advances time.
- Prior art: the existing actions and undo-history tests' style of building small inputs from helpers.
- **Parking.** Two Source Segments (0–5 s from 100 s, 5–9 s from 200 s): once attached and paused at 1 s, the parked deck is at 200 s and the live deck at 101 s.
- **The swap:**
  - playing through 5 s swaps the decks;
  - the new live deck plays from 200 s, is unmuted and is the one read for time;
  - the old one is paused and muted, and re-parks for the join after (or nowhere when there is none).
- **Not ready.** When `seeked` hasn't fired on the parked deck by the handover, the live deck is seeked as today, and playback continues.
- **Media Segment.** The Source decks wait while the clock runs. The media video is parked at its `source_start` beforehand.
- **Loop:**
  - with In 2 s and Out 4 s, playing from 3 s wraps to 2 s at 4 s on the parked deck without stopping;
  - Play from 6 s starts at 2 s;
  - Loop off stops at the end as today.
- **Rate.** Setting 2× sets `playbackRate` on both decks. A media Segment's clock runs twice as fast.
- **Skim:**
  - skimming to 7 s while paused seeks the parked deck there, and `time` stays put;
  - skimming to `null` shows the live deck and re-parks;
  - skim is ignored while playing.
- **Seek and edits.** Seeking or changing the Segments re-parks the parked deck.

**Seam G: the keymap table (new, pure).**
- **Resolving:**
  - → gives `step-forward`, Shift+→ gives `step-forward-10`, and Alt+→ gives `move-forward`;
  - Shift+Z gives `fit`, Cmd+Z gives `undo`, and Cmd+L and Cmd+F give nothing;
  - `i` and `I` give `mark-in`;
  - with a field focused, nothing (except Escape, as today);
  - with a Tab-focused item, ←/→ give nothing (the item's own handler has them);
  - full screen, F and Escape give `fullscreen-exit`.
- **Uniqueness.** No two rows share keys in the same context.
- **The sheet.** Every row appears once in a group. Mac naming gives ⌥⇧→, and other platforms give Alt+Shift+→.

**Not automated: a browser walkthrough** at the end, on a desktop (Chrome and Safari) and on a phone (iPhone Safari).
- A Clip cut into five Source Segments plays through every join with no visible pause, Split and Blur Scenes included. Repeat at 2× and at 0.5×.
- A media Segment and a Transition between Source Segments look and sound as before.
- Loop a 2-second Region across a join, and watch it ten times through.
- Frame-step across a join, and check the frame shown against the rendered Clip at the same time.
- Skim along the whole Timeline with and without sound, then leave. The preview is back on the playhead at once.
- Go full screen on a desktop, and fill the window on an iPhone. Controls show and hide, and editing is off.
- On an iPhone: play a cut Clip for 2 minutes. Memory stays steady, and the page doesn't reload.
- The shortcuts sheet lists every key, and each one does what it says.

**The checks to run:** the frontend's typecheck, tests and build.

## Out of Scope

- **A J/K/L shuttle, and reverse playback.**
- **A Clip's speed** (per Segment, saved and rendered). That is the `speed` feature. The playback rate here is preview only.
- **Saving the Loop Region, or exporting just the Region.**
- **Skim on a phone, and Skim in the clip editor's Timeline.**
- **Navigation keys in the clip editor.** It gets seamless joins only, through the shared preview.
- **Rebinding keys.**
- **A single-deck fallback for phones.** It comes only if the iPhone walkthrough shows a memory problem.
- **Frame-accurate preview beyond what the browser decodes.** The preview shows the frame the browser gives at that time. The render is the truth.

## Further Notes

- **Choices made by default, not grilled.** Revisit them in review if they feel wrong:
  - L with no marks loops the whole Clip;
  - crossed In/Out swap;
  - ↑/↓ don't wrap;
  - frame step pauses playback;
  - Skim sound snippets are about 80 ms;
  - fullscreen controls hide after about 2 s;
  - the sheet's grouping;
  - Cmd/Ctrl+L and Cmd/Ctrl+F stay the browser's.
- **The Edit Points reuse the snap points.** They are the same edges items snap to, so the two can't disagree.
- **Amends ADR 0002** (its known gap at joins is closed). **Records ADR 0006** (two decks).
- **The Transition ghost stays separate.** During a Transition the page holds six Source videos. The iPhone walkthrough checks this.
- **Roadmap:** item 4, `navigation-playback`, in the Advanced Edit v2 roadmap.
