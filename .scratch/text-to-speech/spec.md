# Text to speech: Narration read by a Voice

Status: ready-for-agent
Created: 2026-10-21

## Problem Statement

The owner can record a Voiceover (ADR 0018), but often wants narration without speaking it themselves.

- **No voice to hand.** An intro line, a lower-third read aloud, or a recap over B-roll needs a voice. Recording means a quiet room, a microphone and a desktop browser in a secure context. That rules out a phone over plain HTTP, and any time the owner just wants a clean neutral read.
- **Leaving the app.** Today the owner types the line into another TTS service, downloads a file, uploads it to the Media Library and drags it into place. Each retake repeats the whole trip.
- **Most Jobs are Indonesian.** Concat's local engines (Kokoro, Pocket TTS, Chatterbox) speak English, and Kokoro also Chinese. None speaks Indonesian.

## Solution

A **Narrate** tab in the Advanced Edit's asset panel, on desktop and phone, turns typed words into a **Narration** read by a **Voice** (GLOSSARY).

- **Where it starts.**
  - The owner types a script, or opens the tab with a Text Layer or the hook picked, which fills the script with its words.
  - The Narration starts at the playhead, or at the start of that picked item.
- **Engine and Voice.**
  - The owner chooses an engine, which is either a cloud service set up in `.env` (Gemini TTS, or any OpenAI-compatible `/audio/speech` service) or Kokoro on this Mac (English only).
  - Then the owner chooses a Voice and can play a short sample of each.
  - Speed, the pause between sentences and, for cloud engines, a Style line ("warm, unhurried") shape the read.
- **What Generate does.**
  - The backend reads the script sentence by sentence, joins the sentences with the chosen pause, and levels the sound.
  - It adds the result to the Media Library as "Narration <voice> <date time>", like an uploaded song.
  - The Narration lands as a Music Clip marked Speech, Picked, at the time fixed when Generate was pressed. Speech means it ducks the songs under it and is never ducked itself.
- **Not happy with it?** Undo removes the Music Clip and keeps the item. Change the script or Voice and Generate again.
- **Kokoro's model on first use.**
  - The first time the owner picks Kokoro, the tab offers to download its model (about 132 MB), with progress and cancel.
  - The download resumes if interrupted and is checked against a pinned SHA-256.
  - The model can be removed from the same menu.
- **The agent** lists the ready Voices and generates a Narration through MCP, then lays it with the ordinary Music Clip tools.

## User Stories

