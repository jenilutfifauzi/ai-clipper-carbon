# 0017: Audio Effects are an ordered stack, heard in the preview through Effected copies

Status: accepted
Date: 2026-10-20

Amends 0016 (Detach copies the Audio Effects too).

## Context

The `audio-effects` feature brings Concat's per-clip sound treatments to the Advanced Edit:
- three cleanup switches: Reduce noise, Enhance voice and Normalize loudness;
- 22 presets in three groups: Voice, Tone and Space.

Concat stores an ordered list of applied effects on each clip. Its export applies the list after speed and before volume and fades. Its preview doesn't apply effects live: it decodes each clip's span through the same ffmpeg filters into a cached buffer.

Today:
- **Every sounding item already has its own chain in the render.** A Segment's is built in `_source_inputs`; a Music Clip's and an Overlay video's in `_audio_mix`.
- **The preview plays each media element through one Web Audio gain.** That gain carries the volume, Keyframes, fades, duck and Transition share. A Source deck's element plays several Segments in turn.
- **Two-pass `loudnorm` runs on the whole mix** when the Export Settings have a loudness target.
- **ffmpeg here has `afftdn`, `arnndn`, `rubberband`, `aecho`, `acrusher` and `deesser`.** No `.rnnn` model is shipped.

`.scratch/advanced-edit/spec.md` lists "filters and effects" as Out of Scope. Filters were overturned by 0013; "effects stay out".

## Decision

- **An item's sound has an ordered stack of Audio Effects.**
  - Segments (of the Source or a media item), Music Clips (songs, Detached sound, and later voiceover and TTS) and video Overlays each have the stack. Nothing applies to the whole mix.
  - Each entry is a catalogue id, its parameters and an on/off switch. Order is audible, and the owner can reorder the stack.
  - Parameters are constant over the item's length and are never keyed.
- **The three cleanup switches are ordinary catalogue entries.**
  - The Inspector shows them as switches.
  - Switching Reduce noise or Enhance voice on puts it at the top of the stack. Switching Normalize loudness on puts it at the bottom.
- **Where the stack sits in an item's chain:** trim → Speed / Reverse → Audio Effects → volume and Keyframes × duck → fades → delay, then `amix`.
  - Effects are cut at the item's end, so its length never changes. An echo's tail is lost unless it is faded.
- **The catalogue is a Python registry.** Each effect has:
  - an id, a name, a group and an order;
  - its parameters (key, label, min, max, default, step, unit), one of them marked as the intensity;
  - a function that builds its ffmpeg chain.

  A built-in effect never changes what it sounds like; a revision gets a new id, as a Look does. Saves are refused for an unknown id, an unknown parameter or a value out of range; a parameter left out takes the catalogue's default. The editor reads the catalogue from the server, and the agent through `list_assets`. Video effects will join the same registry.
- **Reduce noise is `afftdn`,** with its strength mapped onto noise floor and reduction, as Concat does. No model is shipped.
- **Normalize loudness is measured, then applied as linear gain, per item.**
  - The item's sound is measured up to that point in its stack, and the measurement is cached.
  - A fixed gain brings the item to its target (−30 to −12 LUFS, −23 by default).
  - The final two-pass `loudnorm` on the mix is unchanged and still measures after everything.
- **The preview hears an Effected copy.**
  - The server renders each item that has Audio Effects into a file. The file holds the item's sound up to (but not including) its volume: its range, Speed, Reverse and Audio Effects, through the same chain builder as the render.
  - The preview plays the copy at 1×, in place of the item's media element's sound, and applies volume, Keyframes, fades and duck in Web Audio as today.
  - Until the copy is ready, the preview plays the item without its effects, and the Inspector says the effects are being prepared.
  - Copies are kept in the Job's folder, keyed by everything they're made from. The ones no Candidate of the Job uses are removed after a save.
- **Detach copies the Segment's Audio Effects onto the Music Clip.** The Segment keeps its own, so Reattach brings the Segment back as it was.
- **Saving an item's sound as WAV includes its Audio Effects.** It still leaves out Ducking and the final loudness.

## Considered options

- **Web Audio approximations in the preview** (biquads, delays, a convolver). Effects would be live with no wait. But denoise, pitch, bit-crushing and compression can't be matched, so the preview would lie. A Source deck would also have to swap chains as its Segments change.
- **A hybrid:** Web Audio for EQ and echo, the server for the rest. The two paths would drift, and most presets mix both kinds.
- **Three fixed cleanup fields plus one preset.** This is simpler, but two presets couldn't be stacked, and the order would be fixed.
- **`arnndn` with a bundled RNNoise model.** It is better on changing noise. But it adds a shipped asset, its only control is a mix rather than a strength, and Concat leaves it out.
- **Manifest files with a chain template language** (Concat's TOML). Effects could be added without code. But we would need an expression evaluator and a filter allow-list for what a Python function already gives us, tested.
- **Single-pass `loudnorm` per item** (Concat). It is simpler, but it pumps and starts unsettled. `speechnorm` / `dynaudnorm` level within an item rather than to a target.
- **Keyed effect parameters.** They would need per-frame expressions in ffmpeg, and a copy re-made on every Keyframe edit.
- **Echo tails heard past the item's end.** The sound would be heard where the Timeline shows nothing.

## Consequences

- **Overturns "effects stay out" in `.scratch/advanced-edit/spec.md` for sound only.** Video effects stay out until `video-effects`.
- **Every stored Candidate plans, renders and previews as before:** an absent stack is empty. A Segment with Audio Effects is no longer "plain", so the render's concat fast path, and the collapse of a single plain Segment back into a range, must count the stack.
- **Changing an effect means a wait of a few seconds before the preview hears it.** Effects can't be auditioned on hover. Volume, fades and duck stay instant.
- **The preview's sound now comes from two kinds of file:** the item's own media, or its Effected copy.
- **Rendering a Clip with Normalize loudness costs a measure pass per item,** unless the measurement is cached.
