# 0026: ElevenLabs reads Narrations with the account's Voices

Status: accepted
Date: 2026-10-23

## Context

ADR 0019 offers two cloud speech engines, Gemini TTS and an OpenAI-compatible `/audio/speech` service, and Kokoro on this Mac. Owners who already pay for ElevenLabs want its Voices for Narrations, including the ones they cloned or added from its library. ElevenLabs is not OpenAI-compatible, so it needs an engine of its own.

## Decision

- **A third cloud engine, `elevenlabs`, offered when `ELEVENLABS_API_KEY` is set.** Its model is `ELEVENLABS_MODEL`, by default `eleven_multilingual_v2`, which reads Indonesian. It is labelled "ElevenLabs · cloud".
- **Its Voices are the account's**, asked of `GET /v1/voices` and kept for ten minutes. Each Voice reads any language. Its detail line is its gender, accent and kind ("Female · American · premade").
  - While the Voices can't be listed (a wrong key, no network), the engine isn't ready, so the picker doesn't show it. A warning is logged, and the failure is remembered for 30 s, so one listing of the engines waits for it only once. The next listing after that asks again.
- **It comes last in the default order**: Gemini, then OpenAI-compatible, then ElevenLabs. An owner who picks it is remembered by the browser as before.
- **It reads raw PCM** (`output_format=pcm_24000`, on every plan), so no MP3 decoder is needed.
- **Speed within ElevenLabs' range goes to it natively** (`voice_settings.speed`, 0.7–1.2). A Speed outside it is read at the nearest end and the runner retimes the rest with `atempo`, so the slider keeps its 0.5–2× everywhere.
  - Every engine now states its native `speed_range`; the runner asks the nearest Speed in it and retimes by what is left.
  - At 1× no `voice_settings` is sent, so a Voice reads with the settings the account gave it.
- **It takes no Style.** `eleven_multilingual_v2` has no instruction prompt.
- Samples, retries (429, 5xx, network) and the one-at-a-time runner work as for the other engines. An account out of credits fails with its own message.

## Considered options

- **A fixed list of premade Voices.** It needs no request to list, but it hides the owner's cloned and library Voices, which are the reason to use ElevenLabs.
- **Clamping Speed to 0.7–1.2.** A 2× slider would quietly sound 1.2×.
- **Always retiming, as Gemini.** It is simpler, but ElevenLabs' own Speed sounds more natural near 1×.
- **ElevenLabs' `preview_url` as the sample.** It costs no credits, but it is always English and isn't read in the Job's language.
- **A Style mapped to `voice_settings.style` or v3 audio tags.** That adds a control that means something different per model.

## Consequences

- **Scripts go to ElevenLabs** when it reads them, and use the account's credits, samples included (once per Voice and language).
- **Voices cloned on ElevenLabs are listed.** The app still clones nothing itself (ADR 0019); consent for a cloned Voice is between the owner and ElevenLabs.
- Listing the engines may wait up to 10 s for ElevenLabs when its Voices aren't kept.