1. As the owner, I want a Narrate tab in the asset panel, so that turning text into a voice sits beside the songs and media I already add from there.
2. As the owner, I want to type a script and press Generate, so that a narrated line appears on my Timeline without leaving the app.
3. As the owner, I want the Narration to land at the playhead, so that I place it by scrubbing to where it should be heard.
4. As the owner, I want the Narration to start at the start of the Text Layer I picked, with its words already in the script, so that a title is read aloud exactly when it appears.
5. As the owner, I want the hook's words used the same way when the hook is picked, so that the hook can be spoken over the opening.
6. As the owner, I want the earliest picked Text Layer or hook to win when I have picked several, so that the result is predictable.
7. As the owner, I want to edit the pre-filled script freely before generating, so that what is read can differ from what is shown.
8. As the owner, I want the Narration to be a Music Clip marked Speech, so that my music ducks under it as it does under a Take.
9. As the owner, I want the new Music Clip Picked after it lands, so that I can trim, fade or move it straight away.
10. As the owner, I want it on a free lane of the Music Track, so that it never overwrites another Music Clip.
11. As the owner, I want Undo to remove the Music Clip and keep the Media Library item, so that undo behaves as it does for a Take.
12. As the owner, I want every Generate to make a new item, so that an earlier Narration I kept is never replaced behind my back.
13. As the owner, I want the Narration named "Narration <voice> <date time>" in the Media tab, so that I can tell my Narrations apart and reuse one in another Candidate.
14. As the owner, I want to choose between the engines that are set up, so that I can pick Indonesian from a cloud engine and English from Kokoro.
15. As the owner, I want each cloud engine labelled with its service ("Gemini · cloud"), and Kokoro labelled "On this Mac", so that I know when my words leave this Mac.
16. As the owner, I want the engine to default from the Job's language (Indonesian: the first cloud engine set up; English: Kokoro), so that the right voice is usually already chosen.
17. As the owner, I want my last engine and Voice remembered by the browser, so that I don't choose them again every time.
18. As the owner, I want a Voice list with readable names and a detail line (such as "American · female"), so that I can choose without knowing model codes.
19. As the owner, I want to play a short sample of each Voice in the Job's language, so that I hear it before spending a whole Generate.
20. As the owner, I want a sample made once and kept on this Mac, so that replaying it is instant and costs no quota.
21. As the owner, I want a Speed control from 0.5× to 2×, so that the read fits the time I have.
22. As the owner, I want a pause control for the gap between sentences, so that a list reads crisply or a story breathes.
23. As the owner, I want a Style line for cloud engines that take one, so that I can ask for a tone ("energetic", "calm, low").
24. As the owner, I want the Style line hidden for engines that ignore it, so that I am not misled.
25. As the owner, I want an estimate of the Narration's length and the character count before I generate, so that I know whether it fits.
26. As the owner, I want scripts limited to 5,000 characters with a clear message beyond it, so that a runaway paste doesn't run for minutes or burn quota.
27. As the owner, I want progress shown sentence by sentence, so that I see a long script moving.
28. As the owner, I want to cancel a Narration being made, so that I can fix a typo without waiting.
29. As the owner, I want a cancelled or failed Narration to leave nothing behind, so that the Media tab doesn't fill with broken pieces.
30. As the owner, I want my script and settings kept in the tab after a failure or cancel, so that I can try again in one press.
31. As the owner, I want a passing rate limit or server error from a cloud engine retried once by itself, so that a blip doesn't fail a long script.
32. As the owner, I want a clear error naming the engine when it fails anyway (bad key, quota, network), so that I know what to fix.
33. As the owner, I want a second Generate refused as busy while one is being made, anywhere in the app, so that two Narrations never fight for the engine.
34. As the owner, I want to keep editing while a Narration is being made, so that a long read doesn't freeze my work.
35. As the owner, I want the Narration to land at the time fixed when I pressed Generate, so that moving the playhead meanwhile doesn't move it.
36. As the owner, I want the item kept in the Media tab, unlaid, if the Music Track is locked or the tab is closed when it is ready, so that a finished Narration is never lost.
37. As the owner, I want Generate off at the Clip's end, so that I don't make something that wouldn't be heard.
38. As the owner, I want every Voice and engine to come out at the same loudness, so that switching Voice doesn't mean re-balancing volumes.
39. As the owner, I want Kokoro offered with a "Download Kokoro (132 MB)" button when its model isn't here yet, so that I opt in to the disk use.
40. As the owner, I want download progress, cancel and resume, so that a slow connection or a closed lid doesn't mean starting over.
41. As the owner, I want a download that fails its checksum discarded with a message, so that a corrupt model never gets used.
42. As the owner, I want a half-finished download never treated as installed, so that a crash can't leave Kokoro broken.
43. As the owner, I want to remove Kokoro's model from the engine menu, so that I get the disk space back.
44. As the owner, I want removal refused while a Narration is being made, so that it can't break one mid-way.
45. As the owner, I want Kokoro's Voice samples off until the model is downloaded, so that the button never pretends.
46. As the owner on a phone, I want the Narrate tab in the bottom sheet like the other asset tabs, so that I can add narration away from my desk.
47. As the owner, I want a hint saying how to set up a cloud engine when none is set up and Kokoro isn't downloaded, so that an empty tab isn't a dead end.
48. As the owner, I want the Narration's Music Clip to behave like any other: Speed, fades, volume, Keyframes, Audio Effects, Mute, Ripple delete, copy and paste, so that nothing about it is special once laid.
49. As the agent, I want `list_assets(kind="voices")` to list the ready engines and their Voices, with each engine's service and whether it takes a Style, so that I can choose one for a Job's language.
50. As the agent, I want `generate_speech(text, engine, voice, speed, pauses, style)` to make a Narration and return its Media Library id and length, so that I can narrate a Candidate.
51. As the agent, I want to lay the returned item with `merge_candidate_items` (a Music Clip with `speech: true`), so that placing it uses the tools I already know.
52. As the agent, I want `generate_speech` to fail with the same messages the owner sees (busy, too long, engine not ready, engine error), so that I can recover.
53. As the developer, I want the cloud engines configured apart from the LLM, so that `LLM_PROVIDER=openai` pointing at DeepSeek doesn't stop Gemini TTS from working.
54. As the developer, I want engines behind one small interface, so that a new service or local model is one adapter, not a new flow.

## Implementation Decisions

