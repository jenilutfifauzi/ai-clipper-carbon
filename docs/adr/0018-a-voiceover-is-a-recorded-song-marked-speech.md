# 0018: A Voiceover is a recorded song marked Speech

Status: accepted
Date: 2026-10-20

Amends 0016 (what counts as speech for Ducking).

## Context

The `voiceover` feature brings Concat's voiceover (`panes/voiceover.rs`) to the Advanced Edit:
- record from the microphone at the playhead while the picture rolls;
- the timeline's sound held silent;
- a level meter;
- the take lands on the lowest free audio lane.

Today:
- **Voiceover recording is Out of Scope** in `.scratch/advanced-edit/spec.md`.
- **A Music Clip names a Media Library item** (a song, or a video's sound), or the Source's sound when Detached (ADR 0016).
- **Ducking hears only Words** (ADR 0016), and a recorded take has none.
- **A phone reaches the app over plain HTTP** (`http://<Mac's IP>:8000`). That isn't a secure context, so the browser gives it no microphone.
- **The Media Library takes MP3, M4A, WAV and AAC sound, up to 50 MB.** It doesn't take WebM, which is what Chrome's `MediaRecorder` makes.
- **`audio-effects` doesn't exist yet.**

## Decision

- **A Take is an ordinary Media Library item.**
  - It is uploaded as WAV, normalized like a song, and named "Voiceover <date time>".
  - It is laid as a Music Clip. No new item kind and no new Music Clip kind are added, and the item carries no "recorded" mark.
  - Undo removes the Music Clip and keeps the item. A Take is deleted from the Media tab, like an upload.
- **Music Clips gain `speech`.**
  - A Music Clip marked Speech that isn't Muted is speech for Ducking over its whole span on the Timeline, pauses included.
  - A Music Clip marked Speech is never Ducked. Switching Speech on clears `duck`, and two overlapping Takes don't duck each other.
  - A Take is marked Speech. Anything else starts unmarked, and an uploaded voice memo can be marked by hand.
  - Stored Music Clips read as not Speech.
- **Only a desktop browser in a secure context records** (`window.isSecureContext`, e.g. localhost). Elsewhere the button is hidden, with a hint to upload a voice memo instead. No HTTPS is set up for phones.
- **The browser records raw mono 48 kHz PCM through an AudioWorklet** and writes WAV.
  - Echo cancellation, noise suppression and automatic gain are off.
  - A Take stops itself at eight minutes, which keeps it under the 50 MB limit.
- **The landing is compensated automatically.**
  - The Take lands at the playhead plus the time from the moment the picture moved from the playhead to the moment its first sample was heard, both on the recorder's AudioContext clock.
  - The roll is timed by the first frame the picture is seen to move on, its time and the recorder's clock read together, not by the moment Play was asked.
  - The first sample was heard the microphone's input latency before it was captured: the track's reported `latency` (0 where the browser reports none) is taken off.
  - There is no manual offset.
- **The take flow:**
  - Recording starts from the mic button by the transport or Shift+R (R is Reverse). It starts after a three-second countdown with the playhead still. The microphone is already open during the countdown, so the meter shows.
  - The button is off while the playhead is at the Clip's end, where nothing would be heard.
  - Esc cancels the countdown, and so does pressing the button or Shift+R again. At the Clip's end, Shift+R tells the button's hint.
  - Recording stops from the same button, Space or Shift+R, or by itself at eight minutes. When the picture reaches the Clip's end it stops, but the Take records on, and the render cuts what runs past the end.
  - Hand edits are locked from the press until the Take has landed: while the microphone is being opened, the countdown, the recording and the upload. During the countdown and the recording the navigation shortcuts are locked too (they would move the playhead the Take is timed from). Edits from other tabs and MCP still arrive (edit-sync).
  - Leaving the page asks first while a Take counts down, records, uploads or waits, and cancels one that holds the microphone.
  - After a Take lands, it is Picked and the playhead goes back to its start.
- **Monitoring:**
  - The Clip's sound is silent while recording, unless "Hear the Clip" is on (for headphones).
  - A popover beside the button holds that switch, the choice of input and a test meter. The browser remembers them.
- **A failed upload never loses a Take.** It is kept in the tab (it waits), with "Try again", "Save WAV" and "Discard", and with a warning before the tab closes. Record is refused while one waits. A landing refused (a locked Music Track) waits the same, and Try again lands it without uploading it again.
- **No punch-in.** A new Take is a new Music Clip on a free lane. Takes already there aren't touched.
- **The MCP tools gain no new tool.** `speech` is an ordinary Music Clip field in `edit_candidate`, `merge_candidate_items` and `dry_run`. The dry run's sounds list `speech` and, for a ducked one, `speech_spans`; the plan's Audio events name them the same. Recording needs a browser.

## Considered options

- **Takes owned by the Candidate.** They would go with the Candidate, but the planner, renderer, Clipboard, deletion guard and MCP tools would each need a second kind of sound file.
- **A "recorded" origin on the Media item.** It would let the Media tab filter Takes, but nothing yet needs to tell a Take from an upload.
- **Speech from the Take's level (Peaks over a threshold).** The Music would come back up in pauses, but it needs a threshold to tune, and ADR 0016 already joins short gaps.
- **Transcribing Takes into Media Words.** This would give both captions and Word-exact Ducking. But ADR 0020 transcribes only media Segments, and captions from a voiceover belong to `captions-advanced`.
- **HTTPS for phones (mkcert / self-signed).** It needs a certificate set up on each phone, for a flow that a voice memo upload already covers.
- **`MediaRecorder` (WebM/Opus).** It doesn't time its first sample exactly, and the Media Library doesn't take WebM sound.
- **Punch-in that trims or mutes the earlier Take.** Concat has none, and Mute or Delete does the same by hand.
- **Applying "Enhance voice" to new Takes.** It is left to `audio-effects`, which doesn't exist yet.

## Consequences

- **Overturns "voiceover recording"** in the Advanced Edit spec's Out of Scope.
- **Every stored Candidate ducks as before.**
- **A Take shows in the Media tab like any song,** and stays there when undone. Cleaning up is by hand.
- **Captions from a Voiceover and "Enhance voice" on new Takes** are left to `captions-advanced` and `audio-effects`.
