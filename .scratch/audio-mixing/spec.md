# Audio mixing: fades, Detach, Muted, Ducking, WAV and Meters

Status: ready-for-agent
Created: 2026-10-18

## Problem Statement

The Advanced Edit can set how loud things are, but it can hardly mix them.

- **Segments can't fade.** A Segment's sound starts and stops at full level. Today only a Music Clip has fades, so a cut into or out of speech clicks or lands hard. The Clip's own sound can't be eased in at its start or out at its end.
- **Speech can't be moved apart from its picture.** A J-cut or an L-cut needs the sound of a Segment to start before its picture, or to run on after it. There is no way to lift a Segment's sound off onto its own item.
- **Nothing can be muted and kept.** Track mute is a listening aid in the editor: it is never saved and the render ignores it. Silencing an item means dragging its volume to 0, which loses the level it had, and a keyed volume stays audible anyway. A video Overlay is "muted" by having volume 0.
- **Music fights the speaker.** Music under a podcast clip has to be kept low throughout, or turned down by hand with volume Keyframes around every sentence. Auto-ducking is Out of Scope in `.scratch/advanced-edit/spec.md`.
- **The Source's sound has one flat level per Segment.** Media Segments have a Volume Line and volume Keyframes; Source Segments have neither (the keyframes spec put them off to this feature).
- **A piece of sound can't be taken out** as a file, and there is no way to see how loud the preview is.
- **Concat has these, except ducking:**
  - linear fades on any clip's sound (`Clip.fade_in` / `fade_out`);
  - `DetachAudio` / `ReattachAudio`, with an independent sound clip and a `detached_from` back-reference;
  - M to mute a clip;
  - "Save Audio As…" for a clip as it plays;
  - a stereo peak meter beside the timeline.

  Ducking is only an open request in Concat's notes.

## Solution

Every sound in the Advanced Edit can now be faded, muted, moved apart from its picture and saved as a file. Music turns itself down under speech, and a meter shows the preview's level. See `GLOSSARY.md` (Detach, Muted, Ducking, Meters) and ADR 0016.

**Fades on every Segment.**
- A Segment, of the Source or of a video, has a fade in and a fade out, from 0 to 10 s each. They are linear, as a Music Clip's are.
- They are set in the inspector, or by dragging a Fade Ramp on the Segment on the Timeline.
- When the fades together are longer than the Segment, both shrink in proportion, as a Music Clip's do.
- Under a Transition, the fades multiply the Segment's sound, and the crossfade stays as it is.
- A Freeze frame is silent and has no fades.

**Source Segments get a Volume Line and volume Keyframes.**
- A Source Segment's volume (0–2, under the Clip's own sound) is drawn and dragged as a media Segment's is.
- It can be keyed, with Auto-key, in the Keyframes pane. Its picture still can't be keyed: its Layouts frame it.

**Muted.**
- A Segment, a Music Clip or a video Overlay can be Muted. It is silent in the preview and in the render, and keeps its volume, Keyframes and fades for when it is unmuted.
- M toggles the Pick:
  - if any picked item with sound is heard, every one is Muted;
  - if all are Muted, every one is unmuted.

  Items without sound (Text Layers, Shapes, images, Freeze frames, the hook, the captions) are ignored. It is one step of undo.
- On the Timeline a Muted item:
  - draws its Waveform flat and dimmed;
  - hides its Volume Line and Fade Ramps;
  - shows a crossed speaker.
- A new video Overlay starts at volume 1 and Muted, so M (or the inspector's switch) gives it its sound at full level. Stored Overlays keep volume 0.
- Track mute is unchanged: still a listening aid, never saved.

**Detach and Reattach.**
- **Detach audio** is on a Segment's context menu and in its inspector. It moves the Segment's sound onto a new Music Clip and Mutes the Segment. It is one step of undo, and the Pick moves to the new Music Clips.
  - From a Source Segment, the Music Clip is of the Source's sound.
  - From a media Segment, the Music Clip is of the video's sound.
- **What the new Music Clip carries:**
  - the Segment's range, Speed, pitch and Reverse, volume, fades and volume Keyframes;
  - a back-reference to the Segment.

  It covers the Segment's whole sound on the Timeline (a Transition's overlap included) and lands on the first Music lane free there. It is not Ducked.