**Model.**
- **No Candidate model change.** A Narration is a Media Library audio item, laid as an ordinary Music Clip with `speech: true` and `duck: null` (ADR 0018). Nothing in the planner, renderer, Ducking or Clipboard changes.
- **The Media Library item carries no origin mark and no script.** It is named "Narration <voice name> <date time>". The upload path is the same one a song or a Take takes.

**Engines.**
- **The engine interface.** An engine names itself (id, label, service, cloud or local), says whether it is ready, lists its Voices, says whether it takes a Style, and reads one sentence into mono PCM at its own sample rate, given a Voice, a Speed and an optional Style. A Voice has an id, a display name, a detail line and a language tag.
- **Gemini TTS** is offered whenever `GEMINI_API_KEY` is set, whatever `LLM_PROVIDER` says.
  - Its model is a setting with a default (`TTS_GEMINI_MODEL`, `gemini-3.8-flash-lite-tts`: the cost-efficient TTS model, made for many short reads). It is called through generateContent's REST API with httpx, AUDIO as the response modality; the answer is raw 16-bit PCM, its rate in the MIME type (24 kHz).
  - Its prebuilt Voices are a fixed list in code. They are multilingual and read the script's language.
  - It takes a Style, sent as the read's instruction: "<style>: <sentence>".
  - Speed isn't native to it. Speed is applied after the read with a pitch-keeping tempo change, the same treatment Music Clip Speed uses (`atempo`). Each sentence is retimed alone, padded or cut to its length at the Speed, so the pauses keep their length. An engine says whether it takes a Speed of its own; only one that does is asked for it.
