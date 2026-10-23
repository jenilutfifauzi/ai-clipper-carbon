# 0019: A Narration is a generated song marked Speech

Status: accepted
Date: 2026-10-21

Follows 0018 (a Voiceover is a recorded song marked Speech).

## Context

The `text-to-speech` feature brings Concat's speech sheet (`panes/speech.rs`, `concat-speech/src/tts.rs`) to the Advanced Edit. Concat offers three engines, all on the machine and all downloaded on demand with SHA-256 checks:
- Kokoro with built-in speakers;
- Pocket TTS and Chatterbox, which clone a voice from a recording.

Today:
- **Most Jobs are Indonesian.** Kokoro has no Indonesian voice; Concat offers it only in English and Chinese. Pocket and Chatterbox are English only.
- **The LLM settings don't carry a speech service.** `LLM_PROVIDER` is `gemini` or `openai`, and the OpenAI-compatible default is DeepSeek, which has no audio endpoint.
- **The Worker has one queue** shared by renders and transcription.
- **The Media Library is global**, not per Job.
- **There is no settings page**, and model assets come from `make setup` with no digest check.
- **`espeak-ng` is not installed.** Kokoro needs it for phonemes.

## Decision

- **A Narration is an ordinary Media Library item, laid as a Music Clip marked Speech**, exactly like a Take (ADR 0018).
  - It is named "Narration <voice> <date time>". No new item kind, no origin mark, and no stored script.
  - Undo removes the Music Clip and keeps the item. Regenerating makes a new item.
  - There is no audition step: Generate lands it and Picks it.
- **Two kinds of engine**, each a list of built-in Voices.
  - **Cloud engines, configured apart from the LLM.**
    - Gemini TTS is offered whenever `GEMINI_API_KEY` is set, whatever `LLM_PROVIDER` says. Its model is `TTS_GEMINI_MODEL`, by default `gemini-3.8-flash-lite-tts`, called through generateContent's REST API.
    - An OpenAI-compatible `/audio/speech` engine is offered when `TTS_BASE_URL`, `TTS_API_KEY` and `TTS_MODEL` are set. Its Voices are OpenAI's standard list, replaced by a comma-separated `TTS_VOICES`. It asks for WAV, which compatible services most often share, and decodes it by its header (a streamed file's unknown sizes included); a raw `pcm` answer is read as OpenAI's 24 kHz. Its service is "OpenAI", or the host of `TTS_BASE_URL`.
    - Each is labelled with its service ("Gemini · cloud"), with no confirmation and no cost estimate.
  - **Kokoro on this Mac**, English Voices only, run through sherpa-onnx.
    - Its int8 model archive brings its own espeak-ng data, so no system package is needed.
    - It is downloaded from the Narrate tab on first use, with progress and cancel, resumed from a `.part` file.
    - It is sherpa-onnx's `kokoro-int8-multi-lang-v1_0.tar.bz2` from its `tts-models` GitHub release (the upstream Concat's manifest names, not Concat's mirror), checked against a pinned SHA-256, unpacked into a staging folder and renamed into `DATA_DIR/models` atomically. Members or links that lead out of the folder install nothing.
    - It can be removed from the same menu, except while a Narration or a sample is being made. Removal also unloads the engine, which otherwise stays in memory from the first read.
    - Each English Voice is one of the model's speakers, read by its id; Speed goes to it natively, and it takes no Style.
  - The default engine follows the Job's language: Indonesian gets the first ready cloud engine (Gemini, then OpenAI-compatible, then ElevenLabs: ADR 0026), English (any region: `en-GB`) gets Kokoro when ready, else the first cloud engine. The browser then remembers the last engine and Voice chosen, which win over the default.
- **The backend splits every script into sentences**, for every engine.
  - It splits at `.`, `!`, `?` and `…` followed by a space or a line's end, and at newlines. It reads each sentence alone, and joins them with silence the length of the pause slider (None, Natural, Long, Longer: 0, 0.3, 0.8 and 1.5 s).
  - That gives every engine the same pause control, with progress and cancel at sentence boundaries.
  - A script is at most 5,000 characters.