- **The Detached sound moves on its own.** Trimming, splitting, moving or deleting either side leaves the other alone. Reordering Segments leaves it where it was (ADR 0004). The Magnetic timeline ripples it as any Music Clip.
- **Detach is not offered** on a Freeze frame, on a Muted Segment, or on a video Segment without sound.
- **Reattach audio** is on the Segment and on any Music Clip Detached from it. It deletes every Music Clip Detached from that Segment and unmutes it. Nothing changed on the Detached sound is copied back. It is not offered once the Segment is gone.
- **Splitting:**
  - a Muted Segment's tail stays Muted;
  - a Detached Music Clip's two parts both point at the Segment.

**Music Clips get Speed, pitch and Reverse.**
- Any Music Clip, of a song, a video's sound or the Source, plays at a Speed (0.0625–16×), keeps its pitch unless "Change pitch with speed" is on, and may play in Reverse, as a video Overlay does.
- The inspector shows the Overlay's Speed fields. A Speed change is a trim at the Music Clip's end, and its Keyframes scale with it (ADR 0009).

**Ducking.**
- A Music Clip of a song or a video's sound has **Duck under speech**, with a depth from −1 to −30 dB (−12 by default).
- While speech is heard, the Music Clip is turned down by the depth:
  - it goes down over 0.25 s before the first Word;
  - it stays down through pauses shorter than 0.8 s;
  - it comes back up over 0.5 s after the last Word.
- Speech is the Words of every Source Segment that isn't Muted, and of every Music Clip of the Source's sound that isn't Muted, each where it plays on the Timeline. A Detached sound moved half a second later ducks the music half a second later.
- The Words are the Clip's own where they have been made, or the Transcript's otherwise.
- Music Clips added from now on duck by default, from the editor or from the agent. Stored Music Clips don't duck. A Music Clip of the Source's sound never ducks.
- The preview hears the same duck as the render. On the Timeline, the Waveform is drawn at the ducked level and the Volume Line has the ducked stretches shaded under it.
- Muting the Video Track in the preview doesn't change the duck: it is a listening aid.

**Save sound as WAV.**
- A Segment's, a Music Clip's or a video Overlay's context menu has **Save sound as WAV**.
- The backend renders that item's sound alone, as it is heard in the Clip: its range, Speed, pitch and Reverse, volume or Keyframes, fades, and `source_volume` for the Source.
- It leaves out Muted, the Track mute, Ducking and the final loudness pass. The result is 48 kHz stereo 16-bit PCM, which the browser downloads.
- Unsaved edits are used, as in the Preview Plan.

**Meters.**
- On the desktop, a slim column beside the bottom panel shows the preview's sound, left and right:
  - a peak level from −60 to 0 dB;
  - bars that rise at once and fall at 24 dB/s;
  - a peak-hold line that stays for 1.5 s;
  - the held peak in whole dB.
- A clip light turns red and stays red when a sample reaches 0 dBFS; a click clears it.
- It shows what the preview plays (Track mute included). Its tooltip says the render is normalized to −14 LUFS afterwards.

**The agent** reaches all of it through `edit_candidate`, `merge_candidate_items` and the dry run, with no new tool. The MCP instructions say how to Detach and Reattach with ordinary edits.

## User Stories

