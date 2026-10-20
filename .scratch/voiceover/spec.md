# Voiceover: record from the microphone at the playhead

Status: ready-for-agent
Created: 2026-10-20

## Problem Statement

The Advanced Edit can lay music and sound under a Clip, but the owner can't add their own voice to it.

- **Narration means leaving the app.** To add a line over a B-roll Segment, an intro or an outro, the owner records in another app, exports a file, uploads it to the Media Library, and then drags it until it lines up with the picture. Each retake repeats the whole round trip.
- **Lining up by hand is slow and imprecise.** A recording made away from the picture doesn't follow it, so the words land late or early and get nudged frame by frame.
- **Music fights the narration.** Ducking hears only Words (ADR 0016). A recorded voice has none, so a song under it stays at full level unless it is keyed down by hand.
- **Voiceover recording is Out of Scope** in `.scratch/advanced-edit/spec.md`.
- **Concat has it** (`panes/voiceover.rs`):
  - a button starts a take at the playhead and rolls the picture;
  - the timeline's own sound is held silent so the speakers don't bleed into the microphone;
  - a meter shows the level;
  - the take is added to the project's media and laid on the lowest free audio lane, where the first sound was heard against the picture.

## Solution

The owner records a Voiceover straight onto the Timeline while the picture plays. Each Take becomes a Music Clip marked Speech, so the Music ducks under it. See `GLOSSARY.md` (Voiceover, Take, Speech, Ducking) and ADR 0018.

**Recording a Take.**
- A mic button sits by the transport, beside Play, with Shift+R as its key (R is Reverse).
- Pressing it starts a three-second countdown with the playhead still. Esc cancels it, and so does pressing the button or Shift+R again.
  - The browser asks for the microphone the first time.
  - The microphone opens at the start of the countdown, so the meter already moves.
- After the countdown the picture rolls from the playhead and the Take records.
- While recording:
  - The Clip's sound is silent, unless "Hear the Clip" is on (for headphones).
  - A level meter beside the button shows the microphone.
  - The button reads Stop.
- The same button, Space or Shift+R stops the Take. So does reaching eight minutes, with a notice.
- If the picture reaches the Clip's end, it stops there and the Take records on. The render cuts whatever runs past the end.
- The button is off while the playhead is at the Clip's end, with a hint to move it into the Clip. Shift+R there tells the same hint in the editor's notice.

**Where it lands.**
- The Take is uploaded to the Media Library as an audio item named "Voiceover <date time>", normalized like any song.
- It is laid as a new Music Clip:
  - on the lowest free lane of the Music Track;
  - at the playhead plus the time from the moment the picture moved from the playhead to the moment the Take's first sample was heard (its capture time less the microphone's input latency, where the browser reports it);
  - marked Speech, not Ducked.
- It is one step of undo. Undoing removes the Music Clip but keeps the Media Library item, which is deleted from the Media tab like any upload.
- After it lands, the new Music Clip is Picked and the playhead goes back to its start, so Space plays it back.
- Takes already on the Timeline are never touched (no punch-in). Overlapping Takes both play, and the owner Mutes, trims or deletes the one they don't want.

**Speech.**
- A Music Clip has a Speech switch in its inspector.
  - On for a Take.
  - Off for everything else, and for every stored Music Clip.
  - It can be switched on for an uploaded voice memo, for example.
- A Music Clip marked Speech that isn't Muted is speech for Ducking over its whole span on the Timeline, pauses included. The other ducked Music turns down under it, as under the Source's Words.
- A Music Clip marked Speech is never Ducked. Switching Speech on clears its duck, and the inspector hides the duck control while Speech is on.
- A Music Clip of the Source's sound has no Speech switch: its Words already count.

**Settings.**
- A chevron beside the mic button opens a popover with:
  - the choice of microphone;
  - "Hear the Clip (headphones)";
  - a test meter.
- The browser remembers these settings.
- The microphone is recorded raw, with the browser's echo cancellation, noise suppression and automatic gain off.

**Locked while recording.**
- From the press until the Take has landed (while the microphone is being opened, the countdown, the recording and the upload), hand edits are locked: the Timeline, the inspector and the editing shortcuts.
- During the countdown and the recording, the navigation shortcuts are locked too: they would move the playhead the Take is timed from.
- Edits from another tab or from MCP still arrive (edit-sync), and the Take lands where it was recorded in Timeline time.
- Leaving the page or closing the tab asks first while the countdown runs, the Take records or uploads, or a Take waits. Leaving cancels a Take that holds the microphone; one uploading or waiting is kept.

**When something fails.**
- **The microphone is refused or missing.** The owner is told why, and nothing changes.
- **The upload or the normalization fails.** The Take is kept in the tab (it waits), with "Try again", "Save WAV" and "Discard". The tab warns before it closes while a Take is waiting. Record is refused while one waits, with a notice to settle it first.
- **The landing is refused** (the Music Track locked, say). The Take waits the same, its item already uploaded: "Try again" lands it without uploading it again.