- **OpenAI-compatible speech** is offered when `TTS_BASE_URL`, `TTS_API_KEY` and `TTS_MODEL` are all set.
  - Voices are the service's standard list, overridable by `TTS_VOICES` (comma-separated).
  - It asks for `response_format: "wav"` and decodes the WAV by its header (mono or mixed down, 16-bit; a streamed file's unknown sizes are read to the end). A raw `pcm` answer is read at 24 kHz. Its service is "OpenAI" for `api.openai.com`, else the host of `TTS_BASE_URL`; failures name it ("OpenAI TTS is busy (429)", "… refused TTS_API_KEY").
  - It takes a Style when the model accepts instructions, sent as `instructions`. That is a setting (`TTS_STYLE`, true or false). Left empty, it is on for `gpt-…tts` models such as `gpt-4o-mini-tts`, and off for others (`tts-1`, most compatible services).
  - Speed goes to the service's own `speed` field, left out at 1×.
- **Kokoro on this Mac**, run through sherpa-onnx with its int8 multi-language v1.0 archive.
  - The archive brings espeak-ng data and lexicons, so no brew package is needed.
  - Only its English Voices (American and British, female and male) are offered: the model's speakers 0–27 (`af_*`, `am_*`, `bf_*`, `bm_*`), each read by its speaker id, named from its id with its detail line ("Heart" · "American · female"). All read with the archive's American lexicon (`lexicon-us-en.txt`), as sherpa-onnx's own Kokoro invocation does.
  - Speed goes to the engine natively; it takes no Style. A read is float samples at the engine's rate (24 kHz), turned into 16-bit PCM.
  - The loaded engine stays in memory, loaded on the first read and reading one sentence at a time, until the model is removed: removal unloads it.
  - It is ready once the model is installed and sherpa-onnx imports (it is imported only on the first read, so the app starts without it).
  - sherpa-onnx (pinned `>=1.13.8,<1.14`) is listed with `sherpa-onnx-core`, its native library, which uv doesn't see in sherpa-onnx's published metadata.
- **The engines are configured apart from the LLM settings.** They are read in the same settings loader, and none of the LLM code paths change.
- **The default engine** follows the Job's language. Indonesian gets the first ready cloud engine (Gemini, then OpenAI-compatible); English gets Kokoro if ready, else the first cloud engine. The frontend then remembers the last engine and Voice chosen (localStorage, wrapped in try/catch), which win over the default while that engine is ready.

**The Narration runner.**
- **A small module of its own, not the Job Worker.** It runs one Narration at a time for the whole app, in a thread of its own. A second request while one runs is refused as busy (HTTP 409).
- **Sentence splitting.**
  - The script is trimmed and refused when empty or longer than 5,000 characters (HTTP 422).
  - It is split at `.`, `!`, `?`, `…` and newlines, keeping the mark with its sentence. A mark ends a sentence only when a space or the line's end follows it, so "3.5" and "example.com" stay whole.
  - A run of blank lines counts as one break, and a sentence with no letters or digits is dropped.
- **Reading.**
  - Each sentence is read alone.
  - On a cloud 429, 5xx or network failure it is retried once after the service's `Retry-After`, or after a short fixed wait (2 s). A cancel during the wait stops it.
  - Any other failure, or the retry failing, fails the Narration.
- **Joining.**
  - Sentences are resampled to 48 kHz mono and joined with silence of the pause length.
  - `pauses` is the silence in seconds, 0–1.5, 0.3 by default. The slider's four stops are None / Natural / Long / Longer: 0, 0.3, 0.8 and 1.5 s.
  - No silence comes before the first sentence or after the last.
- **Levelling.** The joined sound is levelled with ffmpeg `loudnorm` to a fixed target for speech (−16 LUFS integrated, −1.5 dBTP) before upload. No Audio Effect is added to the Music Clip.
- **Output.** A WAV goes through the Media Library's normal add (AAC normalisation, Peaks). The runner reports the new item.
- **Progress** is sentences done out of sentences, plus a stage: "Loading the voice", "Reading", "Levelling", "Saving". It is told as "Loading the voice" 0, "Reading" 0, then "Reading" after each sentence, then "Levelling" and "Saving".
- **Cancel** stops before the next sentence (and before levelling and saving) and discards everything. So does a failure. A cancel after the item was added is refused: the Narration has been made.
- **Leaving the page doesn't cancel.** The item is still added, unlaid.

**HTTP API.**
- `GET /api/voices` returns:
  - the engines, each with id, label, service, cloud/local, ready, takes-style and its Voices;
  - Kokoro's download state (absent, downloading with bytes done and total, ready, failed with message), as `kokoro: {state, done, total, message}`, `total` the archive's size whatever the state; null when Kokoro isn't offered;
  - the default engine for a given Job language.
- `POST /api/narrations` takes `{text, engine, voice, speed, pauses, style}` and returns a narration id. A Speed outside 0.5–2 is refused (422), and so is a Style for an engine that takes none (a blank Style is none).
  - It answers 409 when busy and 422 when the text is empty or too long, or the engine or Voice is unknown or not ready.
- `GET /api/narrations/{id}/events` is an SSE stream of `progress` (`{stage, done, of}`), then `done` with the Media item, `failed` with the message, or `cancelled`. It follows the existing job events style, and opened late it replays everything.
- `DELETE /api/narrations/{id}` cancels: 204, 404 for an unknown one, 409 for one that has ended.
- `GET /api/voices/{engine}/{voice}/sample?lang=` returns the sample sound, a WAV.
  - It is made on first request from a fixed sentence per language (Indonesian and English; English for any other language), read at 1× with no Style and levelled as a Narration is, and kept on this Mac per engine, Voice and language (under `DATA_DIR/voice-samples`).
  - It is refused (422) when the engine isn't ready or the Voice is unknown. Samples share the one-at-a-time runner, so a sample is refused as busy (409) while a Narration is being made, and a Narration while a sample is being read. A kept sample is served whatever is running. An engine's failure answers 502 with its message, and nothing is kept.
- `POST /api/voices/kokoro/download` starts the download (202 with its state; nothing new when it is here or downloading), `DELETE` on the same path cancels it (204), and `DELETE /api/voices/kokoro` removes the model and Kokoro's kept samples (204). Removal answers 409 while a Narration or sample is being made (it holds the runner's one-at-a-time lock) or while the model downloads.
- Download progress shows in `GET /api/voices`, which the tab polls while downloading.

**Kokoro download.**
- **Pinned source and digest.** One archive URL and its SHA-256 are pinned in code (`app/kokoro.py`): sherpa-onnx's `tts-models` release, `kokoro-int8-multi-lang-v1_0.tar.bz2`, 132,303,094 bytes, as Concat's `models/manifest.toml` lists its upstream (digest and size checked against the real archive).
- **Resume.** The download writes a `.part` file under `DATA_DIR/models` and resumes it with an HTTP Range request from its size. A server that answers the whole file instead starts the `.part` over.
- **Cancel** stops it at the next chunk and reports absent at once; the `.part` stays for the next download. A dropped connection reports failed and keeps the `.part` too.
- **Check.**
  - The finished file is checked against the digest. A mismatch deletes it and reports a failure.
  - The archive is unpacked into a staging folder and then renamed into place, so a torn download never looks installed.
  - Archive members whose paths escape the folder are refused, and so are links that lead out of it. Nothing is installed then, and the file is deleted. An archive without the model's `.onnx` is refused the same way.