1. As an owner, I want to fade a Segment's sound in at its start, so that a cut into speech doesn't land hard.
2. As an owner, I want to fade a Segment's sound out at its end, so that the Clip's last word trails off instead of clicking.
3. As an owner, I want to fade a media Segment's sound, so that B-roll with sound eases in and out like music does.
4. As an owner, I want to drag a Fade Ramp on a Segment on the Timeline, so that I can set a fade by eye.
5. As an owner, I want to type a fade's length in the inspector, so that I can set it exactly.
6. As an owner, I want a Segment's fades to shrink in proportion when I trim it shorter than both, so that they never overlap.
7. As an owner, I want splitting a faded Segment to keep the fade in on the first part and the fade out on the second, so that the split doesn't add or lose fades.
8. As an owner, I want fades to work under a Transition as well, so that a fade and a crossfade can be combined.
9. As an owner, I want a Freeze frame to offer no fades, so that I am not shown controls that do nothing.
10. As an owner, I want a Volume Line on a Source Segment, so that I can set one sentence quieter than the rest by dragging.
11. As an owner, I want volume Keyframes on a Source Segment, so that I can dip the speaker under a sound effect for a moment.
12. As an owner, I want Auto-key to work on a Source Segment's Volume Line, so that it behaves as a media Segment's does.
13. As an owner, I want the Clip's own sound slider to keep scaling every Source Segment, keyed or not, so that one control still sets the speaker's overall level.
14. As an owner, I want to press M to mute the picked items, so that I can silence a clip without losing its volume.
15. As an owner, I want M again to unmute them, so that the clip comes back at the level it had.
16. As an owner, I want M on a mixed Pick to mute all of them if any is heard, so that one press gives silence.
17. As an owner, I want M to ignore Text Layers, Shapes, images and Freeze frames in the Pick, so that muting a group doesn't fail on items without sound.
18. As an owner, I want a Muted item to stay silent in the render, so that what I muted is what is published.
19. As an owner, I want a Muted keyed item to be silent too, so that Mute means silence whatever its Keyframes say.
20. As an owner, I want a Muted item to look muted on the Timeline (flat dimmed Waveform, crossed speaker, no Volume Line), so that I can see at a glance what is silent.
21. As an owner, I want a mute switch in the inspector and on the phone's toolbar, so that I can mute without a keyboard.
22. As an owner, I want a new video Overlay to start Muted at full volume, so that unmuting it gives its sound at once.
23. As an owner, I want Track mute to stay a listening aid, so that muting the Music Track to listen to the speaker doesn't change the Clip.
24. As an owner, I want to Detach a Source Segment's sound, so that I can start a sentence under the previous shot (a J-cut).
25. As an owner, I want to Detach a media Segment's sound, so that B-roll's sound can run on after its picture (an L-cut).
26. As an owner, I want the Detached sound to land exactly where it was heard, at the same Speed, volume, fades and Keyframes, so that Detaching changes nothing I hear.
27. As an owner, I want the Detached sound to move, trim and split on its own, so that I can slide it against the picture.
28. As an owner, I want the Segment to be Muted when I Detach, so that I don't hear the sound twice.
29. As an owner, I want Detach to cover a Transition's overlap too, so that no part of the sound goes missing.
30. As an owner, I want Reattach on the Segment or on its Detached sound, so that I can undo a Detach later without hunting through history.
31. As an owner, I want Reattach to remove every piece of a split Detached sound, so that none is left behind.
32. As an owner, I want Detach not offered on a Freeze frame, a Muted Segment or a silent video, so that it can't make an empty sound clip.
33. As an owner, I want a Detached sound of the Source to show the Source's Waveform, so that I can line it up by eye.
34. As an owner, I want the Clip's own sound slider to scale a Detached sound of the Source too, so that the speaker's level stays one control.
35. As an owner, I want to set a Music Clip's Speed, so that a song or a sound effect fits the length I need.
36. As an owner, I want a Music Clip's pitch kept at any Speed unless I switch it, so that a song doesn't turn into chipmunks.
37. As an owner, I want to play a Music Clip in Reverse, so that I can use a reversed whoosh or riser.
38. As an owner, I want music to be turned down under speech automatically, so that the speaker is always clear.
39. As an owner, I want to set how far a Music Clip ducks, so that a quiet bed and a loud song can be treated differently.
40. As an owner, I want to switch ducking off for a sound effect, so that a hit isn't swallowed by the speech over it.
41. As an owner, I want new Music Clips to duck by default, so that I don't have to remember to turn it on.
42. As an owner, I want stored Clips to render as before, so that adding this feature doesn't change Clips I have already approved.
43. As an owner, I want the music to stay down through short pauses, so that it doesn't pump between words.
44. As an owner, I want the music to start going down just before the speaker starts, so that the first word isn't masked.
45. As an owner, I want ducking to follow a Detached sound where I moved it, so that the music dips where the speech is actually heard.
46. As an owner, I want a Muted Segment's speech not to duck the music, so that a muted stretch lets the music come up.
47. As an owner, I want the preview to duck exactly as the render does, so that I can judge the mix before rendering.
48. As an owner, I want to see the ducked stretches on the Timeline, so that I know why the music gets quieter there.
49. As an owner, I want muting the Video Track in the preview to leave the duck as rendered, so that I hear the music as it will be.
50. As an owner, I want to save a Segment's sound as a WAV file, so that I can use it in another app.
51. As an owner, I want to save a Music Clip's or an Overlay's sound as a WAV, so that I can take out a sound I edited here.
52. As an owner, I want the WAV to be the item as heard (trim, Speed, volume, fades), so that it sounds as it does in the Clip.
53. As an owner, I want the WAV to include my unsaved edits, so that I don't have to save first.
54. As an owner, I want to see a meter of the preview's level, so that I can tell when the mix is too loud or clips.
55. As an owner, I want a clip light that stays on until I clear it, so that I don't miss a short overload.
56. As an owner, I want the meter's tooltip to say the render is normalized, so that I don't chase the preview's absolute level.
57. As an owner on a phone, I want mute, Detach, Reattach, fades and ducking in the bottom sheets, so that I can mix away from the desk.
58. As an owner, I want every one of these changes to be one step of undo and to merge by Revision, so that they behave like any other edit.
59. As an owner, I want copying a Detached sound of the Source to paste only into the same Job, so that it never plays another episode's Source.
60. As an agent, I want to set `muted`, fades, `duck`, Speed and volume Keyframes through the MCP tools, so that I can mix a Clip on the owner's behalf.
61. As an agent, I want to Detach by adding a Music Clip of the Source with `detached_from` and setting the Segment's `muted`, so that I need no extra tool.
62. As an agent, I want a new Music Clip I add without `duck` to duck at −12 dB, so that it behaves like the editor's.
63. As an agent, I want the dry run to list each sound's fades, Muted state and ducked spans, so that I can check the mix without rendering.
64. As an agent, I want a `detached_from` naming no Segment refused, so that I can't create a sound that Reattach will never find.