**On a phone.**
- A phone reaches the app over plain HTTP, where the browser gives no microphone. Wherever the page isn't a secure context, the mic button is hidden.
- In its place, a hint suggests recording a voice memo and uploading it. A memo can be marked Speech by hand.

## User Stories

1. As a creator, I want to record my voice from the playhead while the picture plays, so that my narration follows what is on screen.
2. As a creator, I want a three-second countdown before recording starts, so that I can get ready to speak.
3. As a creator, I want to cancel the countdown with Esc, so that a false start leaves nothing behind.
4. As a creator, I want the microphone's level shown during the countdown, so that I can check I'm heard before the Take starts.
5. As a creator, I want a level meter while recording, so that I can see if I'm too quiet or clipping.
6. As a creator, I want the Clip's sound silent while I record, so that my speakers don't bleed into the microphone.
7. As a creator with headphones, I want to hear the Clip while I record, so that I can time my words to its sound.
8. As a creator, I want my "Hear the Clip" choice remembered, so that I don't set it every time.
9. As a creator, I want to choose which microphone records, so that I can use my USB mic instead of the laptop's.
10. As a creator, I want my microphone choice remembered, so that the right mic is used next time.
11. As a creator, I want to stop with the same button, Space or Shift+R, so that stopping is as easy as starting.
12. As a creator, I want Shift+R to start a Take, so that I can record without reaching for the mouse.
13. As a creator, I want the Take laid exactly where I spoke against the picture, so that I don't nudge it into place.
14. As a creator, I want the Take on a free lane of the Music Track, so that it never covers my other sounds.
15. As a creator, I want the new Take picked, with the playhead back at its start, so that Space plays it back at once.
16. As a creator, I want to undo a Take with Cmd/Ctrl+Z and record again, so that retakes are quick.
17. As a creator, I want an undone Take kept in the Media Library, so that a good Take undone by mistake can come back.
18. As a creator, I want to delete Takes I don't want from the Media tab, so that the library stays tidy.
19. As a creator, I want Takes named by their date and time, so that I can tell them apart in the Media tab.
20. As a creator, I want my song to duck under my narration, so that the words are clear without keying the volume by hand.
21. As a creator, I want my narration never ducked under the podcast's speech, so that it never dips by itself.
22. As a creator, I want two overlapping Takes not to duck each other, so that both stay at the level I set.
23. As a creator, I want a Muted Take not to duck the Music, so that muting a Take restores the song.
24. As a creator, I want to mark an uploaded voice memo as Speech, so that it ducks the Music like a Take.
25. As a creator, I want the duck control hidden on a Speech Music Clip, so that I can't set a duck that never applies.
26. As a creator, I want a Take to be an ordinary Music Clip, so that I can trim, fade, move, mute, key the volume of, copy and paste it like any other.
27. As a creator, I want recording to keep going past the Clip's end, so that a sentence I'm finishing isn't cut off mid-take.
28. As a creator, I want the mic button off at the Clip's end, so that I don't record a Take that would never be heard.
29. As a creator, I want a Take to stop itself at eight minutes, so that it never fails the upload limit.
30. As a creator, I want hand edits locked while I record, so that a stray key doesn't change the Timeline under the Take.
31. As a creator, I want edits from my other tab or the agent to still arrive while I record, so that nothing is lost or conflicts.
32. As a creator, I want to be asked before leaving the page mid-take, so that I don't lose a Take by accident.
33. As a creator, I want a failed upload to keep my Take, with Try again and Save WAV, so that a good performance is never lost.
34. As a creator, I want to be told clearly when the microphone is refused or missing, so that I know how to fix it.
35. As a creator on my phone, I want to be told why I can't record and how to add a voice memo instead, so that I'm not left looking for a missing button.
36. As a creator, I want the Take recorded raw, without the browser's processing, so that my voice sounds natural and steady.
37. As a creator, I want a Take's Waveform drawn on the Timeline like any Music Clip's, so that I can see where I spoke.
38. As a creator, I want the Music ducked under my Take in the preview exactly as in the render, so that what I hear is what I get.
39. As an agent (MCP), I want to read and set a Music Clip's Speech, so that I can mark narration and plan Ducking around it.
40. As an agent (MCP), I want a duck on a Speech Music Clip refused, so that I don't plan a duck that can't apply.
41. As an agent (MCP), I want `dry_run` to show the speech a Take makes and where the Music ducks under it, so that I can check the mix before rendering.
42. As a maintainer, I want every stored Candidate to plan, render and preview as before, so that the change is safe for existing edits.

## Implementation Decisions

