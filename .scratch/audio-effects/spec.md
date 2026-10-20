# Audio effects: cleanup switches and effect presets per item

Status: ready-for-agent
Created: 2026-10-20

## Problem Statement

The Advanced Edit can set how loud each sound is, fade it, duck it and mute it. It can't change how anything sounds.

- **Noisy speech can't be cleaned.** A podcast guest on a laptop mic brings hiss, hum and room tone into every Clip. The owner has to fix the episode in another app first, or live with it.
- **Voices can't be brought forward.** There is no high-pass, compression or de-essing. A thin or uneven voice stays thin and uneven under the Music.
- **Sounds come in at very different levels.** A song from the Media Library, a media Segment from a phone and the Source don't match. The final loudness pass levels the whole Clip, never one item against another, so the owner rides volumes by ear.
- **There are no creative sound effects.** Short-form clips often use a telephone or radio voice for a quote, a deep or chipmunk voice for a joke, an echo on a punchline, or a lo-fi or underwater song. None of these can be made.
- **Concat has all of this:**
  - three cleanup switches: Normalize loudness, Reduce noise and Enhance voice;
  - 22 presets in Voice, Tone and Space shelves;
  - each clip's sound has an ordered, stackable chain of them, each with its own knobs.
- **"Filters and effects" are Out of Scope in `.scratch/advanced-edit/spec.md`.** Filters were overturned by ADR 0013; effects stay out.

## Solution

Every sounding item in the Advanced Edit gets a stack of **Audio Effects**: Segments (of the Source or a media item), Music Clips (songs, Detached sound, and later voiceover and TTS) and video Overlays.

- **The Inspector has an Audio Effects section,** under the item's volume and fades:
  - **Three switches:** Reduce noise, Enhance voice and Normalize loudness. Each shows its slider when on.
  - **The stack:** one row per effect, with its main slider, its other settings behind "More", an on/off switch, move up / move down, and remove.
  - **An "Add effect" button.** It opens the effect library with Voice, Tone and Space groups and a search.
  - On a phone, the same controls are an "Audio effects" bottom sheet.
- **Order matters, and the owner sets it.**
  - Reduce noise and Enhance voice go to the top when switched on: clean first, colour after.
  - Normalize loudness goes to the bottom, so it measures the result.
  - The presets can be moved afterwards; the Clean three keep their places in the editor (an agent may still order them).
- **The render applies the stack exactly.** It runs after the item's Speed and Reverse and before its volume, Keyframes, Ducking and fades. An echo's tail is cut at the item's end, so items keep their length. The final loudness pass of the Export Settings still runs on the whole mix.
- **The preview plays what the render will.**
  - When an item's effects change, the server makes its **Effected copy**: the item's sound with its Speed, Reverse and Audio Effects, through the same ffmpeg chain.
  - The preview plays that copy, with the volume, fades and Ducking applied live as today.
  - For the few seconds before it is ready, the item plays without its effects, and the Inspector says "Preparing effects…".
- **Several items can be changed at once.** With several sounding items picked, the switches and "Add effect" apply to all of them as one step of undo. The stack itself is shown only when it is the same on all of them.
- **Effects travel with the sound.** Detach copies them onto the new Music Clip. Split, copy, paste and the Clipboard keep them. Saving an item's sound as WAV includes them.
- **The agent can do all of it.** The MCP tools list the effects catalogue, set the stacks through `edit_candidate` and `merge_candidate_items`, and see them in `dry_run`.

## User Stories