## Implementation Decisions

**Model (`candidates`):**
- **Segment** gains:
  - `fade_in` and `fade_out` (0–10 s, default 0; a Freeze frame refuses them);
  - `muted` (default false).

  A Source Segment now accepts the volume Keyframes (`SOUND_KEYS`) and still refuses picture Keyframes. A Freeze frame still refuses volume Keyframes.
- **Music Clip**:
  - `media` becomes optional; absent means the Source's sound, as for a Segment, and `offset` is then a time on the Source's timeline;
  - it gains `speed`, `pitch` and `reverse` (as on Overlay), `muted`, `duck` (a depth in dB from −30 to −1, or null for none; default null) and `detached_from` (a Segment id or null);
  - a Music Clip of the Source refuses `duck`;
  - its read of the Source or the item, `secs × speed` from `offset`, must lie within it.
- **Overlay** gains `muted` (default false). Its `volume` default stays 0 for stored Overlays. The editor makes new video Overlays at volume 1, Muted.
- **Every stored Candidate reads as unfaded, unmuted, unducked and at 1×**, and plans, renders and previews as before.

**API rules:**
- **A new song clip ducks by default.** When an edit (from the editor, `edit_candidate` or `merge_candidate_items`) adds a Music Clip of a Media Library item whose id isn't in the current Revision and doesn't mention `duck`, the server sets −12. "Mentioned" is read from the fields the request set, so an explicit null keeps it off.
- **`detached_from` must name a Segment the Candidate has** when it is added or changed. A Music Clip that already carried it in the current Revision keeps it after that Segment is gone.
- **Music Clips of the Source paste only into their own Job.** The Clipboard drops `detached_from` when pasting into another Candidate.