**Model: `MusicClip.speech`.**
- A bool, false by default; stored Music Clips read as false.
- Like `muted` and `duck`, it is merged as one field of the Music Clip (ADR 0003).
- A Music Clip of the Source's sound (no `media`) refuses `speech`, as it refuses `duck`. Its Words are its speech.
- A Music Clip with `speech` refuses a `duck`, as the Source's does. The edit API returns the same kind of error.
- The new-song default of ADR 0016 (−12 dB for a Music Clip new to the Revision with no `duck` set) doesn't apply to a Music Clip with `speech`.

**Planner: speech from Speech Music Clips.**
- The speech the planner gathers for Ducking (today the heard Words of Source Segments and of Music Clips of the Source) also takes, for each Music Clip with `speech` that isn't Muted, one span from where it starts to where it ends on the Timeline.
- These spans are cut to the Clip's length, like other sounds. They then go through the same joining (`speech_spans`) and reach (`touching`, `ducked_stretches`) as Words.
- A Speech Music Clip has no `duck`, so it carries no speech spans of its own: it is never ducked, and never by itself.
- The plan's Audio events carry the spans as `speech_spans` (named `speech` before), and `speech` marks the event of a Music Clip marked Speech, as on the Music Clip. The render's volume expression and the preview's gain curve read the spans as before, so preview and render stay equal (ADR 0001); the shared gain cases (`tests/fixtures/gain_vectors.json`) name them `speech_spans` too.
- Track mute in the editor still doesn't change Ducking.

**Media Library.**
- No change to the item model: a Take is an audio item uploaded as WAV, which the Media Library already takes. It is normalized to AAC with its Peaks.
- The Take's name comes from the uploaded file's name ("Voiceover YYYY-MM-DD HH.MM.SS").
- The 50 MB audio limit stays. Eight minutes of mono 48 kHz 16-bit WAV is about 46 MB.

**MCP.**
- No new tool. `speech` is a Music Clip field in `edit_candidate`, `merge_candidate_items` and `dry_run`, described in their schemas next to `duck` and `muted`.
- The dry run's sounds now list `speech` (true for a Music Clip marked Speech) and, for a ducked sound, its `speech_spans` and ducked stretches, which include the Takes'.
- Recording needs a browser and isn't offered to the agent.

**Frontend: a take recorder module** (deep, no React):
- Opens the chosen input with `echoCancellation`, `noiseSuppression` and `autoGainControl` off. Captures mono PCM at 48 kHz through an AudioWorklet on its own AudioContext.
- Reports the level for the meter, reusing the Meters' ballistics.
- On stop, returns the WAV bytes, the length and the AudioContext time of the first captured sample.
- Tells the microphone's input latency: the track's `getSettings().latency` where the browser reports it, else 0. The AudioContext's `baseLatency` is the output's, and isn't added.
- Its pure parts are kept apart and tested on their own:
  - the WAV encoding;
  - the landing (`playhead + (firstSampleTime − inputLatency − rolledTime)`, never before 0);
  - the eight-minute cap.