- **One download at a time.** It runs in its own thread, separate from the runner.

**MCP.**
- `list_assets(kind="voices")` returns what `GET /api/voices` does, without the download progress: the ready engines only (so without `ready`), each with its id, label, service, `local`, `takes_style` and Voices, and the `default` engine. There is no Job in an MCP call, so `list_assets` takes an optional `language` (the Job's), passed to `GET /api/voices` for the default; without it, the default is that of a language other than English (the first ready cloud engine).
- `generate_speech(text, engine, voice, speed=1, pauses=0.3, style=None)` starts a Narration through `POST /api/narrations` and so the same runner. It follows the runner's events to the end, and returns the Media item's id, name and duration, or the runner's error as a tool error: the route's refusals (busy, too long, engine not ready) and a failed Narration's message (engine error).
- Laying the Narration is the agent's job, through `merge_candidate_items` with a Music Clip `{media, start, speech: true}`. No new edit field exists, so `edit_candidate`, `merge_candidate_items` and `dry_run` need no change.

**Frontend.**
- **A new `narrate` asset tab** in the asset panel, and the same content in the phone bottom sheet. It holds:
  - the engine picker, with labels "<service> · cloud" and "On this Mac", and a Download / Remove item for Kokoro;
  - the Voice list, with name, detail line and Play sample;
  - Speed, the pause slider, and the Style line (shown only when the engine takes one);
  - the script textarea, with an estimate "About m:ss · N characters" from a characters-per-second constant per language (Indonesian 14, English 15, others 14), scaled by Speed, the pauses not counted. Past 5,000 characters the estimate turns into the limit message and Generate is off;
  - Generate, which shows progress and Cancel while running.
- **The script, Voice and pause are kept by the editor's Narrate flow**, not the tab, so a failure, a busy refusal, a cancel or a tab switch keeps them.
- **Cancel** frees the tab at once. If the Narration was made before the cancel reached it, the item is added to the Media tab, unlaid, and the tab says so.
- **Opening the tab with a Text Layer or the hook picked** fills the script with its words (lines joined by spaces) and fixes the start at its start. With several picked, the earliest on the Timeline wins (the first picked of those from the same start); the hook is always picked alone. A title without words counts as none. Otherwise the start is the playhead.
  - **When it fills.** On opening the tab, and again when the Pick changes to another title while the tab is shown. It fills only a script the owner hasn't typed: a blank one, or one still exactly the words a title last filled. A script the owner typed or edited is never replaced, but the start is still the picked title's. Picking nothing leaves the script as it is.
  - The hint above the fields names where it lands ("the start of the Text Layer", "the start of the hook", "the playhead"). Generate is off when that start is at the Clip's end.
- **The start is fixed when Generate is pressed.** On `done`, the tab lands a Music Clip `{media, start, secs: duration, speech: true}` on a free lane through the same action `landTake` uses. It is Picked and is one undo step.
  - If the Music Track is locked, the tab says the Narration is in the Media tab instead.
  - If the Candidate's Clip has become shorter than the start, the Narration still lands, and the render cuts what runs past the end, as for a Take.
- **Generate is off** at the Clip's end, with an empty script, or with no ready engine. With no ready engine, a hint names the `.env` settings and offers the Kokoro download.

**Glossary and ADR.**
- Narration and Voice are new terms. Speech is amended to include Narration.
- ADR 0019 records the decisions.
- No Out of Scope item of the Advanced Edit spec is overturned. Text to speech wasn't listed there.

## Testing Decisions

Good tests check what the owner, the agent or the render sees through a public seam, never a module's internals. Following the user's standing instruction, only the feature's own test files are run, never the whole backend suite.

**Seam A: HTTP, MCP and the real ffmpeg, with a fake engine** (new `test_narration.py`; prior art `test_media_library.py`, `test_mcp.py`, `test_music.py`, `test_ducking.py`, and the injected fakes in `tests/fakes.py`). A `FakeVoiceEngine` reads each sentence as a tone, one second per sentence, can be told to fail, and records what it was asked.
- A three-sentence script becomes one Media Library audio item named "Narration <voice> …", with Peaks. It lasts three seconds plus two pauses.
- The pause setting changes the silence between tones, and none comes before the first or after the last (measured from the item's sound).
- Splitting: `.`, `!`, `?`, `…` and newlines split, blank lines collapse, a sentence with no letters is dropped, and the engine is called once per sentence with its mark.
- Two engines with tones at different levels come out at the same integrated loudness, within 1 LU.
- An empty script, one of 5,001 characters, an unknown Voice and an engine that isn't ready are each refused with 422.
- A second request while one runs is refused with 409.
- Cancel mid-way leaves no item and no stray file.
- A transient failure on one sentence is retried once and succeeds. A second failure, or a non-transient one, fails the Narration with the engine's message and leaves no item.
- The events stream reports progress per sentence, then `done` with the item.
- `list_assets(kind="voices")` lists the fake engine and its Voices.
- `generate_speech` returns the item's id and duration.
- `merge_candidate_items` with `speech: true` lays it, and `dry_run` lists a song's speech spans from it (ADR 0018's behaviour, now from a Narration).
- A sample is made once and served from the Mac the second time, without calling the engine again.
- Settings: Gemini TTS is offered with `GEMINI_API_KEY` set and `LLM_PROVIDER=openai`. The OpenAI-compatible engine is offered only when all three `TTS_*` settings are set. The default engine follows the Job's language.

**Cloud adapters through `httpx.MockTransport`** (new `test_tts_engines.py`; prior art `test_gemini.py`, `test_openai.py`):
- Each request carries the Voice, the text, the Style when given and, for OpenAI, the speed.
- The returned audio decodes to PCM at the stated rate.
- 429 with `Retry-After` and 5xx map to the transient error; 401/403 map to a message naming the key.

**Kokoro download against a local server** (new `test_kokoro_download.py`; prior art the `.part` handling in `download_assets.py`):
- A good archive is fetched, checked, unpacked and reported ready.
- A wrong digest deletes the file and reports failed.
- An interrupted download resumes with a Range request from the `.part` size.
- An archive member escaping the folder is refused.
- Remove deletes the model, and is refused while a Narration runs.
- Real Kokoro synthesis (`test_kokoro_engine.py`) runs only when `KOKORO_TEST_MODEL` names the unpacked model folder (`pytest.skip` otherwise): one English sentence reads to non-silent audio at 24 kHz, and Speed 2 is shorter than Speed 1.

**Frontend, vitest** (new `narrate.test.tsx`; prior art `voiceoverFlow.test.tsx`, `meters.test.tsx`, `effectsTab.test.tsx`), with a fake API and SSE:
- The default engine from the Job's language, and the remembered choice.
- The Style line is shown only for engines that take one.
- The estimate and the character limit.
- Pre-filling from a picked Text Layer, the hook, and the earliest of several.
- Generate fixes the start, and the playhead moving meanwhile doesn't change it.
- `done` lands a Speech Music Clip on a free lane, Picked, as one undo step.
- A locked Music Track shows the "in the Media tab" message.
- Busy, failure and cancel keep the script.
- Generate is off at the Clip's end.
- The Kokoro Download / Remove states.

## Out of Scope

- **Voice cloning** from a recording (Concat's Pocket TTS and Chatterbox). It needs consent we can't check, and there is no Indonesian model.
- **Captions or Text Layers from the script, or from the Narration's sound.** ADR 0020 keeps captions from typed scripts and for Music Clips out of scope. Captions for every Speech Music Clip, Takes and Narrations alike, belong together later.
- **Drafting the script with the LLM** from the Transcript.
- **An audition step** before landing, and "Regenerate in place".
- **An origin mark or stored script** on the Media Library item, or a filter for Narrations in the Media tab.
- **Kokoro's Chinese Voices** and its full-precision build.
- **A local Indonesian model** (MMS-TTS is non-commercial).
- **A cost estimate** for cloud engines, or a confirmation before sending.
- **SSML or inline pause syntax,** and pitch control.
- **A Settings page.** Cloud engines are set up in `.env`.
- **Batch narration** of several picked Text Layers at once.

## Further Notes

- Concat's behaviour reference: `panes/speech.rs`, `ui/dialogs/speech.slint`, `concat-speech/src/tts.rs`, `concat-host/src/models.rs`, `models/manifest.toml` (behaviour and UX only, never code).
- Pin the Gemini TTS model name and the Kokoro archive's URL and SHA-256 when implementing. Check the current names; the defaults here are placeholders to confirm.
- sherpa-onnx is a new backend dependency (Apple Silicon wheel). Check its macOS arm64 wheel installs into the shared `.venv`.
- The Narration runner and the Kokoro downloader are both app-wide, so two editor tabs see the same busy and download state.