**Speech and Ducking (planner, a new pure module beside the gain function):**
- Speech spans in Timeline time come from:
  - each Source Segment that isn't Muted, with its Words placed as `_segment_words` places them (Speed, Transition cuts; none when reversed or held);
  - each Music Clip of the Source that isn't Muted, with the Words of its read range mapped through its offset and Speed (none when reversed).
- The Words are the Clip's own, or else the Transcript's. They are always gathered for ducking, even when captions are off and the plan has no caption words.
- Spans less than 0.8 s apart are joined.
- The ramp constants (0.25 s lead, 0.8 s bridge, 0.5 s release) live in the config, and the plan carries them.
- Each `AudioEvent` of a ducked Music Clip carries its depth and the joined speech spans that touch it. The gain at a time is volume or Keyframes × fades × duck. The duck factor is linear between 1 and the depth's gain, over the lead before a span and the release after it.
- **The gain function gains the duck,** in Python (`gain_at`) and TypeScript (`loudness.ts`). It is pinned by a new shared fixture of gain vectors: keyed and constant volumes, fades, overlapping spans, a span at the clip's edge, and a span longer than the clip.
- **Track mute doesn't reach the duck.** The editor's heard draft keeps muting Tracks by volume 0, never by `muted`, and speech counts by `muted` alone.

**Planner, other:**
- `SegmentPlan` gains `fade_in`, `fade_out` and `muted`. The fades are fitted to its Timeline length as a Music Clip's are.
- A Source Segment's `gain` carries its volume Keyframes.
- `AudioEvent` gains `muted`, `duck`, `source` (true for the Source's sound) and `detached_from` (for the editor).
- `audio_events` places Music Clips at their Speed and in Reverse, with the existing `overlay_time` mapping.
- `overlay_sound` passes the Overlay's `muted`.

**Renderer:**
- **Each Segment's sound chain** gains `afade` in and out after its volume (linear, ffmpeg's default curve).
- A Muted Segment becomes silence of its length, as a held one is.
- **The keyed path multiplies by `source_volume` for a Source Segment.** Today only media Segments are keyed, and that path skips it.
- **The fast `concat` path also requires** no fades, no Muted Segment and no keys.
- **A Music Clip of the Source reads the Source file** (or its Retimed copy when reversed) as its input.
- **Music Clips use the existing speed filters** (`atempo` stages, or `asetrate`) and Retimed copies. Reversed copies must also cover an audio-only Media Library item.
- **A Muted Music Clip or Overlay is left out of the mix.**
- **A ducked event's volume becomes a `volume=…:eval=frame` expression,** even with a constant volume. It is the product of the Keyframes' linear steps and the duck's ramps, so the render hears the planner's gain.
- **The two loudness passes run on the mix after ducking,** unchanged otherwise.

**Save sound as WAV:**
- **New endpoint.** It takes the Candidate's draft edits (as `/preview-plan` does) and an item id (Segment, Music Clip or Overlay), and returns `audio/wav`, 48 kHz stereo `pcm_s16le`, with a download filename made from the Candidate and the item.
- It plans the draft, takes that item's sound chain from the renderer's own builders with `muted` cleared and no duck, and doesn't run the loudness passes.
- It refuses a Freeze frame, an image, an item without sound, and an id the draft doesn't have.