**Frontend: the take flow** (a small state machine in the Advanced Edit):
- States: idle → opening (the microphone asked for) → countdown → recording → uploading → landed, or back to idle on cancel or error.
- From uploading it can go to waiting (the upload or the landing failed), which offers Try again, Save WAV and Discard. Record is refused while one waits.
- Pressing the mic button or Shift+R during the opening or the countdown cancels it, as Esc does.
- On roll it:
  - notes the recorder's AudioContext time, then times the roll again on the first frame the picture is seen to move: the picture's time and the recorder's clock are read together there, and the moment it left the playhead is reckoned back from them on the recorder's clock (a video can take a moment to start, and the picture runs on the page's clock);
  - starts playback from the playhead, ignoring the Loop;
  - holds the master bus silent unless "Hear the Clip" is on.
- On landed it adds the Music Clip with one edit:
  - `media` (the new item), `start` (the landing), `secs` (the Take's length);
  - `speech: true`, no `duck`;
  - laid by the existing auto-lane.
  It then Picks the Music Clip and puts the playhead at its start.
- From the press until the Take has landed (opening, countdown, recording, uploading), the editor's hand-edit actions and editing shortcuts are refused; during the countdown and the recording, so are the navigation shortcuts. Not while a Take waits: the Music Track may need unlocking.
- `beforeunload` asks before leaving during the countdown, the recording, the upload and while a Take waits; `pagehide` cancels a Take that holds the microphone (opening, countdown, recording).
- Remote edits apply as usual.
- The recording settings are off, and no test meter opens, only while a Take holds the microphone; while one uploads or waits, they work.
- The mic button and its popover are rendered only when `window.isSecureContext` and `navigator.mediaDevices` exist. Elsewhere the hint is shown.
- A new keymap entry: `record`, Shift+R, desktop only, group playback.
- The popover's settings (input device id, "Hear the Clip") are in localStorage, with every read and write wrapped in try/catch, like the workspace layout.

**Inspector.**
- A Music Clip of a media item shows a Speech switch.
- While Speech is on, the duck control is hidden. Switching Speech on sends `speech: true` and clears `duck` in the same edit.

**Glossary and ADR.**
- Speech, Voiceover and Take are new terms. Music Clip and Ducking are amended.
- ADR 0018 records the decisions and amends ADR 0016's definition of speech.
- The Advanced Edit spec's Out of Scope line for voiceover recording now points to ADR 0018.

## Testing Decisions

Good tests check what the owner, the agent or the render sees through a public seam, never the module's internals. Following the user's standing instruction, only the feature's own backend test files are run, never the whole suite.

**Seam B, the planner, pure** (new `test_voiceover.py`; prior art `test_ducking.py`):
- A Speech Music Clip's whole span is speech, and a song under it carries the span and its ducked stretch.
- A Muted Speech Music Clip makes no speech.
- Spans from a Take and from Source Words are joined across a short gap, as Words are.
- A Speech Music Clip carries no speech spans of its own (it is never ducked), and two overlapping Takes don't duck each other.
- A Speech span running past the Clip's end is cut to it.
- A stored Candidate without `speech` plans exactly as before.

**Seam A, HTTP, MCP and the real ffmpeg** (same file; prior art `test_ducking.py`, `test_music.py`, `test_media_library.py`, `test_mcp.py`):
- A mono WAV upload becomes an audio item with Peaks, named from its file.
- An edit adding a Music Clip with `speech: true` and no `duck` stores no duck (no −12 dB default).
- An edit setting `duck` on a Speech Music Clip is refused. So is `speech` on a Music Clip of the Source.
- The agent sets `speech` through `edit_candidate` and `merge_candidate_items`. The `dry_run` lists the song's speech spans from the Take.
- A rendered Clip with a tone as the song and a tone as the Take: the song is 12 dB quieter in the middle of the Take, and back to full after its release (the `tone_level` approach of `test_ducking.py`).

**Frontend, vitest:**
- The take recorder's pure parts (new `voiceover.test.ts`; prior art `ballistics.test.ts`, `ducking.test.ts`):
  - the WAV header and samples round-trip;
  - the landing from a playhead, a roll time and a first-sample time;
  - the cap stops at eight minutes.
- The take flow as a component (new `voiceoverFlow.test.tsx`; prior art `meters.test.tsx`, `mute.test.ts`, `phoneMixing.test.tsx`), with a fake `getUserMedia`, AudioContext and upload:
  - the countdown, then roll;
  - Esc cancels the countdown;
  - Stop by button, Space and Shift+R;
  - the edit that lands the Take (speech, no duck, start, Pick, playhead);
  - hand edits are refused while recording;
  - the button is off at the Clip's end;
  - it is hidden outside a secure context, with the hint;
  - a refused microphone;
  - a failed upload offering Try again and Save WAV;
  - "Hear the Clip" keeping the bus audible.
- The inspector: the Speech switch hides the duck control and clears `duck`.

## Out of Scope

- **Recording on a phone,** and serving the app over HTTPS so a phone gets a microphone. A voice memo upload covers it.
- **Punch-in:** trimming or muting the earlier Take where a new one overlaps.
- **A manual latency offset.**
- **"Enhance voice" or any cleanup applied to Takes.** That is left to `audio-effects` (#15), which may choose a default for Speech Music Clips.
- **Captions or Words from a Take** (transcribing audio items). That is left to `captions-advanced`. ADR 0020 transcribes only media Segments.
- **Speech detected from the Take's level.** The whole span counts, pauses included.
- **A "recorded" mark on Media Library items,** or a separate list of Takes.
- **Takes owned by the Candidate.**
- **Recording through MCP.**
- **Stereo or multi-channel Takes,** and Takes longer than eight minutes.

## Further Notes

- **Concat's landing** (`record::landing`) is the model for the latency compensation. It is the playhead plus the delay between the picture rolling and the microphone's first sample. Here both times are read on the recorder's AudioContext clock, so the browser's start-up latency drops out; the roll is timed by the first frame the picture moves on, and the input latency the browser reports is taken off.
- **Chrome's `MediaRecorder` was rejected** because its WebM/Opus isn't accepted by the Media Library and doesn't timestamp its first sample. The AudioWorklet's WAV is accepted as it is.
- **`audio-effects` is being designed in parallel.** Its spec should say whether a Speech Music Clip gets "Enhance voice" by default.
- **The meter during recording reads the microphone, not the preview's master bus.** The Meters pane keeps showing the preview's sound (silent while recording, unless "Hear the Clip" is on).