1. As a clip editor, I want to switch on Reduce noise for a Source Segment, so that the hiss of the guest's mic is gone in the Clip.
2. As a clip editor, I want a strength slider on Reduce noise, so that I can trade noise against a watery voice.
3. As a clip editor, I want to switch on Enhance voice, so that the speaker sounds clearer and steadier under the Music.
4. As a clip editor, I want an amount slider on Enhance voice, so that I can keep it subtle on a good mic.
5. As a clip editor, I want to switch on Normalize loudness for a song, so that it sits at a predictable level before I set its volume.
6. As a clip editor, I want to choose the Normalize target (−30 to −12 LUFS, −23 by default), so that different items can be levelled to one another.
7. As a clip editor, I want Normalize to measure and apply a steady gain, so that it never pumps or breathes.
8. As a clip editor, I want Reduce noise and Enhance voice to land at the top of the stack when I switch them on, so that the sound is cleaned before any preset colours it.
9. As a clip editor, I want Normalize loudness to land at the bottom of the stack when I switch it on, so that it levels the treated sound.
10. As a clip editor, I want to add a preset from a library grouped as Voice, Tone and Space, so that I can find it by what it does.
11. As a clip editor, I want to search the library by name, so that I can find "telephone" without browsing.
12. As a clip editor, I want Voice presets (Pitch, Sweet, Deep, Chipmunk, Robot, Megaphone, Whisper), so that I can change who a voice sounds like.
13. As a clip editor, I want Tone presets (Bass, Treble, Bright, Telephone, Radio, Vinyl, Lo-fi, Distorted), so that I can colour a sound.
14. As a clip editor, I want Space presets (Echo, Room, Hall, Plate, Cathedral, Stadium, Underwater), so that I can place a sound somewhere.
15. As a clip editor, I want Pitch to shift by semitones without changing the item's length, so that the timing of the edit holds.
16. As a clip editor, I want each effect's main setting as one slider in its row, so that the common change is one drag.
17. As a clip editor, I want an effect's other settings (such as Echo's delay and decay) behind "More", so that the row stays simple.
18. As a clip editor, I want to stack several effects on one item, so that I can make a deep voice on a radio.
19. As a clip editor, I want to move an effect up or down the stack, so that I can hear the difference order makes.
20. As a clip editor, I want to switch an effect off without removing it, so that I can compare with and without it.
21. As a clip editor, I want to remove an effect, so that the stack only holds what I use.
22. As a clip editor, I want every effect change to be one step of undo, so that I can step back through my tries.
23. As a clip editor, I want effects on a media Segment, a Music Clip and a video Overlay's sound as well as a Source Segment, so that every sound can be treated.
24. As a clip editor, I want effects on a Detached sound, so that I can treat a J-cut's speech on its own.
25. As a clip editor, I want Detach to copy the Segment's effects onto its Music Clip, so that the detached sound sounds as it did.
26. As a clip editor, I want the Segment to keep its effects after a Detach, so that Reattach brings it back as it was.
27. As a clip editor, I want splitting an item to keep its effects on both parts, so that the cut is seamless.
28. As a clip editor, I want copy and paste to bring an item's effects, so that I can reuse a treatment.
29. As a clip editor, I want to pick several items and switch Reduce noise on for all of them, so that I clean a whole interview at once.
30. As a clip editor, I want "Add effect" on several picked items to add it to each, so that a series of quotes all get the telephone voice.
31. As a clip editor, I want the stack shown only when the picked items share it, and otherwise "Mixed" with "Remove all effects", so that I never edit what I can't see.
32. As a clip editor, I want the preview to sound exactly like the render, so that I can trust what I hear before exporting.
33. As a clip editor, I want to hear the item without effects while its Effected copy is being made, with "Preparing effects…" in the Inspector, so that playback never stops and I know why it sounds plain.
34. As a clip editor, I want volume, fades and Ducking to stay instant while effects take a moment, so that mixing stays fluid.
35. As a clip editor, I want an echo cut at the item's end, so that nothing is heard where the Timeline shows nothing.
36. As a clip editor, I want to fade an item out to soften a cut-off echo, so that I control how a tail ends.
37. As a clip editor, I want effects applied after Speed and Reverse, so that an echo's delay is the same at any Speed.
38. As a clip editor, I want the Meters to follow the effected sound, so that I see the level I'll get.
39. As a clip editor, I want the Clip's final loudness target still to apply on top of the item effects, so that every Clip comes out at −14 or −16 LUFS as before.
40. As a clip editor, I want Ducking unchanged by effects, so that Music still goes down under speech even when that speech is treated.
41. As a clip editor, I want a Muted item's effects kept, so that unmuting it brings back the same sound.
42. As a clip editor, I want a Saved sound WAV to include the item's effects, so that the file sounds as it does in the Clip.
43. As a clip editor on a phone, I want an "Audio effects" bottom sheet with the same switches, stack and library, so that I can treat sound away from my desk.
44. As a clip editor, I want a Transition's outgoing Segment heard with its effects through the overlap, so that the join doesn't jump.
45. As a clip editor, I want a Candidate saved before this feature to render and preview exactly as before, so that nothing changes under me.
46. As a clip editor, I want a built-in effect never to change how it sounds in a later version, so that an old Clip renders the same again.
47. As the owner, I want Effected copies kept in the Job's folder and removed once nothing uses them, so that disk space isn't wasted.
48. As an agent using the MCP tools, I want to list the audio effects with their groups, settings, ranges and defaults, so that I can choose valid ones.
49. As an agent, I want to set an item's stack through `edit_candidate` and `merge_candidate_items`, so that I can clean or style sound with the same tools as anything else.
50. As an agent, I want a setting I leave out to take its default, so that I can add "Echo" without knowing every knob.
51. As an agent, I want an unknown effect id, an unknown setting or a value out of range refused with a clear message, so that I fix my call rather than produce a silent mistake.
52. As an agent, I want `dry_run` to show each item's stack, so that I can check what I did.
53. As an agent, I want the server instructions to say where effects sit (after Speed, before volume and fades) and what Normalize does, so that I can reason about the result.
54. As another editor (a second tab or the agent), I want stacks merged item by item on a Revision conflict, so that a concurrent effect change isn't silently lost.