- **The joined sound is levelled to a fixed loudness before upload**, so every Voice sits alike. No Audio Effect is added.
- **A Narration runner of its own, not the Worker.** One Narration at a time for the whole app; a second is refused as busy.
  - A cloud 429, 5xx or network failure is retried once per sentence, after the service's `Retry-After` (capped at 30 s) or a short wait.
  - Any failure or cancel discards the partial sound and keeps the script and settings in the panel.
- **The start is fixed when Generate is pressed:** the playhead, or the start of the earliest picked Text Layer or hook, whose words fill the script.
  - The words fill only a script the owner hasn't typed (blank, or still the words last filled), so picking around the Timeline never clobbers a typed script.
  - Editing goes on meanwhile.
  - If the tab is gone or the Music Track is locked when it is ready, the item stays in the Media tab, unlaid.
  - Generate is off at the Clip's end.
- **Controls:** engine, Voice (with a sample), Speed 0.5–2×, pause, and a Style line for cloud engines that take one.
  - Speed goes to an engine that takes one natively (OpenAI's `speed`). Gemini's read is retimed after, its pitch kept (`atempo`, as a Music Clip's Speed), sentence by sentence so the pauses keep their length.
  - Gemini always takes a Style; an OpenAI-compatible engine when `TTS_STYLE` says so, by default when its model takes instructions (`gpt-4o-mini-tts`). A Style sent to an engine that takes none is refused.
  - Under the script, an estimate of its length from a characters-per-second pace per language, scaled by Speed.
  - A sample is a fixed sentence in the Job's language (Indonesian or English; English for any other), made on first play and kept on this Mac per engine, Voice and language. It is read at 1× with no Style and levelled as a Narration is, so it sounds like the result, and it takes the one-at-a-time runner's turn: a sample and a Narration refuse each other as busy. Kept samples are WAV files under `DATA_DIR/voice-samples`.
- **The Narrate tab sits in the asset panel and works on phones too**, since nothing needs the microphone.
- **MCP:**
  - `list_assets(kind="voices")` lists the ready engines and Voices, and the default engine for an optional `language`.
  - `generate_speech(text, engine, voice, speed, pauses, style)` runs it through the same runner, waits for it, and returns the item's id, name and duration, or the runner's message.
  - The agent lays it with `merge_candidate_items` (`speech: true`).

## Considered options

- **Kokoro alone, as Concat.** It is fully local, but it has no Indonesian voice for the app's main language.
- **A local Indonesian model (such as MMS-TTS `ind`).** It is CC-BY-NC (non-commercial) and sounds robotic next to the cloud Voices.
- **Speech through `LLM_PROVIDER`.** It would offer one engine only, and none at all on the DeepSeek default.
- **Voice cloning (Pocket TTS, Chatterbox).** It needs consent we can't check, and there is no Indonesian model. Concat asks no consent and adds no watermark.
- **kokoro-onnx.** It needs espeak-ng from brew, or espeakng-loader plus phonemizer and soundfile.
- **The Worker's queue.** A Narration would wait behind a render, though the Media Library isn't per Job.
- **An origin mark and stored script on the item, for "Regenerate in place".** Nothing else needs to tell a Narration from an upload, and Undo then Generate does the same.
- **Captions or Text Layers from the script.** ADR 0020 keeps captions from typed scripts and for Music Clips out of scope; captions for every Speech Music Clip (Takes and Narrations) belong together later.

## Consequences

- **Scripts go to Google, OpenAI or ElevenLabs (ADR 0026) for cloud engines.** The label says so, and nothing more.
- **A Narration shows in the Media tab like any song**, and stays there when undone. Cleaning up is by hand.
- **A new dependency (sherpa-onnx)** and about 132 MB on disk once Kokoro is downloaded.
- **Ducking needs no change.** A Narration is Speech, like a Take.