**Preview:**
- **Every heard element goes through one master `GainNode`** that feeds the Meters' analysers and the destination.
- Muted items are set to gain 0.
- **Segment fades and ducks are part of the gain curve** each sound follows (`followCurve`), for the decks' Source sound as well as the per-event `<audio>` elements. Unkeyed but faded or ducked sounds follow a curve too.
- A Music Clip of the Source plays from the Source's proxy (or its Retimed copy) in a hidden element, as Overlay sounds do.

**Meters:**
- A channel splitter feeds two `AnalyserNode`s, read on each animation frame while playing.
- A **pure ballistics function** (peak in → bar level, held peak, clip latch out over time) is what is tested.
- **The column lives beside the bottom panel** (Timeline | Keyframes) on the desktop only. `workspace-layout` (#22) will absorb it.

**Editor actions (`actions`, pure, one undo step each):**
- `toggleMute(pick)`.
- `detach(segment ids)`: new Music Clips at the Segment's sound start on the Timeline, copying range, Speed, pitch, Reverse, volume, fades and volume Keyframes (same `at`, both measured from that start); then the Segments' `muted`.
- `reattach(segment id)`.
- `setFade` extends to Segments.
- Split keeps fade in on the head and fade out on the tail for Segments (as for Music Clips) and copies `muted` and `detached_from`.
- Rippling refits Segment fades.
- The Magnetic timeline treats Music Clips at a Speed by their Timeline length.
- M is bound in the keymap. The phone toolbar gains Mute.

**Timeline:**
- **Fade Ramps** on Segments, over the sound band of the Filmstrip.
- **A Volume Line** on Source Segments.
- **Ducked stretches** are shaded under a Music Clip's Volume Line, and its Waveform is scaled by the full gain, duck included.
- **The Muted look** applies to Segments, Music Clips and Overlays.

**Inspector:**
- A Segment shows its fades and a Muted switch, a Detach or Reattach button, and the Volume Line's keyed volume for Source Segments.
- A Music Clip shows:
  - Speed, pitch and Reverse (the Overlay's fields);
  - Muted;
  - Duck under speech with its depth (hidden for the Source's sound);
  - for a Detached sound, "Detached from Segment N" with Reattach.
- An Overlay's sound shows a Muted switch beside its volume.

**MCP:**
- The new fields pass through `edit_candidate` and `merge_candidate_items` as the model has them.
- The instructions explain:
  - Muted;
  - fades;
  - Ducking and its default;
  - Music Clips of the Source and their Speed;
  - Detach (add a Music Clip with `detached_from` and the Segment's range, then set the Segment's `muted`);
  - Reattach (remove those Music Clips and clear `muted`).
- The dry run lists, for every sound (not only keyed ones): its Timeline span, Muted, fades and ducked spans.
- The tool descriptions stay within the 69 KB budget.

**Revisions:** the new fields are item fields and merge item by item, as today.

## Testing Decisions

Good tests here check what is heard and what is refused. Examples: how loud a rendered tone is at a moment; whether a stretch is silent; where the music is ducked in the plan; the Candidate after an editor action; and what the API and MCP turn down. They don't check how a filter string is spelled.

- **Seam B, the planner (pytest):**
  - speech spans from a Clip's Words and from the Transcript's;
  - none from a Muted, reversed or held Segment;
  - a Detached sound's Words, at its new place and Speed;
  - spans joined across a short pause and not across a long one;
  - a ducked event's spans clipped to it;
  - a Music Clip of the Source never ducked;
  - Segment fades fitted to a short Segment;
  - a Muted Segment in the plan;
  - a Music Clip at 2× and in Reverse placed by `overlay_time`.

  Prior art: `test_planner.py`, `test_music.py`, `test_keyed_volume.py`.
- **The gain function over a new shared fixture (pytest and vitest):** volume or Keyframes × fades × duck at chosen times. Prior art: `ease_vectors.json` and `segment_times.json` with their paired tests.
- **Seam A, the HTTP API with real ffmpeg (short renders of a generated video with a tone, as `test_keyed_volume.py` does):**
  - a song is quieter by the depth while a Source Segment with Words plays, and back to full after the release;
  - a Muted Segment's stretch is silent, and so is a Muted keyed Music Clip;
  - a Segment's fade in rises from silence over its length;
  - a Detached sound of the Source moved 1 s later is heard 1 s later;
  - a Music Clip at 2× lasts half as long;
  - a stored Candidate without the new fields renders the same command as before (the unkeyed command fixture).
- **The WAV endpoint (Seam A):**
  - a Segment's WAV is PCM at 48 kHz, as long as its Timeline length, with its fade;
  - a Muted item's WAV is not silent;
  - unsaved draft edits are used;
  - a Freeze frame or an image is refused.
- **API and MCP refusals:** fades on a Freeze frame; `duck` on a Music Clip of the Source; a `detached_from` naming no Segment; a read past the Source's or the item's end at a Speed; picture Keyframes on a Source Segment. Also the −12 default for a new song clip without `duck`, and none for a stored one; and the dry run's sounds.
- **The editor (vitest, `actions` tests):**
  - M on a mixed Pick;
  - Detach copying everything and Muting, over a Transition;
  - Reattach after the Detached sound was split;
  - Split of a faded Segment and of a Detached sound;
  - ripple refitting Segment fades;
  - the Clipboard refusing a Music Clip of the Source in another Job.

  Prior art: `actions.test.ts`, `speed.test.ts`, `freezeFrame.test.ts`.
- **The Meters' ballistics (vitest, pure):** instant attack, the 24 dB/s fall, the 1.5 s hold, the clip latch and its clear.
- **Walkthrough** (`run` / ego-browser, desktop and phone):
  - fade a Segment;
  - Detach and slide the sound for a J-cut;
  - M;
  - add a song and hear and see it duck;
  - save a WAV;
  - watch the meter.

## Out of Scope

- **Ducking the sound of an Overlay or a media Segment.** Only Music Clips duck.
- **Speech from media Segments** (VAD or a transcription of a video). They have no Words, so they don't duck the music.
- **`sidechaincompress`** or any ducking from the signal.
- **Fade shapes other than linear.** Volume Keyframes shape anything else.
- **LUFS or RMS meters, per-Track meters, solo, pan and balance,** and per-Track or master faders.
- **Keyframes on `source_volume` itself.** It stays one number; Source Segments are keyed instead.
- **Linking a Detached sound to its Segment** while editing (moving or trimming together).
- **Detaching an Overlay's sound.** Its sound is already its own.
- **Saving Track mute,** or rendering without muted Tracks (track-controls).
- **The whole Clip's sound as WAV, or audio-only export.** These belong to `export-settings` (#19).
- **Adding a saved WAV to the Media Library.**
- **Audio effects** (denoise, voice, loudness per clip). These belong to `audio-effects` (#15).

## Further Notes

- **Overturns three Out of Scope lines** (ADR 0016):
  - auto-ducking, in `.scratch/advanced-edit/spec.md`;
  - Speed on Music Clips, in `.scratch/speed/spec.md`;
  - Keyframes on the Clip's own sound, in `.scratch/keyframes/spec.md`, for a Source Segment's volume.
- **It also closes the timeline-visuals Out of Scope line** "Fades on Segments, and a volume for each Source Segment".
- **Known discrepancy.** The preview's words (`PreviewPlan.words`) don't subtract Transition overlaps, but the plan's caption words do. Speech spans must use the planner's placement, not the preview words.
- **The roadmap's later audio features build on this:**
  - `voiceover` (#16) lands a take as a Music Clip, and its speech should then count as speech once it has Words;
  - `text-to-speech` (#17) does the same;
  - `audio-effects` (#15) adds per-clip chains before the volume and fades.