## Implementation Decisions

- **ADR 0017** records the core decisions: an ordered stack per item; its place in the chain; Effected copies in the preview; `afftdn`; the Python registry; Normalize measured, then linear. This feature overturns "effects stay out" in `.scratch/advanced-edit/spec.md` for sound only.
- **Model:**
  - Segment, MusicClip and Overlay gain `audio_effects`: an ordered list of applied effects, empty by default. An absent list reads as empty, so stored Candidates are unchanged.
  - An applied effect is:
    - `id`: a catalogue id;
    - `params`: a map from setting key to number, holding only the settings that differ from the default, or all of them;
    - `enabled`: a boolean, true by default.
  - Settings are constant over the item. They have no Keyframes.
  - A Freeze frame and an image Overlay have no sound. A stack sent for them is refused, as fades on a Freeze frame are.
- **Catalogue module (new, deep):**
  - A registry of audio effects, each with:
    - an id, name, group (Clean, Voice, Tone or Space) and order;
    - its settings: key, label, min, max, default, step and unit, with one marked as the intensity shown in the stack row;
    - a pure function from settings to an ffmpeg audio filter fragment.
  - Its interface:
    - list the catalogue, as plain data;
    - validate an applied effect: an unknown id, an unknown key or an out-of-range value is an error, and a missing key takes the default;
    - build the chain of a stack, joining the enabled entries in order.
  - It ships the 25 Concat effects, matched for behaviour, not copied:
    - Clean: Normalize loudness, Reduce noise, Enhance voice;
    - Voice: Pitch, Sweet, Deep, Chipmunk, Robot, Megaphone, Whisper;
    - Tone: Bass, Treble, Bright, Telephone, Radio, Vinyl, Lo-fi, Distorted;
    - Space: Echo, Room, Hall, Plate, Cathedral, Stadium, Underwater.
  - How some of them are built:
    - Reduce noise is `afftdn`, with its strength mapped to noise floor and reduction.
    - Enhance voice is a high-pass, light denoise, de-ess, compressor and limiter, scaled by its amount.
    - Pitch-type effects keep the length: they change the sample rate, resample, then tempo-correct.
    - Room, Hall, Plate, Cathedral and Stadium are multi-tap `aecho`.
  - Built-in effects never change their sound. A revision is a new id.
  - The module is shaped so that video effects (#12) can join the same registry under another kind.
- **Normalize loudness:**
  - Its settings are a target in LUFS (−30 to −12, default −23).
  - It isn't a fixed fragment. The renderer measures the item's sound up to that entry, with `loudnorm` print or `ebur128`, then applies `volume` to reach the target. The true peak is capped by a limiter at −1.5 dBTP.
  - The measurement is cached with the Effected copy's key, so preview and render agree, and a render can reuse it.
  - A silent item gets no gain.
- **Planner:**
  - AudioEvent and SegmentPlan carry the item's validated, enabled stack.
  - The plan's dry-run view lists each sound's stack.
  - Ducking (Words-based) is unchanged.
- **Renderer:**
  - The stack's chain is inserted after Speed / Reverse and `asetpts`, and before `volume` × duck, fades and `adelay`. This applies:
    - in each Segment's chain;
    - in each Music Clip's and video Overlay's chain;
    - in the per-item WAV path;
    - in the whole-sound export path.
  - An item with effects is not "plain". The concat fast path, and the collapse of a single plain Segment back into a range, both count a non-empty stack.
  - Each chain ends with a trim to the item's length, so echo tails are cut there.
  - Under a Transition, each Segment's chain runs before the `acrossfade`.
  - The final two-pass loudness on the mix is unchanged.
- **Effected copies (new backend module and endpoint):**
  - An endpoint takes a Candidate id and an item (kind and id), with the draft's unsaved edits, as the per-item WAV endpoint does. It returns the item's Effected copy: its sound before volume (range, Speed, Reverse, Audio Effects) as a compressed or PCM file the browser can play.
  - It is built by the same chain builder as the render.
  - The copy is keyed by a hash of: the source file and its range, Speed, pitch, Reverse, and the validated stack.
  - Copies are made once per key and kept in the Job's folder. A request for a copy being made waits on that same job.
  - After each save of a Candidate, copies that no Candidate of the Job references are deleted. All of them go with the Job.
  - Items with an empty stack (or with every entry off), Muted items and Freeze frames have no copy. The preview plays them as today.
- **Preview:**
  - Each sounding item with a non-empty enabled stack asks for its Effected copy.
  - Once the copy is ready, the item's sound is played from a hidden audio element on the copy, at 1×, positioned in the item's own time. For a Source Segment, the deck's video element is silenced over that Segment.
  - The item's Web Audio gain still carries volume, Keyframes, fades, Ducking and the Transition share, so those stay live.
  - Before the copy is ready, the item plays its own sound without effects.
  - The copy is requested again (debounced) when the stack or anything in its key changes.
  - The Meters read the master bus as today, so they follow the copy.
- **Editor actions:**
  - Toggling a Clean switch inserts or removes its catalogue entry. Reduce noise, then Enhance voice, go at the top; Normalize goes at the bottom. Switching off removes the entry; changing its slider changes its settings.
  - Add effect appends to the bottom of every sounding picked item.
  - Move up and move down, enable / disable, remove, and change a setting each act on one entry by its index.
  - Each action is one step of undo, and works on a Pick of several items where the stacks are equal.
  - Detach copies `audio_effects` onto the Music Clip and keeps the Segment's.
  - Split copies the stack to both parts. The Clipboard carries it.
  - The Revision merge treats `audio_effects` as one field of the item.
- **Inspector UI:**
  - The section goes after volume and fades, for a Segment (one with sound), a Music Clip and a video Overlay:
    - the three switches with their sliders;
    - the stack rows: intensity slider, "More" popover for other settings, on/off, up/down, remove;
    - "Add effect", opening a library popover: groups, search, and one click adds;
    - "Preparing effects…" while any picked item's copy is being made.
  - The library hides the three Clean effects; they are the switches.
  - On a phone, an "Audio effects" bottom sheet holds the same controls.
- **API and MCP:**
  - `GET` the audio effects catalogue for the editor.
  - Validation runs on every save path, so a bad stack is refused with the item, index and reason.
  - MCP:
    - `list_assets(kind="audio_effects")` returns the catalogue;
    - `edit_candidate` and `merge_candidate_items` take `audio_effects` on Segments, Music Clips and Overlays;
    - `merge_candidate_items` replaces an item's stack as a whole;
    - `dry_run` shows each sound's stack;
    - the server instructions describe the stack, its place in the chain, the Clean three, Normalize and the catalogue listing.

## Testing Decisions

Good tests check what is heard and what is refused, not how a filter string is spelled. Examples:
- the energy of a rendered tone below or above a frequency;
- the dominant pitch of a stretch;
- the loudness of an item after Normalize;
- whether an echo is heard past the item's end;
- the Candidate after an editor action;
- what the API and MCP turn down.

- **Catalogue (pytest, real ffmpeg, short):**
  - every effect's chain at its defaults, minimums and maximums runs over a generated 1 s tone without error, and keeps the input's length;
  - validation fills defaults and refuses unknown ids, unknown keys and out-of-range values;
  - a disabled entry adds nothing.
- **Seam B, the planner (pytest):**
  - stacks reach AudioEvents and SegmentPlans, enabled entries only;
  - a Detached sound's stack is planned on its Music Clip;
  - a stored Candidate without the field plans exactly as before;
  - the dry-run view lists the stacks.

  Prior art: `test_planner.py`, `test_music.py`.
- **Seam A, the HTTP API with real ffmpeg** (short renders of a generated video with a tone, as `test_keyed_volume.py` and the audio-mixing tests do):
  - Telephone removes most energy under 300 Hz;
  - Pitch +12 moves a 440 Hz tone to about 880 Hz, at the same length;
  - Echo is heard after the tone stops within the item, and not past the item's end;
  - Normalize brings a quiet tone near its target, steady over its length;
  - a stack works on a Source Segment, a media Segment, a Music Clip and an Overlay video;
  - a Segment with effects among plain ones keeps its timing at a join and under a Transition;
  - a stored Candidate renders the same command as before (the existing command fixture).
- **Effected copy endpoint (Seam A):**
  - a copy matches the item's sound in the render (before volume): same length and close spectrum;
  - unsaved draft edits are used;
  - the same key returns the same file without a second ffmpeg run;
  - unused copies are removed after a save;
  - a Freeze frame, an image and an empty stack are refused or answered as "no copy".
- **Per-item WAV (Seam A):** it includes the effects.
- **API and MCP refusals:**
  - an unknown id, unknown key or out-of-range value;
  - a stack on a Freeze frame or an image Overlay;
  - `list_assets(kind="audio_effects")` content;
  - `merge_candidate_items` replacing a stack.
- **The editor (vitest, actions tests):**
  - the Clean switches' insert positions and removal;
  - Add effect on a mixed Pick, skipping items with no sound;
  - move, toggle and remove by index;
  - Detach copying the stack and Reattach keeping the Segment's;
  - Split and paste carrying it;
  - the Revision merge of two different stack edits.

  Prior art: `actions.test.ts`, `speed.test.ts`.
- **Walkthrough** (`run` / ego-browser, desktop and phone):
  - switch on Reduce noise on the Source;
  - add Telephone to a Detached quote and hear it after "Preparing effects…";
  - stack Deep and Echo and reorder them;
  - render and compare;
  - save a WAV.

Run only this feature's backend test files, never the full suite.

## Out of Scope

- **Video effects** (blur, grain, glitch, chroma key and so on). They are #12 and will join the same registry.
- **Keyframes on effect settings.**
- **A master stack on the whole mix.** The final loudness stays in the Export Settings.
- **Auditioning an effect before adding it,** whether on hover or with a "Listen" button.
- **Web Audio approximations of effects.**
- **`arnndn` / RNNoise or any shipped model;** AI voice isolation.
- **Convolution reverbs and impulse responses.**
- **Favourites in the effect library, owner-saved effect presets, and imported effects.**
- **Effect tails heard past an item's end.**
- **Auto-applying Enhance voice to voiceover takes.** That belongs to `voiceover` (#16).

## Further Notes

- **Voiceover (#16) and TTS (#17) arrive as Music Clips,** so they get Audio Effects with no extra work. Voiceover may preset Reduce noise or Enhance voice on a new take.
- **Concat is a reference for behaviour and settings only, never for code.** Its manifests pin each chain at default, min and max. We test by what is heard instead.
- **Effected copies are another derived file, like Retimed copies.** If disk use grows, a size cap can come later.
- **Templates (#21) will carry stacks as an ordinary item field.**
